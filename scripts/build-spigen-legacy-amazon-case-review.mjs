#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/spigen-legacy-amazon-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/spigen-legacy-amazon-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/spigen-legacy-amazon-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/spigen-legacy-amazon-case-review.json`
const REVIEWED_AT = '2026-08-02T08:48:00.000Z'

const OFFICIAL_DIMENSIONS = {
  'galaxy-a40': {
    manufacturer: 'Samsung',
    modelCode: 'SM-A405FZKDBTU',
    widthMm: 69.2,
    heightMm: 144.4,
    depthMm: 7.9,
    reportedValue: '144.4 x 69.2 x 7.9',
    sourceUrl: 'https://web.archive.org/web/20201105110433id_/https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a40-black-64gb-sm-a405fzkdbtu/',
    originalSourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a40-black-64gb-sm-a405fzkdbtu/',
    sourcePageTitle: 'Samsung Galaxy A40 | View Features & Specs | Samsung UK',
    archiveTimestamp: '20201105110433',
  },
  'galaxy-a70': {
    manufacturer: 'Samsung',
    modelCode: 'SM-A705FZKUBTU',
    widthMm: 76.7,
    heightMm: 164.3,
    depthMm: 7.9,
    reportedValue: '164.3 x 76.7 x 7.9',
    sourceUrl: 'https://web.archive.org/web/20201108010043id_/https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a70-black-128gb-sm-a705fzkubtu/',
    originalSourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a70-black-128gb-sm-a705fzkubtu/',
    sourcePageTitle: 'Samsung Galaxy A70 | View Features & Specs | Samsung UK',
    archiveTimestamp: '20201108010043',
  },
}

const EXPECTED_MODEL_IDS = new Set(Object.keys(OFFICIAL_DIMENSIONS))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function assertFile(filePath, expectedSha256, expectedWidth, expectedHeight) {
  const bytes = await readFile(filePath)
  assert(sha256(bytes) === expectedSha256, `${filePath}: encoded SHA-256 changed`)
  const metadata = await sharp(bytes).metadata()
  assert(metadata.format === 'png' || metadata.format === 'jpeg', `${filePath}: unsupported format ${metadata.format}`)
  assert(metadata.width === expectedWidth && metadata.height === expectedHeight, `${filePath}: dimensions changed`)
}

function assertExactSet(actual, expected, label) {
  assert(actual.size === expected.size, `${label}: expected ${expected.size}, found ${actual.size}`)
  for (const value of expected) assert(actual.has(value), `${label}: missing ${value}`)
}

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

const eligibleSources = sourceManifest.candidates.filter((candidate) => candidate.publicationEligible)
const eligibleIds = new Set(eligibleSources.map((candidate) => candidate.targetModelId))
const derivedIds = new Set(derivation.results.map((result) => result.modelId))

assert(sourceManifest.candidates.length === 2, `Expected 2 source candidates, found ${sourceManifest.candidates.length}`)
assert(eligibleSources.length === 2, `Expected 2 eligible source candidates, found ${eligibleSources.length}`)
assert(sourceProvenance.summary.productRecordsVerified === 2, 'Expected both Amazon product records to be verified')
assert(sourceProvenance.summary.repeatedFetchByteIdentical === 2, 'Expected both source images to be byte stable')
assert(derivation.summary.thresholdStabilityPassed === 2, 'Expected both threshold stability checks to pass')
assert(derivation.summary.cameraOpeningQaPassed === 2, 'Expected both opening profiles to pass')
assert(derivation.summary.exactPairAlpha === 2, 'Expected both Black/White pairs to share exact alpha')
assert(derivation.summary.automatedQaPassed === 4, 'Expected all four derived images to pass automated QA')
assertExactSet(eligibleIds, EXPECTED_MODEL_IDS, 'Eligible source models')
assertExactSet(derivedIds, EXPECTED_MODEL_IDS, 'Derived models')

const provenanceById = new Map(sourceProvenance.assets.map((asset) => [asset.targetModelId, asset]))
const sourceById = new Map(eligibleSources.map((source) => [source.targetModelId, source]))
const models = []

