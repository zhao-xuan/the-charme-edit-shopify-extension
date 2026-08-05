#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a-series-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a-series-case-asset-provenance.json'

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

function mediaUrl(media) {
  return media.src || media.preview_image?.src || ''
}

async function loadProduct(key, expected) {
  const { buffer, contentType } = await fetchBytes(expected.productRecordUrl, 'application/json')
  if (!contentType || !/(?:json|javascript)/i.test(contentType)) {
    throw new Error(`Expected JSON product record: ${expected.productRecordUrl}`)
  }
  const product = JSON.parse(buffer.toString('utf8'))
  if (String(product.id) !== expected.productId || product.title !== expected.title) {
    throw new Error(`Spigen product identity mismatch: ${key}`)
  }
  return product
}

function verifyProductCandidate(candidate, product) {
  const variant = product.variants?.find((item) => (
    item.sku === candidate.sku && item.title === candidate.variantTitle
  ))
  if (
    !variant
    || variant.barcode !== candidate.gtin
  ) {
    throw new Error(`Spigen variant identity mismatch: ${candidate.targetModelId}`)
  }
  const media = product.media?.find((item) => mediaUrl(item) === candidate.sourceUrl)
  if (!media || media.alt !== candidate.mediaAlt) {
    throw new Error(`Spigen media identity mismatch: ${candidate.targetModelId}`)
  }
  return {
    productId: String(product.id),
    productTitle: product.title,
    variantTitle: variant.title,
    sku: variant.sku,
    gtin: variant.barcode,
    mediaAlt: media.alt,
  }
}

async function inspectJpeg(buffer, candidate) {
  if (buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') {
    throw new Error(`Invalid JPEG signature: ${candidate.sourceUrl}`)
  }
  const metadata = await sharp(buffer).metadata()
  if (
    metadata.format !== 'jpeg'
    || metadata.width !== candidate.expectedWidth
    || metadata.height !== candidate.expectedHeight
    || metadata.channels !== 3
  ) {
    throw new Error(`Unexpected source image: ${candidate.sourceUrl} ${JSON.stringify(metadata)}`)
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
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  if (!manifest.candidates?.length) throw new Error('Spigen source manifest has no candidates')

  const products = new Map()
  for (const [key, expected] of Object.entries(manifest.products || {})) {
    products.set(key, await loadProduct(key, expected))
  }

  const verified = []
  for (const candidate of manifest.candidates) {
    const product = products.get(candidate.product)
    if (!product) throw new Error(`Unknown product key: ${candidate.product}`)
    const productRecord = verifyProductCandidate(candidate, product)
    const first = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
    const second = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
    if (!first.contentType?.startsWith('image/jpeg') || !second.contentType?.startsWith('image/jpeg')) {
      throw new Error(`Expected image/jpeg: ${candidate.sourceUrl}`)
    }
    if (!first.buffer.equals(second.buffer)) {
      throw new Error(`Unstable repeated source response: ${candidate.sourceModelId}`)
    }
    const filePath = path.join(outputDir, `${candidate.sourceModelId}-official-spigen-${candidate.sku}-inner.jpg`)
    verified.push({
      buffer: first.buffer,
      filePath,
      report: {
        targetModelId: candidate.targetModelId,
        targetModelName: candidate.targetModelName,
        sourceModelId: candidate.sourceModelId,
        sourceKind: 'official-spigen-empty-case-image',
        publicationEligible: candidate.publicationEligible,
        eligibilityReason: candidate.eligibilityReason,
        geometryReview: candidate.geometryReview,
        productRecordUrl: manifest.products[candidate.product].productRecordUrl,
        sourceUrl: candidate.sourceUrl,
        path: filePath,
        encodedSha256: sha256(first.buffer),
        repeatedFetchByteIdentical: true,
        productRecordVerified: true,
        productRecord,
        ...(await inspectJpeg(first.buffer, candidate)),
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
    source: manifest.source,
    summary: {
      candidates: verified.length,
      geometryAccepted: verified.filter((asset) => asset.report.geometryReview.startsWith('accepted')).length,
      publicationEligible: verified.filter((asset) => asset.report.publicationEligible).length,
      identityBlocked: verified.filter((asset) => !asset.report.publicationEligible).length,
      repeatedFetchByteIdentical: verified.filter((asset) => asset.report.repeatedFetchByteIdentical).length,
      productRecordsVerified: verified.filter((asset) => asset.report.productRecordVerified).length,
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