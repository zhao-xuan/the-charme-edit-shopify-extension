#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-note10-gomibo-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-note10-gomibo-case-asset-provenance.json'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36'

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'cache-control': 'no-cache', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`)
  return { buffer, contentType: response.headers.get('content-type') || '', finalUrl: response.url }
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
  const { buffer, contentType, finalUrl } = await fetchBytes(product.productRecordUrl, 'text/html')
  assert(contentType.includes('text/html'), `Expected HTML product record: ${product.productRecordUrl}`)
  const html = buffer.toString('utf8')
  const title = normalizeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  assert(title === product.title, `Gomibo product title changed: ${title}`)
  assert(html.includes(product.sku), `Gomibo SKU missing from product record: ${product.sku}`)
  assert(html.includes(product.gtin), `Gomibo GTIN missing from product record: ${product.gtin}`)
  assert(html.includes(candidate.sourceUrl), `Selected signed gallery URL is absent: ${candidate.galleryImageId}`)
  return {
    retailer: product.retailer,
    sku: product.sku,
    gtin: product.gtin,
    productTitle: title,
    productRecordFinalUrl: finalUrl,
    galleryImageId: candidate.galleryImageId,
    galleryPosition: candidate.galleryPosition,
  }
}

async function verifyOfficialDimensions(modelId, dimensions) {
  assert(dimensions.apiQuery.modelCode === dimensions.modelCode, `${modelId}: Samsung API model code mismatch`)
  const requestUrl = new URL(dimensions.apiEndpoint)
  for (const [key, value] of Object.entries(dimensions.apiQuery)) requestUrl.searchParams.set(key, value)
  const [{ buffer: pageBytes, contentType: pageContentType }, { buffer, contentType }] = await Promise.all([
    fetchBytes(dimensions.sourcePageUrl, 'text/html'),
    fetchBytes(requestUrl, 'application/json'),
  ])
  assert(pageContentType.includes('text/html'), `${modelId}: expected archived Samsung HTML`)
  const page = pageBytes.toString('utf8')
  assert(page.includes(dimensions.modelFamilyCode), `${modelId}: Samsung model family is absent from archived page`)
  assert(page.includes(dimensions.modelCode), `${modelId}: Samsung support model code is absent from archived page`)
  assert(contentType.includes('json'), `${modelId}: expected Samsung API JSON`)
  const payload = JSON.parse(buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, `${modelId}: Samsung API did not return statusCode 200`)
  assert(payload.response?.siteCode === dimensions.apiQuery.siteCode, `${modelId}: Samsung API site code changed`)
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const specItems = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const matches = specItems.filter((item) => (
    item.SpecItemNameLevel2 === dimensions.reportedLabel
    && item.SpecItemkeyLevel2 === dimensions.specItemKey
    && item.SpecItemIdLevel2 === dimensions.specItemId
  ))
  assert(matches.length === 1, `${modelId}: expected one exact Samsung dimension item, found ${matches.length}`)
  assert(matches[0].SpecItemValue === dimensions.reportedValue, `${modelId}: Samsung dimensions changed`)
  return {
    manufacturer: dimensions.manufacturer,
    modelId,
    modelCode: dimensions.modelCode,
    modelFamilyCode: dimensions.modelFamilyCode,
    sourcePageUrl: dimensions.sourcePageUrl,
    originalSourcePageUrl: dimensions.originalSourcePageUrl,
    sourcePageTitle: dimensions.sourcePageTitle,
    sourcePageHttpStatus: 200,
    archivedPageHttpStatus: dimensions.sourcePageUrl.includes('web.archive.org') ? 200 : null,
    modelIdentityFound: true,
    apiEndpoint: dimensions.apiEndpoint,
    apiQuery: dimensions.apiQuery,
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    reportedLabel: matches[0].SpecItemNameLevel2,
    reportedValue: matches[0].SpecItemValue,
    specItemKey: matches[0].SpecItemkeyLevel2,
    specItemId: matches[0].SpecItemIdLevel2,
    reportedValueFound: true,
  }
}

async function inspectJpeg(buffer, candidate) {
  assert(buffer.subarray(0, 3).toString('hex') === 'ffd8ff', `Invalid JPEG signature: ${candidate.sourceUrl}`)
  const metadata = await sharp(buffer).metadata()
  assert(
    metadata.format === 'jpeg'
      && metadata.width === candidate.expectedWidth
      && metadata.height === candidate.expectedHeight
      && metadata.channels === 3,
    `Unexpected source image: ${candidate.sourceUrl} ${JSON.stringify(metadata)}`,
  )
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
  assert(manifest.candidates?.length === 1, 'Note 10 Gomibo manifest must contain exactly one candidate')

  const candidate = manifest.candidates[0]
  const product = manifest.products?.[candidate.product]
  const dimensions = manifest.officialDimensions?.[candidate.targetModelId]
  assert(product, `Unknown product key: ${candidate.product}`)
  assert(dimensions, `Missing official dimensions: ${candidate.targetModelId}`)
  const [productRecord, officialDimensionEvidence] = await Promise.all([
    verifyProductRecord(product, candidate),
    verifyOfficialDimensions(candidate.targetModelId, dimensions),
  ])
  const first = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
  const second = await fetchBytes(candidate.sourceUrl, 'image/jpeg')
  assert(first.contentType.startsWith('image/jpeg'), `Expected image/jpeg: ${candidate.sourceUrl}`)
  assert(second.contentType.startsWith('image/jpeg'), `Expected image/jpeg: ${candidate.sourceUrl}`)
  assert(first.buffer.equals(second.buffer), `Unstable repeated source response: ${candidate.sourceModelId}`)
  assert(sha256(first.buffer) === candidate.expectedEncodedSha256, `Source SHA-256 changed: ${candidate.sourceModelId}`)
  const galleryNumber = candidate.galleryImageId.match(/_(\d+)\.[a-z0-9]+$/i)?.[1]
  assert(galleryNumber, `Could not parse gallery number: ${candidate.galleryImageId}`)
  const filePath = path.join(
    outputDir,
    `${candidate.sourceModelId}-verified-gomibo-${product.sku}-gallery-${galleryNumber}.jpg`,
  )
  const asset = {
    buffer: first.buffer,
    filePath,
    report: {
      ...candidate,
      sourceKind: 'verified-gomibo-spigen-product-image',
      productRecordUrl: product.productRecordUrl,
      path: filePath,
      encodedSha256: sha256(first.buffer),
      repeatedFetchByteIdentical: true,
      productRecordVerified: true,
      productRecord,
      ...(await inspectJpeg(first.buffer, candidate)),
    },
  }

  await mkdir(outputDir, { recursive: true })
  const status = await existingStatus(asset.filePath, asset.buffer)
  if (status === 'new') await writeFile(asset.filePath, asset.buffer)
  asset.report.writeStatus = status === 'new' ? 'written' : status

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: manifest.source,
    officialDimensionEvidence,
    summary: {
      candidates: 1,
      geometryAccepted: candidate.geometryReview.startsWith('accepted') ? 1 : 0,
      publicationEligible: candidate.publicationEligible ? 1 : 0,
      repeatedFetchByteIdentical: 1,
      productRecordsVerified: 1,
      officialDimensionsVerified: 1,
      written: status === 'new' ? 1 : 0,
      alreadyCurrent: status === 'already-current' ? 1 : 0,
    },
    assets: [asset.report],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()