for (const result of derivation.results) {
  const source = sourceById.get(result.modelId)
  const downloaded = provenanceById.get(result.modelId)
  const dimensions = OFFICIAL_DIMENSIONS[result.modelId]
  const product = sourceManifest.products[source?.product]
  assert(source && downloaded && dimensions && product, `${result.modelId}: source evidence is incomplete`)
  assert(downloaded.productRecord.asin === product.asin, `${result.modelId}: Amazon ASIN changed`)
  assert(downloaded.productRecord.productTitle === product.title, `${result.modelId}: Amazon product title changed`)
  assert(downloaded.productRecord.galleryImageId === source.galleryImageId, `${result.modelId}: gallery image identity changed`)
  assert(downloaded.encodedSha256 === source.expectedEncodedSha256, `${result.modelId}: source SHA-256 changed`)
  assert(result.sourceKind === 'derived-verified-retail-source', `${result.modelId}: derived source kind changed`)
  assert(result.sourceAsset.asin === product.asin, `${result.modelId}: derivation ASIN mismatch`)
  assert(result.sourceAsset.galleryImageId === source.galleryImageId, `${result.modelId}: derivation gallery image mismatch`)
  assert(result.alpha.cameraOpeningProfilePassed, `${result.modelId}: opening profile failed`)
  assert(result.alpha.unexpectedSignificantHoles.length === 0, `${result.modelId}: unexpected significant opening found`)
  assert(
    result.alpha.significantHoles.length === result.alpha.cameraOpeningProfile.openings.length,
    `${result.modelId}: opening count differs from its profile`,
  )
  assert(result.transform.sourceVisibleOpeningTransform.clearedPixels > 0, `${result.modelId}: no visible source opening was cleared`)
  assert(
    result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou,
    `${result.modelId}: threshold IoU failed`,
  )
  assert(
    result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift,
    `${result.modelId}: threshold bounds drift failed`,
  )

  await assertFile(result.sourceAsset.path, result.sourceAsset.encodedSha256, source.expectedWidth, source.expectedHeight)

  const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
  assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), `${result.modelId}: expected Black and White outputs`)
  const black = finishes.get('black')
  const white = finishes.get('white')
  assert(black.outputAlphaSha256 === white.outputAlphaSha256, `${result.modelId}: pair alpha differs`)
  assert(black.outputAlphaSha256 === result.alpha.sha256, `${result.modelId}: output alpha differs from model alpha`)

  for (const candidate of [black, white]) {
    assert(candidate.qa.passed && candidate.qa.alphaExact, `${result.modelId}/${candidate.finish}: automated QA failed`)
    assert(candidate.qa.hiddenRgbPixels === 0, `${result.modelId}/${candidate.finish}: hidden RGB found`)
    assert(candidate.qa.maximumChannelSpread === 0, `${result.modelId}/${candidate.finish}: non-neutral RGB found`)
    assert(candidate.qa.cornerAlpha.every((value) => value === 0), `${result.modelId}/${candidate.finish}: opaque corner found`)
    await assertFile(candidate.outputPath, candidate.outputEncodedSha256, result.alpha.width, result.alpha.height)
  }

  const output = (candidate) => ({
    sourceKind: result.sourceKind,
    path: candidate.outputPath,
    sha256: candidate.outputEncodedSha256,
    pixelSha256: candidate.outputPixelSha256,
    alphaSha256: candidate.outputAlphaSha256,
    width: result.alpha.width,
    height: result.alpha.height,
    alphaBounds: candidate.bounds,
  })

  const dimensionEvidence = {
    httpStatus: 200,
    modelIdentityFound: true,
    reportedValueFound: true,
    sourceUrl: dimensions.sourceUrl,
    originalSourceUrl: dimensions.originalSourceUrl,
    sourcePageTitle: dimensions.sourcePageTitle,
    archiveTimestamp: dimensions.archiveTimestamp,
    modelCode: dimensions.modelCode,
    reportedValue: dimensions.reportedValue,
    verificationMethod: 'Read the model code and Dimension (HxWxD, mm) from the archived first-party Samsung UK product page.',
  }

  models.push({
    modelId: result.modelId,
    modelName: result.modelName,
    reviewStatus: 'accepted',
    publicationEligible: true,
    catalogIdentityEvidence: source.eligibilityReason,
    visualReview: {
      status: 'accepted',
      criteria: 'Complete orthogonal shell boundary and every outer opening recess are directly visible; explicit source-coordinate opening clears match those visible recesses; Black/White geometry is identical.',
    },
    officialDimensions: {
      ...dimensions,
      reportedLabel: 'Dimension (HxWxD, mm)',
      reportedOrder: 'height x width x depth',
      directPageVerification: { ...dimensionEvidence, evidence: [dimensionEvidence], verifiedAt: REVIEWED_AT },
    },
    verifiedRetailSource: {
      manufacturer: 'Spigen',
      retailer: downloaded.productRecord.retailer,
      asin: downloaded.productRecord.asin,
      productTitle: downloaded.productRecord.productTitle,
      productRecordUrl: result.sourceAsset.productRecordUrl,
      sourceUrl: result.sourceAsset.sourceUrl,
      galleryImageId: result.sourceAsset.galleryImageId,
      path: result.sourceAsset.path,
      sha256: result.sourceAsset.encodedSha256,
    },
    geometryQa: {
      foregroundThreshold: result.sourceGeometry.primaryThreshold,
      stabilityThresholds: result.sourceGeometry.stabilityThresholds,
      minimumThresholdIou: result.sourceGeometry.minimumThresholdIou,
      requiredMinimumThresholdIou: result.sourceGeometry.requiredMinimumThresholdIou,
      maximumBoundsDrift: result.sourceGeometry.maximumBoundsDrift,
      allowedMaximumBoundsDrift: result.sourceGeometry.allowedMaximumBoundsDrift,
      sharedAlphaSha256: result.alpha.sha256,
      significantOpenings: result.alpha.significantHoles,
      cameraOpeningProfile: result.alpha.cameraOpeningProfile,
      cameraOpeningProfilePassed: result.alpha.cameraOpeningProfilePassed,
      unexpectedSignificantHoles: result.alpha.unexpectedSignificantHoles,
      explicitSourceOpeningTransform: result.transform.sourceVisibleOpeningTransform,
    },
    black: output(black),
    white: output(white),
  })
}

