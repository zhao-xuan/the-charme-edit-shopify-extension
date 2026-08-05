#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-source-audit.json'
const DEFAULT_OUTPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-adjacent-white-sku-audit.json'

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function bodyUrl(sku, deviceHandle) {
  return `https://image.rhinoshield.app/materials/body/${sku}?device-handle=${deviceHandle}&size=2000&lossless=1`
}

async function fetchPng(url) {
  const response = await fetch(url, {
    headers: { Accept: 'image/png' },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    buffer,
  }
}

async function inspectPng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error(`Not a PNG: ${signature || '(empty)'}`)

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let alphaPixels = 0
  let opaquePixels = 0
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
      alphaPixels += 1
    }
    if (alpha >= 250) {
      red += data[offset]
      green += data[offset + 1]
      blue += data[offset + 2]
      opaquePixels += 1
    }
  }
  if (!alphaPixels || !opaquePixels) throw new Error('PNG has no visible opaque body pixels')

  const meanRgb = [red, green, blue].map((total) => Number((total / opaquePixels).toFixed(3)))
  return {
    encodedSha256: sha256(buffer),
    width: info.width,
    height: info.height,
    channels: info.channels,
    alphaBounds: { minX, minY, maxX, maxY, pixelCount: alphaPixels },
    opaquePixelCount: opaquePixels,
    meanRgb,
    visuallyNearWhite: meanRgb.every((channel) => channel >= 235),
  }
}

async function probe(record) {
  const blackSku = record.black?.sku
  if (!blackSku?.endsWith('52')) {
    return {
      modelId: record.modelId,
      deviceHandle: record.deviceHandle,
      blackSku,
      classification: 'not-probed-black-sku-does-not-end-52',
    }
  }

  const candidateSku = `${blackSku.slice(0, -2)}53`
  const productPageResponse = await fetch(record.productPageUrl, {
    signal: AbortSignal.timeout(30_000),
  })
  const productPageHtml = await productPageResponse.text()
  const candidateUrl = bodyUrl(candidateSku, record.deviceHandle)
  try {
    const candidate = await fetchPng(candidateUrl)
    const result = {
      modelId: record.modelId,
      deviceHandle: record.deviceHandle,
      blackSku,
      candidateSku,
      candidateUrl,
      productPageStatus: productPageResponse.status,
      candidateMentionedOnProductPage: productPageHtml.includes(candidateSku),
      candidateStatus: candidate.status,
      candidateContentType: candidate.contentType,
      classification: 'candidate-endpoint-unavailable',
    }
    if (candidate.status === 200 && candidate.contentType?.startsWith('image/png')) {
      Object.assign(result, await inspectPng(candidate.buffer))
      result.classification = result.candidateMentionedOnProductPage
        ? 'candidate-mentioned-on-official-page'
        : 'candidate-endpoint-only-no-finish-provenance'
    }
    return result
  } catch (error) {
    return {
      modelId: record.modelId,
      deviceHandle: record.deviceHandle,
      blackSku,
      candidateSku,
      candidateUrl,
      productPageStatus: productPageResponse.status,
      candidateMentionedOnProductPage: productPageHtml.includes(candidateSku),
      classification: 'error',
      error: error.message,
    }
  }
}

async function main() {
  const inputPath = argValue('--input', DEFAULT_INPUT)
  const outputPath = argValue('--output', DEFAULT_OUTPUT)
  const sourceAudit = JSON.parse(await readFile(inputPath, 'utf8'))
  const records = sourceAudit.results.filter((record) => record.black)
  const results = []
  for (const record of records) results.push(await probe(record))

  const classifications = [...new Set(results.map((result) => result.classification))].sort()
  const summary = Object.fromEntries(classifications.map((classification) => [
    classification,
    results.filter((result) => result.classification === classification).length,
  ]))
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    warning: 'An image endpoint response does not prove that the candidate SKU was an official White product variant.',
    summary,
    results,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, probedCount: records.length, summary }, null, 2))
}

await main()