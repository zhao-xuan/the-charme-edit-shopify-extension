#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a16-case-sources.json'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a16-case-asset-provenance.json'

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function normalizeText(value) {
  return String(value || '')
    .replace(/&lrm;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mediaUrl(media) {
  return media.src || media.preview_image?.src || ''
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'accept-language': 'en-GB,en;q=0.9',
      'cache-control': 'no-cache',
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/127 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  assert(response.status === 200, `HTTP ${response.status}: ${url}`)
  return {
    buffer,
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
  }
}

async function verifyCatalogIdentity(manifest) {
  const inventory = JSON.parse(await readFile(manifest.catalogIdentity.inventoryPath, 'utf8'))
  const matches = inventory.models.filter((model) => model.id === manifest.catalogIdentity.inventoryModelId)
  assert(matches.length === 1, `Expected one canonical A16 inventory record, found ${matches.length}`)
  const model = matches[0]
  assert(model.id === manifest.targetModelId, 'Canonical A16 model ID changed')
  assert(model.name === manifest.targetModelName, 'Canonical A16 model name changed')
  assert(model.name === manifest.catalogIdentity.inventoryModelName, 'A16 catalog identity evidence changed')
  return {
    ...manifest.catalogIdentity,
    matchedModel: { id: model.id, name: model.name, brand: model.brand },
    verified: true,
  }
}

async function verifySpigenSource(manifest) {
  const expected = manifest.product
  const productResponse = await fetchBytes(expected.productRecordUrl, 'application/json')
  assert(/(?:json|javascript)/i.test(productResponse.contentType), 'Spigen product response was not JSON')
  const product = JSON.parse(productResponse.buffer.toString('utf8'))
  assert(String(product.id) === expected.productId, 'Spigen product ID changed')
  assert(product.title === expected.title, 'Spigen product title changed')
  const variants = product.variants.filter((variant) => variant.sku === expected.sku)
  assert(variants.length === 1, `Expected one Spigen A16 SKU, found ${variants.length}`)
  const variant = variants[0]
  assert(variant.title === expected.variantTitle, 'Spigen A16 variant title changed')
  assert(variant.barcode === expected.gtin, 'Spigen A16 GTIN changed')
  const mediaMatches = product.media.filter((media) => mediaUrl(media) === expected.sourceUrl)
  assert(mediaMatches.length === 1, `Expected one Spigen A16 gallery image, found ${mediaMatches.length}`)
  assert(mediaMatches[0].alt === expected.mediaAlt, 'Spigen A16 media identity changed')

  const [first, second] = await Promise.all([
    fetchBytes(expected.sourceUrl, 'image/jpeg'),
    fetchBytes(expected.sourceUrl, 'image/jpeg'),
  ])
  assert(first.contentType.startsWith('image/jpeg') && second.contentType.startsWith('image/jpeg'), 'Spigen A16 source was not JPEG')
  assert(first.buffer.equals(second.buffer), 'Repeated Spigen A16 image responses differ')
  assert(sha256(first.buffer) === expected.expectedEncodedSha256, 'Spigen A16 source hash changed')
  const decoded = await sharp(first.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === expected.expectedWidth, 'Spigen A16 source width changed')
  assert(decoded.info.height === expected.expectedHeight, 'Spigen A16 source height changed')
  assert(decoded.info.channels === 3, 'Spigen A16 source channels changed')

  let writeStatus = 'already-current'
  try {
    const localBytes = await readFile(expected.sourcePath)
    assert(localBytes.equals(first.buffer), 'Local A16 source differs from the repeated online response')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(path.dirname(expected.sourcePath), { recursive: true })
    await writeFile(expected.sourcePath, first.buffer)
    writeStatus = 'written'
  }
  return {
    bytes: first.buffer,
    evidence: {
      productRecordUrl: expected.productRecordUrl,
      productRecordFinalUrl: productResponse.finalUrl,
      productRecordHttpStatus: 200,
      sourceUrl: expected.sourceUrl,
      sourceFinalUrl: first.finalUrl,
      sourceHttpStatus: 200,
      repeatedFetchByteIdentical: true,
      productRecordVerified: true,
      productRecord: {
        productId: String(product.id),
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku,
        gtin: variant.barcode,
        mediaAlt: mediaMatches[0].alt,
      },
      path: expected.sourcePath,
      encodedSha256: sha256(first.buffer),
      decodedPixelSha256: sha256(decoded.data),
      format: 'jpeg',
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      writeStatus,
    },
  }
}

async function verifyOfficialDimension(manifest) {
  const dimension = manifest.officialDimension
  assert(dimension.apiQuery.modelCode === dimension.modelCode, 'Samsung API model code mismatch')
  const apiUrl = new URL(dimension.apiEndpoint)
  for (const [key, value] of Object.entries(dimension.apiQuery)) apiUrl.searchParams.set(key, value)
  const [pageResponse, apiResponse] = await Promise.all([
    fetchBytes(dimension.sourcePageUrl, 'text/html'),
    fetchBytes(apiUrl, 'application/json'),
  ])
  assert(pageResponse.contentType.includes('text/html'), 'Samsung A16 product response was not HTML')
  const pageText = normalizeText(pageResponse.buffer.toString('utf8'))
  for (const expected of [dimension.modelName, dimension.modelCode, dimension.supportModel]) {
    assert(pageText.includes(expected), `Samsung A16 product identity changed: ${expected}`)
  }
  assert(apiResponse.contentType.includes('json'), 'Samsung A16 model API response was not JSON')
  const payload = JSON.parse(apiResponse.buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, 'Samsung A16 model API status changed')
  assert(payload.response?.siteCode === dimension.apiQuery.siteCode, 'Samsung A16 model API site changed')
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const items = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const matches = items.filter((item) => (
    item.SpecItemNameLevel2 === dimension.reportedLabel
    && item.SpecItemkeyLevel2 === dimension.specItemKey
    && item.SpecItemIdLevel2 === dimension.specItemId
  ))
  assert(matches.length === 1, `Expected one exact Samsung A16 dimension item, found ${matches.length}`)
  assert(normalizeText(matches[0].SpecItemValue) === dimension.reportedValue, 'Samsung A16 dimensions changed')
  const plmGroups = asArray(payload.response?.resultData?.Products?.Product?.PlmSpec)
  const plmItems = plmGroups.flatMap((group) => asArray(group.PlmSpecItems?.PlmSpecItem))
  for (const expected of dimension.plmItems) {
    const match = plmItems.find((item) => item.UserKey === expected.userKey)
    assert(match, `Samsung A16 PLM dimension is missing: ${expected.userKey}`)
    assert(normalizeText(match.ItemPath) === expected.itemPath, `Samsung A16 PLM path changed: ${expected.userKey}`)
    assert(match.SpecValue === expected.value, `Samsung A16 PLM value changed: ${expected.userKey}`)
  }
  return {
    ...dimension,
    sourcePageFinalUrl: pageResponse.finalUrl,
    sourcePageHttpStatus: 200,
    apiUrl: String(apiUrl),
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    reportedValueFound: true,
    plmDimensionsVerified: true,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(manifest.schemaVersion === 1, 'Unsupported A16 source manifest schema')
  assert(manifest.targetModelId === 'galaxy-a16', 'Unexpected A16 target model')
  assert(manifest.targetModelName === 'Galaxy A16 5G', 'Unexpected A16 target name')
  assert(manifest.sourceModelId === 'galaxy-a16-5g', 'Unexpected A16 source model')

  const [catalogIdentityEvidence, spigen, officialDimensionEvidence] = await Promise.all([
    verifyCatalogIdentity(manifest),
    verifySpigenSource(manifest),
    verifyOfficialDimension(manifest),
  ])
  const eligibilityReason = 'The canonical case inventory explicitly identifies galaxy-a16 as Galaxy A16 5G; the official Spigen variant, SKU ACS08891, GTIN, and media identify the complete real Galaxy A16 5G Rugged Armor shell; Samsung independently identifies SM-A166BZKDEUB and reports 164.4 x 77.9 x 7.9 mm.'
  const asset = {
    targetModelId: manifest.targetModelId,
    targetModelName: manifest.targetModelName,
    sourceModelId: manifest.sourceModelId,
    sourceKind: 'official-spigen-empty-case-image',
    derivedSourceKind: 'derived-official-source',
    publicationEligible: true,
    eligibilityReason,
    geometryReview: manifest.product.geometryReview,
    geometrySource: 'The byte-locked official Spigen inner-case image directly supplies the complete physical outer silhouette and every visible camera opening of the empty Galaxy A16 5G shell.',
    productRecordUrl: spigen.evidence.productRecordUrl,
    sourceUrl: spigen.evidence.sourceUrl,
    path: spigen.evidence.path,
    encodedSha256: spigen.evidence.encodedSha256,
    decodedPixelSha256: spigen.evidence.decodedPixelSha256,
    repeatedFetchByteIdentical: spigen.evidence.repeatedFetchByteIdentical,
    productRecordVerified: spigen.evidence.productRecordVerified,
    productRecord: spigen.evidence.productRecord,
    format: spigen.evidence.format,
    width: spigen.evidence.width,
    height: spigen.evidence.height,
    channels: spigen.evidence.channels,
    writeStatus: spigen.evidence.writeStatus,
    catalogIdentityEvidence,
    onlineSourceEvidence: spigen.evidence,
    officialDimensionEvidence,
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Canonical Galaxy A16 5G catalog identity, repeated-byte official Spigen empty-shell image, and first-party Samsung model API dimensions',
    summary: {
      assets: 1,
      catalogIdentitiesVerified: 1,
      productRecordsVerified: 1,
      repeatedSourceFetchesByteIdentical: 1,
      sourceImagesPixelVerified: 1,
      officialDimensionsVerified: 1,
      publicationEligible: 1,
    },
    assets: [asset],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()