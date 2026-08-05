#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-source-audit.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-asset-provenance.json'
const EXPECTED_BLACK = 23
const EXPECTED_DARK_STRUCTURE = 3
const EXPECTED_LIGHT_NEUTRAL = 11
const EXPECTED_WHITE = 0

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function finishName(title) {
  const match = title.match(/\bSolidSuit\s+(.+)$/i)
  if (!match) throw new Error(`Cannot derive finish from title: ${title}`)
  return match[1]
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function bodyUrl(sku, deviceHandle) {
  return `https://image.rhinoshield.app/materials/body/${sku}?device-handle=${encodeURIComponent(deviceHandle)}&size=2000&lossless=1`
}

async function fetchPng(url) {
  const response = await fetch(url, {
    headers: { Accept: 'image/png' },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`)
  if (!response.headers.get('content-type')?.startsWith('image/png')) {
    throw new Error(`Expected image/png, got ${response.headers.get('content-type')}: ${url}`)
  }
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Invalid PNG signature: ${url}`)
  }
  return buffer
}

async function inspectPng(buffer) {
  const metadata = await sharp(buffer).metadata()
  if (
    metadata.format !== 'png'
    || metadata.width !== 2000
    || metadata.height !== 2000
    || metadata.channels !== 4
    || !metadata.hasAlpha
  ) {
    throw new Error(`Expected 2000x2000 RGBA PNG, got ${JSON.stringify({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
    })}`)
  }

  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let visiblePixelCount = 0
  let opaquePixelCount = 0
  let red = 0
  let green = 0
  let blue = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]
    if (alpha > 0) {
      const pixelIndex = offset / 4
      const x = pixelIndex % info.width
      const y = Math.floor(pixelIndex / info.width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      visiblePixelCount += 1
    }
    if (alpha >= 250) {
      red += data[offset]
      green += data[offset + 1]
      blue += data[offset + 2]
      opaquePixelCount += 1
    }
  }
  if (!visiblePixelCount || !opaquePixelCount) throw new Error('PNG has no visible opaque body pixels')

  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    alphaBounds: { minX, minY, maxX, maxY },
    visiblePixelCount,
    opaquePixelCount,
    meanOpaqueRgb: [red, green, blue].map((total) => Number((total / opaquePixelCount).toFixed(3))),
  }
}

async function existingStatus(filePath, buffer) {
  try {
    const existing = await readFile(filePath)
    if (!existing.equals(buffer)) throw new Error(`Existing source differs from verified response: ${filePath}`)
    return 'already-current'
  } catch (error) {
    if (error.code === 'ENOENT') return 'new'
    throw error
  }
}

async function main() {
  const inputPath = argValue('--input', DEFAULT_INPUT)
  const outputDir = argValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argValue('--report', DEFAULT_REPORT)
  const expectedBlack = Number(argValue('--expected-black', EXPECTED_BLACK))
  const expectedDarkStructure = Number(argValue('--expected-dark-structure', EXPECTED_DARK_STRUCTURE))
  const expectedLightNeutral = Number(argValue('--expected-light-neutral', EXPECTED_LIGHT_NEUTRAL))
  const expectedWhite = Number(argValue('--expected-white', EXPECTED_WHITE))
  if ([expectedBlack, expectedDarkStructure, expectedLightNeutral, expectedWhite].some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('Expected asset counts must be non-negative integers')
  }
  const audit = JSON.parse(await readFile(inputPath, 'utf8'))
  const assets = []
  for (const record of audit.results) {
    if (record.black) assets.push({ record, variant: record.black, role: 'black' })
    if (record.texturedDark) assets.push({ record, variant: record.texturedDark, role: 'dark-structure' })
    if (record.category === 'black-and-light-neutral' && record.light) {
      assets.push({ record, variant: record.light, role: 'light-neutral' })
    }
    if (record.category === 'black-and-white' && record.light) {
      assets.push({ record, variant: record.light, role: 'white' })
    }
  }

  const blackCount = assets.filter((asset) => asset.role === 'black').length
  const darkStructureCount = assets.filter((asset) => asset.role === 'dark-structure').length
  const lightNeutralCount = assets.filter((asset) => asset.role === 'light-neutral').length
  const whiteCount = assets.filter((asset) => asset.role === 'white').length
  if (
    blackCount !== expectedBlack
    || darkStructureCount !== expectedDarkStructure
    || lightNeutralCount !== expectedLightNeutral
    || whiteCount !== expectedWhite
  ) {
    throw new Error(`Expected ${expectedBlack} black + ${expectedDarkStructure} dark-structure + ${expectedLightNeutral} light-neutral + ${expectedWhite} white assets, found ${blackCount} + ${darkStructureCount} + ${lightNeutralCount} + ${whiteCount}`)
  }

  assets.sort((left, right) => (
    left.record.modelId.localeCompare(right.record.modelId)
    || left.role.localeCompare(right.role)
  ))
  const verified = []
  for (const asset of assets) {
    const { record, variant, role } = asset
    const url = bodyUrl(variant.sku, record.deviceHandle)
    const first = await fetchPng(url)
    const second = await fetchPng(url)
    if (!first.equals(second)) throw new Error(`Unstable repeated response: ${record.modelId} ${variant.sku}`)
    const finish = finishName(variant.title)
    const fileName = `${record.modelId}-official-${slug(finish)}-rhinoshield-${variant.sku}.png`
    const filePath = path.join(outputDir, fileName)
    verified.push({
      buffer: first,
      filePath,
      report: {
        modelId: record.modelId,
        deviceHandle: record.deviceHandle,
        role,
        finish,
        officialTitle: variant.title,
        sku: variant.sku,
        productPageUrl: record.productPageUrl,
        sourceUrl: url,
        path: filePath,
        encodedSha256: sha256(first),
        repeatedFetchByteIdentical: true,
        ...(await inspectPng(first)),
      },
    })
  }

  await mkdir(outputDir, { recursive: true })
  let written = 0
  let alreadyCurrent = 0
  for (const asset of verified) {
    const status = await existingStatus(asset.filePath, asset.buffer)
    if (status === 'new') {
      await writeFile(asset.filePath, asset.buffer)
      written += 1
    } else {
      alreadyCurrent += 1
    }
    asset.report.writeStatus = status === 'new' ? 'written' : status
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Official RhinoShield SolidSuit product metadata and materials/body PNG service',
    summary: {
      total: verified.length,
      black: blackCount,
      darkStructure: darkStructureCount,
      lightNeutral: lightNeutralCount,
      white: whiteCount,
      written,
      alreadyCurrent,
    },
    assets: verified.map((asset) => asset.report),
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()