#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/spigen-s10e-gomibo-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/spigen-s10e-gomibo-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/spigen-s10e-gomibo-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/spigen-s10e-gomibo-case-review.json`
const MODEL_ID = 'galaxy-s10e'

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

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

assert(sourceManifest.candidates.length === 1, 'Expected exactly one S10e source candidate')
assert(sourceProvenance.assets.length === 1, 'Expected exactly one downloaded S10e source')
assert(sourceProvenance.summary.productRecordsVerified === 1, 'Expected the Gomibo product record to be verified')
assert(sourceProvenance.summary.repeatedFetchByteIdentical === 1, 'Expected the source image to be byte stable')
assert(sourceProvenance.summary.officialDimensionsVerified === 1, 'Expected Samsung dimensions to be verified')
assert(derivation.results.length === 1, 'Expected exactly one S10e derivation result')
assert(derivation.summary.thresholdStabilityPassed === 1, 'Expected threshold stability to pass')
assert(derivation.summary.cameraOpeningQaPassed === 1, 'Expected strict opening QA to pass')
assert(derivation.summary.exactPairAlpha === 1, 'Expected Black and White to share exact alpha')
assert(derivation.summary.automatedQaPassed === 2, 'Expected both derived images to pass automated QA')

const source = sourceManifest.candidates[0]
const downloaded = sourceProvenance.assets[0]
const dimensions = sourceManifest.officialDimensions[MODEL_ID]
const dimensionEvidence = sourceProvenance.officialDimensionEvidence
const product = sourceManifest.products[source.product]
const result = derivation.results[0]

assert(source.targetModelId === MODEL_ID && result.modelId === MODEL_ID, 'Unexpected model identity')
assert(source.publicationEligible, 'S10e source is not publication-eligible')
assert(downloaded.productRecordVerified, 'Gomibo product record was not verified')
assert(downloaded.productRecord.sku === product.sku, 'Gomibo SKU changed')
assert(downloaded.productRecord.gtin === product.gtin, 'Gomibo GTIN changed')
assert(downloaded.productRecord.productTitle === product.title, 'Gomibo product title changed')
assert(downloaded.productRecord.galleryImageId === source.galleryImageId, 'Gomibo gallery image changed')
assert(downloaded.encodedSha256 === source.expectedEncodedSha256, 'Source SHA-256 changed')
assert(dimensionEvidence.modelCode === dimensions.modelCode, 'Samsung model code changed')
assert(dimensionEvidence.modelIdentityFound, 'Samsung model identity evidence is incomplete')
assert(dimensionEvidence.reportedValueFound, 'Samsung dimension value was not verified')
assert(dimensionEvidence.reportedLabel === dimensions.reportedLabel, 'Samsung dimension label changed')
assert(dimensionEvidence.reportedValue === dimensions.reportedValue, 'Samsung dimensions changed')
assert(dimensionEvidence.specItemKey === dimensions.specItemKey, 'Samsung dimension item key changed')
assert(dimensionEvidence.specItemId === dimensions.specItemId, 'Samsung dimension item ID changed')
assert(result.sourceKind === 'derived-verified-retail-source', 'Derived source kind changed')
assert(result.sourceAsset.sku === product.sku, 'Derivation SKU mismatch')
assert(result.sourceAsset.gtin === product.gtin, 'Derivation GTIN mismatch')
assert(result.sourceAsset.galleryImageId === source.galleryImageId, 'Derivation gallery image mismatch')
assert(result.alpha.cameraOpeningProfile.id === 'galaxy-s10e-centered-top-single', 'Strict S10e opening profile changed')
assert(result.alpha.cameraOpeningProfilePassed, 'Strict S10e opening profile failed')
assert(result.alpha.significantHoles.length === 1, 'Expected exactly one significant S10e opening')
assert(result.alpha.unexpectedSignificantHoles.length === 0, 'Unexpected significant opening found')
assert(result.transform.sourceVisibleOpeningTransform.clearedPixels === 0, 'Empty-shell source must not use inferred opening clears')
assert(
  result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou,
  'Threshold IoU failed',
)
assert(
  result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift,
  'Threshold bounds drift failed',
)

await assertFile(result.sourceAsset.path, result.sourceAsset.encodedSha256, source.expectedWidth, source.expectedHeight)
const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), 'Expected Black and White outputs')
const black = finishes.get('black')
const white = finishes.get('white')
assert(black.outputAlphaSha256 === white.outputAlphaSha256, 'Black and White alpha differs')
assert(black.outputAlphaSha256 === result.alpha.sha256, 'Output alpha differs from model alpha')

for (const candidate of [black, white]) {
  assert(candidate.qa.passed && candidate.qa.alphaExact, `${candidate.finish}: automated QA failed`)
  assert(candidate.qa.hiddenRgbPixels === 0, `${candidate.finish}: hidden RGB found`)
  assert(candidate.qa.maximumChannelSpread === 0, `${candidate.finish}: non-neutral RGB found`)
  assert(candidate.qa.cornerAlpha.every((value) => value === 0), `${candidate.finish}: opaque corner found`)
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

const model = {
  modelId: result.modelId,
  modelName: result.modelName,
  reviewStatus: 'accepted',
  publicationEligible: true,
  catalogIdentityEvidence: source.eligibilityReason,
  visualReview: {
    status: 'accepted',
    criteria: 'The real empty shell is orthogonal and fully visible; its complete outer boundary and single centered camera opening are directly segmented from the source photograph.',
  },
  officialDimensions: {
    ...dimensions,
    directPageVerification: {
      ...dimensionEvidence,
      verifiedAt: sourceProvenance.generatedAt,
      verificationMethod: 'Verified SM-G970F and SM-G970FZKDBTU on the first-party Samsung Support UK page, then read the exact Dimension (HxWxD, mm) item from Samsung api.samsung.com/model for SM-G970FZKDBTU.',
    },
  },
  verifiedRetailSource: {
    manufacturer: 'Spigen',
    retailer: downloaded.productRecord.retailer,
    sku: downloaded.productRecord.sku,
    gtin: downloaded.productRecord.gtin,
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
}

const review = {
  schemaVersion: 1,
  reviewedAt: sourceManifest.reviewedAt,
  reviewedBy: 'GitHub Copilot visual inspection in VS Code',
  sourceManifestPath: SOURCE_MANIFEST_PATH,
  sourceProvenancePath: SOURCE_PROVENANCE_PATH,
  derivationProvenancePath: DERIVATION_PROVENANCE_PATH,
  acceptanceCriteria: [
    'The exact Gomibo product title, Spigen SKU, GTIN-13, signed gallery URL, and downloaded bytes all remain locked.',
    'The source is a real orthogonal empty-shell photograph with its complete outer boundary and camera opening directly visible.',
    'Foreground extraction remains stable at thresholds 11, 12, and 13 with IoU of at least 0.995 and no more than four pixels of bounds drift.',
    'The strict Galaxy S10e profile finds exactly one significant centered opening and no unexpected significant holes.',
    'Black and White outputs share exact alpha, contain zero hidden RGB, use neutral RGB channels, and retain transparent canvas corners.',
    'Physical dimensions come from the first-party Samsung Support identity page and Samsung model API response for SM-G970FZKDBTU.',
  ],
  summary: {
    sourceCandidates: 1,
    modelsVisuallyAccepted: 1,
    candidateImagesVisuallyAccepted: 2,
    modelsPublicationEligible: 1,
    modelsBlockedByCatalogIdentity: 0,
  },
  models: [model],
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