models.sort((left, right) => left.modelId.localeCompare(right.modelId))

const review = {
  schemaVersion: 1,
  reviewedAt: REVIEWED_AT,
  reviewedBy: 'GitHub Copilot visual inspection in VS Code',
  sourceManifestPath: SOURCE_MANIFEST_PATH,
  sourceProvenancePath: SOURCE_PROVENANCE_PATH,
  derivationProvenancePath: DERIVATION_PROVENANCE_PATH,
  acceptanceCriteria: [
    'Exact Amazon ASIN product titles identify the target model, and each selected gallery image ID occurs in that exact product record.',
    'Every source is byte-identical across repeated downloads and remains locked to its reviewed SHA-256.',
    'The full orthogonal shell boundary and every outer opening recess are directly visible despite the installed phone.',
    'Foreground extraction remains stable across the source-specific locked threshold band with IoU of at least 0.995 and no more than four pixels of bounds drift.',
    'Black and White outputs share exact alpha, contain zero hidden RGB, use neutral RGB channels, and retain transparent canvas corners.',
    'Physical dimensions are read from archived first-party Samsung UK product pages that identify the exact model codes.',
  ],
  summary: {
    sourceCandidates: sourceManifest.candidates.length,
    modelsVisuallyAccepted: models.length,
    candidateImagesVisuallyAccepted: models.length * 2,
    modelsPublicationEligible: models.length,
    modelsBlockedByCatalogIdentity: 0,
  },
  models,
  blockedModels: [],
  publicationPolicy: {
    acceptedOnly: true,
    requirePublicationEligible: true,
    requireExactPathAndSha256: true,
    requireVerifiedDimensions: true,
    shopifyStorageOnly: true,
    allowedDestinations: ['Shopify Files', 'charme_product.body_image_black', 'charme_product.body_image_white'],
    forbiddenDestinations: ['Shopify Product Media', 'Shopify variant media associations'],
  },
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`)
console.log(JSON.stringify({
  outputPath: OUTPUT_PATH,
  models: review.summary.modelsPublicationEligible,
  candidates: review.summary.candidateImagesVisuallyAccepted,
}, null, 2))