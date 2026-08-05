#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/insignia-note9-bestbuy-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/insignia-note9-bestbuy-case-asset-provenance.json'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36'
const BEST_BUY_GRAPHQL_ENDPOINT = 'https://www.bestbuy.com/gateway/graphql'
const BEST_BUY_GRAPHQL_OPERATION = 'Note9Evidence'
const BEST_BUY_GRAPHQL_QUERY = 'query Note9Evidence($skuId: String!) { productBySkuId(skuId: $skuId) { skuId name { short } manufacturer { modelNumber } images { piscesHref } } }'

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
    headers: {
      Accept: accept,
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'user-agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(30_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${url}`)
  return { buffer, contentType: response.headers.get('content-type') || '', finalUrl: response.url }
}

function normalizeText(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&trade;|&#8482;/g, '™')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function verifyProductRecord(product, candidate) {
  const evidence = JSON.parse(await readFile(product.browserEvidencePath, 'utf8'))
  const capturedAt = Date.parse(evidence.capturedAt)
  assert(evidence.schemaVersion === 1, 'Unsupported Best Buy browser evidence schema')
  assert(evidence.captureMethod === 'live-browser-bestbuy-graphql', 'Unexpected Best Buy capture method')
  assert(Number.isFinite(capturedAt) && capturedAt <= Date.now(), 'Invalid Best Buy browser capture time')
  assert(evidence.pageUrl === product.productRecordUrl, `Best Buy product URL changed: ${evidence.pageUrl}`)
  assert(normalizeText(evidence.pageTitle) === product.title, `Best Buy product title changed: ${evidence.pageTitle}`)
  assert(evidence.request?.endpoint === BEST_BUY_GRAPHQL_ENDPOINT, 'Best Buy GraphQL endpoint changed')
  assert(evidence.request?.operationName === BEST_BUY_GRAPHQL_OPERATION, 'Best Buy GraphQL operation changed')
  assert(evidence.request?.variables?.skuId === product.sku, `Best Buy query SKU changed: ${evidence.request?.variables?.skuId}`)
  assert(evidence.request?.query === BEST_BUY_GRAPHQL_QUERY, 'Best Buy evidence query changed')
  assert(evidence.response?.httpStatus === 200, `Best Buy browser query HTTP ${evidence.response?.httpStatus}`)
  assert(evidence.response?.contentType?.includes('application/json'), 'Best Buy browser query was not JSON')
  const record = evidence.response?.product
  assert(record?.skuId === product.sku, `Best Buy SKU changed: ${record?.skuId}`)
  assert(record?.modelNumber === product.modelNumber, `Best Buy model number changed: ${record?.modelNumber}`)
  assert(record?.name === product.shortTitle, `Best Buy short title changed: ${record?.name}`)
  assert(record?.images?.includes(candidate.sourceUrl), `Selected source URL is absent: ${candidate.galleryImageId}`)
  assert(record?.images?.includes(candidate.identityEvidence.sourceUrl), `Packaging evidence URL is absent: ${candidate.identityEvidence.galleryImageId}`)
  assert(new Set(record.images).size === record.images.length, 'Best Buy source list contains duplicate URLs')
  const canonicalProductSha256 = sha256(Buffer.from(JSON.stringify(record)))
  assert(
    canonicalProductSha256 === evidence.response.canonicalProductSha256
      && canonicalProductSha256 === product.expectedCanonicalProductSha256,
    `Best Buy canonical product hash changed: ${canonicalProductSha256}`,
  )
  return {
    retailer: product.retailer,
    sku: product.sku,
    gtin: product.gtin,
    modelNumber: product.modelNumber,
    productTitle: evidence.pageTitle,
    shortTitle: record.name,
    productRecordFinalUrl: evidence.pageUrl,
    verificationMethod: evidence.captureMethod,
    browserEvidencePath: product.browserEvidencePath,
    browserEvidenceCapturedAt: evidence.capturedAt,
    canonicalProductSha256,
    galleryImageId: candidate.galleryImageId,
    galleryPosition: candidate.galleryPosition,
    identityEvidenceGalleryImageId: candidate.identityEvidence.galleryImageId,
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
    archivedPageHttpStatus: 200,
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

async function inspectJpeg(buffer, expected, label) {
  assert(buffer.subarray(0, 3).toString('hex') === 'ffd8ff', `Invalid JPEG signature: ${label}`)
  const metadata = await sharp(buffer).metadata()
  assert(
    metadata.format === 'jpeg'
      && metadata.width === expected.expectedWidth
      && metadata.height === expected.expectedHeight
      && metadata.channels === 3,
    `Unexpected source image: ${label} ${JSON.stringify(metadata)}`,
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

async function writeVerifiedAsset(filePath, buffer) {
  const status = await existingStatus(filePath, buffer)
  if (status === 'new') await writeFile(filePath, buffer)
  return status === 'new' ? 'written' : status
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(manifest.candidates?.length === 1, 'Note 9 Best Buy manifest must contain exactly one candidate')

  const candidate = manifest.candidates[0]
  const product = manifest.products?.[candidate.product]
  const dimensions = manifest.officialDimensions?.[candidate.targetModelId]
  assert(product, `Unknown product key: ${candidate.product}`)
  assert(dimensions, `Missing official dimensions: ${candidate.targetModelId}`)
  const [productRecord, officialDimensionEvidence] = await Promise.all([
    verifyProductRecord(product, candidate),
    verifyOfficialDimensions(candidate.targetModelId, dimensions),
  ])
  const [first, second, identityEvidence] = await Promise.all([
    fetchBytes(candidate.sourceUrl, 'image/jpeg'),
    fetchBytes(candidate.sourceUrl, 'image/jpeg'),
    fetchBytes(candidate.identityEvidence.sourceUrl, 'image/jpeg'),
  ])
  assert(first.contentType.startsWith('image/jpeg'), `Expected image/jpeg: ${candidate.sourceUrl}`)
  assert(second.contentType.startsWith('image/jpeg'), `Expected image/jpeg: ${candidate.sourceUrl}`)
  assert(identityEvidence.contentType.startsWith('image/jpeg'), `Expected image/jpeg: ${candidate.identityEvidence.sourceUrl}`)
  assert(first.buffer.equals(second.buffer), `Unstable repeated source response: ${candidate.sourceModelId}`)
  assert(sha256(first.buffer) === candidate.expectedEncodedSha256, `Source SHA-256 changed: ${candidate.sourceModelId}`)
  assert(
    sha256(identityEvidence.buffer) === candidate.identityEvidence.expectedEncodedSha256,
    `Packaging evidence SHA-256 changed: ${candidate.sourceModelId}`,
  )

  const sourcePath = path.join(outputDir, `${candidate.sourceModelId}-verified-bestbuy-${product.sku}-gallery-cv1d.jpg`)
  const identityEvidencePath = path.join(
    outputDir,
    `${candidate.sourceModelId}-verified-bestbuy-${product.sku}-packaging-cv11d.jpg`,
  )
  await mkdir(outputDir, { recursive: true })
  const [writeStatus, identityEvidenceWriteStatus] = await Promise.all([
    writeVerifiedAsset(sourcePath, first.buffer),
    writeVerifiedAsset(identityEvidencePath, identityEvidence.buffer),
  ])
  const asset = {
    ...candidate,
    sourceKind: 'verified-bestbuy-insignia-real-product-photograph',
    productRecordUrl: product.productRecordUrl,
    path: sourcePath,
    encodedSha256: sha256(first.buffer),
    repeatedFetchByteIdentical: true,
    productRecordVerified: true,
    productRecord,
    ...(await inspectJpeg(first.buffer, candidate, candidate.sourceUrl)),
    writeStatus,
    identityEvidence: {
      ...candidate.identityEvidence,
      path: identityEvidencePath,
      encodedSha256: sha256(identityEvidence.buffer),
      ...(await inspectJpeg(identityEvidence.buffer, candidate.identityEvidence, candidate.identityEvidence.sourceUrl)),
      writeStatus: identityEvidenceWriteStatus,
    },
  }

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
      packagingIdentityEvidenceVerified: 1,
      officialDimensionsVerified: 1,
      written: [writeStatus, identityEvidenceWriteStatus].filter((status) => status === 'written').length,
      alreadyCurrent: [writeStatus, identityEvidenceWriteStatus].filter((status) => status === 'already-current').length,
    },
    assets: [asset],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()