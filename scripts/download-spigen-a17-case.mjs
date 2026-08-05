#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a17-case-sources.json'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a17-case-asset-provenance.json'

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
  const audit = JSON.parse(await readFile(manifest.catalogIdentity.coverageAuditPath, 'utf8'))
  const matches = audit.gapModels.filter((model) => model.modelId === manifest.catalogIdentity.coverageModelId)
  assert(matches.length === 1, `Expected one live A17 catalog record, found ${matches.length}`)
  const model = matches[0]
  assert(model.modelId === manifest.targetModelId, 'Live A17 model ID changed')
  assert(model.modelName === manifest.targetModelName, 'Live A17 model name changed')
  assert(model.modelName === manifest.catalogIdentity.coverageModelName, 'A17 catalog identity evidence changed')
  return {
    ...manifest.catalogIdentity,
    matchedModel: { id: model.modelId, name: model.modelName, platform: model.platform },
    verified: true,
  }
}

async function verifyImagePair(expected, label) {
  const [first, second] = await Promise.all([
    fetchBytes(expected.sourceUrl, 'image/jpeg'),
    fetchBytes(expected.sourceUrl, 'image/jpeg'),
  ])
  assert(first.contentType.startsWith('image/jpeg') && second.contentType.startsWith('image/jpeg'), `${label} was not JPEG`)
  assert(first.buffer.equals(second.buffer), `Repeated ${label} responses differ`)
  assert(sha256(first.buffer) === expected.expectedEncodedSha256, `${label} hash changed`)
  const decoded = await sharp(first.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === expected.expectedWidth, `${label} width changed`)
  assert(decoded.info.height === expected.expectedHeight, `${label} height changed`)
  assert(decoded.info.channels === 3, `${label} channels changed`)
  return {
    bytes: first.buffer,
    evidence: {
      sourceUrl: expected.sourceUrl,
      sourceFinalUrl: first.finalUrl,
      sourceHttpStatus: 200,
      repeatedFetchByteIdentical: true,
      encodedSha256: sha256(first.buffer),
      decodedPixelSha256: sha256(decoded.data),
      format: 'jpeg',
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    },
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
  assert(variants.length === 1, `Expected one Spigen A17 SKU, found ${variants.length}`)
  const variant = variants[0]
  assert(variant.title === expected.variantTitle, 'Spigen A17 variant title changed')
  assert(variant.barcode === expected.gtin, 'Spigen A17 GTIN changed')
  const sourceMedia = product.media.filter((media) => mediaUrl(media) === expected.sourceUrl)
  assert(sourceMedia.length === 1, `Expected one Spigen A17 geometry image, found ${sourceMedia.length}`)
  assert(sourceMedia[0].alt === expected.mediaAlt, 'Spigen A17 geometry media identity changed')
  const compatibilityMedia = product.media.filter((media) => mediaUrl(media) === expected.compatibilityMedia.sourceUrl)
  assert(compatibilityMedia.length === 1, `Expected one Spigen A17 compatibility image, found ${compatibilityMedia.length}`)
  assert(compatibilityMedia[0].alt === expected.compatibilityMedia.alt, 'Spigen A17 compatibility statement changed')
  assert(compatibilityMedia[0].alt.includes('Designed for Galaxy A17/A17 5G'), 'Spigen no longer states A17/A17 5G compatibility')

  const [source, compatibility] = await Promise.all([
    verifyImagePair(expected, 'Spigen A17 geometry source'),
    verifyImagePair(expected.compatibilityMedia, 'Spigen A17 compatibility evidence'),
  ])
  let writeStatus = 'already-current'
  try {
    const localBytes = await readFile(expected.sourcePath)
    assert(localBytes.equals(source.bytes), 'Local A17 source differs from the repeated online response')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(path.dirname(expected.sourcePath), { recursive: true })
    await writeFile(expected.sourcePath, source.bytes)
    writeStatus = 'written'
  }
  return {
    evidence: {
      productRecordUrl: expected.productRecordUrl,
      productRecordFinalUrl: productResponse.finalUrl,
      productRecordHttpStatus: 200,
      productRecordVerified: true,
      productRecord: {
        productId: String(product.id),
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku,
        gtin: variant.barcode,
        mediaAlt: sourceMedia[0].alt,
        compatibilityMediaAlt: compatibilityMedia[0].alt,
      },
      ...source.evidence,
      path: expected.sourcePath,
      writeStatus,
      compatibilityEvidence: {
        mediaAlt: compatibilityMedia[0].alt,
        ...compatibility.evidence,
      },
    },
  }
}

async function verifyOfficialModel(model) {
  assert(model.apiQuery.modelCode === model.modelCode, `Samsung ${model.network} API model code mismatch`)
  const apiUrl = new URL(model.apiEndpoint)
  for (const [key, value] of Object.entries(model.apiQuery)) apiUrl.searchParams.set(key, value)
  const [pageResponse, apiResponse] = await Promise.all([
    fetchBytes(model.sourcePageUrl, 'text/html'),
    fetchBytes(apiUrl, 'application/json'),
  ])
  assert(pageResponse.contentType.includes('text/html'), `Samsung A17 ${model.network} product response was not HTML`)
  const pageText = normalizeText(pageResponse.buffer.toString('utf8'))
  for (const expected of [model.modelName, model.modelCode, model.supportModel].filter(Boolean)) {
    assert(pageText.includes(expected), `Samsung A17 ${model.network} product identity changed: ${expected}`)
  }
  assert(apiResponse.contentType.includes('json'), `Samsung A17 ${model.network} model API response was not JSON`)
  const payload = JSON.parse(apiResponse.buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, `Samsung A17 ${model.network} model API status changed`)
  assert(payload.response?.siteCode === model.apiQuery.siteCode, `Samsung A17 ${model.network} model API site changed`)
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const items = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const dimensions = items.filter((item) => (
    item.SpecItemNameLevel2 === model.reportedLabel
    && item.SpecItemkeyLevel2 === model.specItemKey
    && item.SpecItemIdLevel2 === model.specItemId
  ))
  assert(dimensions.length === 1, `Expected one exact Samsung A17 ${model.network} dimension item, found ${dimensions.length}`)
  assert(normalizeText(dimensions[0].SpecItemValue) === model.reportedValue, `Samsung A17 ${model.network} dimensions changed`)
  const infra = items.find((item) => item.SpecItemNameLevel2 === 'Infra')
  assert(infra?.SpecItemValue.includes(model.expectedInfraIncludes), `Samsung A17 ${model.network} network identity changed`)
  if (model.expectedInfraExcludes) {
    assert(!infra.SpecItemValue.includes(model.expectedInfraExcludes), `Samsung A17 ${model.network} unexpectedly includes ${model.expectedInfraExcludes}`)
  }
  const plmGroups = asArray(payload.response?.resultData?.Products?.Product?.PlmSpec)
  const plmItems = plmGroups.flatMap((group) => asArray(group.PlmSpecItems?.PlmSpecItem))
  for (const expected of model.plmItems) {
    const match = plmItems.find((item) => item.UserKey === expected.userKey)
    assert(match, `Samsung A17 ${model.network} PLM dimension is missing: ${expected.userKey}`)
    assert(normalizeText(match.ItemPath) === expected.itemPath, `Samsung A17 ${model.network} PLM path changed: ${expected.userKey}`)
    assert(match.SpecValue === expected.value, `Samsung A17 ${model.network} PLM value changed: ${expected.userKey}`)
  }
  return {
    ...model,
    sourcePageFinalUrl: pageResponse.finalUrl,
    sourcePageHttpStatus: 200,
    apiUrl: String(apiUrl),
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    reportedValueFound: true,
    networkIdentityVerified: true,
    plmDimensionsVerified: true,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(manifest.schemaVersion === 1, 'Unsupported A17 source manifest schema')
  assert(manifest.targetModelId === 'galaxy-a17', 'Unexpected A17 target model')
  assert(manifest.targetModelName === 'Galaxy A17', 'Unexpected A17 target name')
  assert(manifest.sourceModelId === 'galaxy-a17-5g', 'Unexpected A17 source model')
  assert(manifest.officialModels.length === 2, 'Expected Samsung A17 4G and 5G evidence')

  const [catalogIdentityEvidence, spigen, officialModels] = await Promise.all([
    verifyCatalogIdentity(manifest),
    verifySpigenSource(manifest),
    Promise.all(manifest.officialModels.map(verifyOfficialModel)),
  ])
  assert(new Set(officialModels.map((model) => model.network)).size === 2, 'Samsung A17 network identities are not distinct')
  assert(new Set(officialModels.map((model) => model.reportedValue)).size === 1, 'Samsung A17 4G and 5G dimensions differ')
  const eligibilityReason = 'The live catalog identifies Galaxy A17; Spigen SKU ACS09844 supplies a complete real empty shell and its same-SKU official media explicitly states Designed for Galaxy A17/A17 5G; Samsung independently verifies the 4G SM-A175F and 5G SM-A176B devices at the same 164.4 x 77.9 x 7.5 mm dimensions.'
  const asset = {
    targetModelId: manifest.targetModelId,
    targetModelName: manifest.targetModelName,
    sourceModelId: manifest.sourceModelId,
    sourceKind: 'official-spigen-empty-case-image',
    derivedSourceKind: 'derived-official-source',
    publicationEligible: true,
    eligibilityReason,
    geometryReview: manifest.product.geometryReview,
    geometrySource: 'The byte-locked official Spigen inner-case image directly supplies the complete physical outer silhouette and every visible camera opening of the real Galaxy A17/A17 5G-compatible shell.',
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
    officialModelEvidence: officialModels,
    officialDimensionEvidence: {
      reportedLabel: officialModels[0].reportedLabel,
      reportedValue: officialModels[0].reportedValue,
      heightMm: officialModels[0].heightMm,
      widthMm: officialModels[0].widthMm,
      depthMm: officialModels[0].depthMm,
      models: officialModels,
      crossNetworkDimensionsExact: true,
    },
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Live Galaxy A17 catalog identity, repeated-byte official Spigen A17/A17 5G-compatible empty-shell evidence, and first-party Samsung 4G/5G model API dimensions',
    summary: {
      assets: 1,
      catalogIdentitiesVerified: 1,
      productRecordsVerified: 1,
      compatibilityStatementsVerified: 1,
      repeatedSourceFetchesByteIdentical: 2,
      sourceImagesPixelVerified: 2,
      officialModelsVerified: officialModels.length,
      officialDimensionsVerified: officialModels.length,
      crossNetworkDimensionsExact: 1,
      publicationEligible: 1,
    },
    assets: [asset],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()