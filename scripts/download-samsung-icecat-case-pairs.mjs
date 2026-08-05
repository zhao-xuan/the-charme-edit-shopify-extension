#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/samsung-icecat-case-pair-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/samsung-icecat-case-pair-asset-provenance.json'
const DEFAULT_EXPECTED_MODELS = 1
const FINISHES = ['black', 'white']

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`)
  return { buffer, contentType: response.headers.get('content-type') }
}

async function verifyProductRecord(model, source) {
  const { buffer } = await fetchBytes(source.productRecordUrl, 'application/json')
  const payload = JSON.parse(buffer.toString('utf8'))
  const general = payload.data?.GeneralInfo
  if (!general) throw new Error(`Missing Icecat product record: ${source.icecatId}`)
  const gallery = (payload.data.Gallery || []).find((item) => item.Pic === source.sourceUrl)
  const compatibility = general.SummaryDescription?.ShortSummaryDescription || ''
  const valid = general.IcecatId === source.icecatId
    && general.Brand === source.manufacturer
    && general.BrandPartCode === source.mpn
    && (general.GTIN || []).includes(source.gtin)
    && compatibility.includes(model.compatibility)
    && gallery?.No === source.galleryNumber
    && Number(gallery.PicWidth) === source.expectedWidth
    && Number(gallery.PicHeight) === source.expectedHeight
  if (!valid) {
    throw new Error(`Icecat product identity mismatch: ${model.modelId}/${source.finish}`)
  }
  return {
    icecatId: general.IcecatId,
    title: general.Title,
    manufacturer: general.Brand,
    mpn: general.BrandPartCode,
    gtin: source.gtin,
    compatibility: model.compatibility,
    galleryNumber: gallery.No,
    galleryWidth: Number(gallery.PicWidth),
    galleryHeight: Number(gallery.PicHeight),
  }
}

async function inspectJpeg(buffer, source) {
  if (buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error(`Invalid JPEG signature: ${source.sourceUrl}`)
  const metadata = await sharp(buffer).metadata()
  if (
    metadata.format !== 'jpeg'
    || metadata.width !== source.expectedWidth
    || metadata.height !== source.expectedHeight
    || metadata.channels !== 3
  ) {
    throw new Error(`Unexpected source image: ${source.sourceUrl} ${JSON.stringify(metadata)}`)
  }
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
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
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const expectedModels = Number(argumentValue('--expected-models', DEFAULT_EXPECTED_MODELS))
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  if (!Number.isInteger(expectedModels) || manifest.models.length !== expectedModels) {
    throw new Error(`Expected ${expectedModels} models, found ${manifest.models.length}`)
  }

  const verified = []
  for (const model of manifest.models) {
    const finishes = model.sources.map((source) => source.finish).sort()
    if (JSON.stringify(finishes) !== JSON.stringify(FINISHES)) {
      throw new Error(`Expected one black and one white source: ${model.modelId}`)
    }
    for (const source of model.sources) {
      const productRecord = await verifyProductRecord(model, source)
      const first = await fetchBytes(source.sourceUrl, 'image/jpeg')
      const second = await fetchBytes(source.sourceUrl, 'image/jpeg')
      if (!first.contentType?.startsWith('image/jpeg') || !second.contentType?.startsWith('image/jpeg')) {
        throw new Error(`Expected image/jpeg: ${source.sourceUrl}`)
      }
      if (!first.buffer.equals(second.buffer)) {
        throw new Error(`Unstable repeated source response: ${model.modelId}/${source.finish}`)
      }
      const filePath = path.join(outputDir, `${model.modelId}-official-${source.finish}-samsung-${source.mpn}.jpg`)
      verified.push({
        buffer: first.buffer,
        filePath,
        report: {
          modelId: model.modelId,
          modelName: model.modelName,
          finish: source.finish,
          sourceKind: 'official-samsung-accessory-image',
          productRecordUrl: source.productRecordUrl,
          sourceUrl: source.sourceUrl,
          path: filePath,
          encodedSha256: sha256(first.buffer),
          repeatedFetchByteIdentical: true,
          productRecordVerified: true,
          productRecord,
          ...(await inspectJpeg(first.buffer, source)),
        },
      })
    }
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
    source: manifest.source,
    summary: {
      models: manifest.models.length,
      assets: verified.length,
      repeatedFetchByteIdentical: verified.filter((asset) => asset.report.repeatedFetchByteIdentical).length,
      productRecordsVerified: verified.filter((asset) => asset.report.productRecordVerified).length,
      written,
      alreadyCurrent,
    },
    models: manifest.models.map(({ sources, ...model }) => model),
    assets: verified.map((asset) => asset.report),
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()