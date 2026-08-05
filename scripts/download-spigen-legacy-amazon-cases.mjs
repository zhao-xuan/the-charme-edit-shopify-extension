#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-legacy-amazon-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-legacy-amazon-case-asset-provenance.json'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36'

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'cache-control': 'no-cache', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`)
  return { buffer, contentType: response.headers.get('content-type') || '' }
}

function normalizeText(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function verifyProductRecord(product, candidate) {
  const { buffer, contentType } = await fetchBytes(product.productRecordUrl, 'text/html')
  if (!contentType.includes('text/html')) throw new Error(`Expected HTML product record: ${product.productRecordUrl}`)
  const html = buffer.toString('utf8')
  const title = normalizeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  if (title !== product.title) throw new Error(`Amazon product title changed: ${candidate.targetModelId}: ${title}`)
  if (!html.includes(product.asin)) throw new Error(`Amazon ASIN missing from product record: ${product.asin}`)
  if (!html.includes(candidate.galleryImageId)) {
    throw new Error(`Selected gallery image is absent from product record: ${candidate.galleryImageId}`)
  }
  return {
    retailer: 'Amazon Belgium',
    asin: product.asin,
    productTitle: title,
    galleryImageId: candidate.galleryImageId,
    galleryPosition: candidate.galleryPosition,
  }
}

async function inspectJpeg(buffer, candidate) {
  if (buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error(`Invalid JPEG signature: ${candidate.sourceUrl}`)
  const metadata = await sharp(buffer).metadata()
  if (
    metadata.format !== 'jpeg'
    || metadata.width !== candidate.expectedWidth
    || metadata.height !== candidate.expectedHeight
    || metadata.channels !== 3
  ) throw new Error(`Unexpected source image: ${candidate.sourceUrl} ${JSON.stringify(metadata)}`)
  return { format: metadata.format, width: metadata.width, height: metadata.height, channels: metadata.channels }
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
  if (!manifest.candidates?.length) throw new Error('Legacy Amazon source manifest has no candidates')

  const verified = []
  for (const candidate of manifest.candidates) {
    const product = manifest.products?.[candidate.product]
    if (!product) throw new Error(`Unknown product key: ${candidate.product}`)
    const productRecord = await verifyProductRecord(product, candidate)
    const first = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
    const second = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
    if (!first.contentType.startsWith('image/jpeg') || !second.contentType.startsWith('image/jpeg')) {
      throw new Error(`Expected image/jpeg: ${candidate.sourceUrl}`)
    }
    if (!first.buffer.equals(second.buffer)) throw new Error(`Unstable repeated source response: ${candidate.sourceModelId}`)
    if (sha256(first.buffer) !== candidate.expectedEncodedSha256) {
      throw new Error(`Source SHA-256 changed: ${candidate.sourceModelId}`)
    }
    const filePath = path.join(outputDir, `${candidate.sourceModelId}-verified-amazon-${product.asin}-${candidate.galleryImageId}.jpg`)
    verified.push({
      buffer: first.buffer,
      filePath,
      report: {
        ...candidate,
        sourceKind: 'verified-amazon-spigen-product-image',
        productRecordUrl: product.productRecordUrl,
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