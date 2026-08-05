#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a17-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-spigen-a17-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-a17',
  modelName: 'Galaxy A17',
  sourceModelId: 'galaxy-a17-5g',
  productId: '7295548358703',
  sku: 'ACS09844',
  gtin: '8800283312409',
  compatibilityText: 'Designed for Galaxy A17/A17 5G',
  modelCodes: ['SM-A175FZKNMEA', 'SM-A176BZKAEUB'],
  networks: ['4G', '5G'],
  widthMm: 77.9,
  heightMm: 164.4,
  depthMm: 7.5,
  reportedValue: '164.4 x 77.9 x 7.5',
  thresholds: [11, 12, 13],
  primaryThreshold: 12,
  openingProfile: 'galaxy-a17-camera-and-flash-single',
  openingId: 'camera-and-flash',
}

const modeFlags = ['--verify', '--apply'].filter((flag) => process.argv.includes(flag))
if (modeFlags.length > 1) throw new Error('Pass either --verify or --apply, not both')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertExactArray(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} changed`)
}

const review = JSON.parse(await readFile(REVIEW_PATH, 'utf8'))
assert(review.summary.modelsPublicationEligible === 1, 'Review must contain exactly one publication-eligible model')
assert(review.summary.candidateImagesVisuallyAccepted === 2, 'Review must contain exactly two accepted candidates')
assert(review.summary.modelsBlockedByCatalogIdentity === 0, 'Review contains a blocked identity')
assert(review.blockedModels.length === 0, 'Review blocked-model list must be empty')
assert(review.publicationPolicy.shopifyStorageOnly, 'Review must require Shopify storage-only publication')
assert(review.publicationPolicy.allowedDestinations.length === 3, 'Review contains an unexpected publication destination')
assert(review.publicationPolicy.allowedDestinations.includes('Shopify Files'), 'Review must allow Shopify Files')
assert(review.publicationPolicy.allowedDestinations.includes('charme_product.body_image_black'), 'Review must allow body_image_black')
assert(review.publicationPolicy.allowedDestinations.includes('charme_product.body_image_white'), 'Review must allow body_image_white')
assert(review.publicationPolicy.forbiddenDestinations.includes('Shopify Product Media'), 'Review must forbid Product Media')
assert(review.publicationPolicy.forbiddenDestinations.includes('Shopify variant media associations'), 'Review must forbid variant media')
assert(review.models.length === 1 && review.models[0].modelId === EXPECTED.modelId, 'Reviewed A17 model changed')

const model = review.models[0]
assert(model.modelName === EXPECTED.modelName, 'Reviewed A17 name changed')
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy A17 is not accepted')
assert(model.visualReview?.status === 'accepted', 'A17 visual review is not accepted')
assert(model.catalogIdentityEvidence?.matchedModel?.id === EXPECTED.modelId, 'A17 live catalog model ID changed')
assert(model.catalogIdentityEvidence?.matchedModel?.name === EXPECTED.modelName, 'A17 live catalog model name changed')
assert(model.officialSource?.productRecord?.productId === EXPECTED.productId, 'Spigen product ID changed')
assert(model.officialSource?.productRecord?.sku === EXPECTED.sku, 'Spigen SKU changed')
assert(model.officialSource?.productRecord?.gtin === EXPECTED.gtin, 'Spigen GTIN changed')
assert(model.officialSource?.productRecord?.compatibilityMediaAlt.includes(EXPECTED.compatibilityText), 'Spigen A17/A17 5G compatibility changed')
assert(model.compatibilityEvidence?.repeatedFetchByteIdentical, 'Spigen compatibility image was not repeated-byte verified')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official A17 width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official A17 height changed')
assert(model.officialDimensions?.depthMm === EXPECTED.depthMm, 'Official A17 depth changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official A17 dimension value changed')
assert(model.officialDimensions?.crossNetworkDimensionsExact, 'Official A17 4G/5G dimensions differ')
const dimensionEvidence = model.officialDimensions?.directPageVerification?.evidence
assert(dimensionEvidence?.crossNetworkDimensionsExact, 'Samsung A17 cross-network dimension evidence is incomplete')
assertExactArray(dimensionEvidence?.models?.map((entry) => entry.network), EXPECTED.networks, 'Samsung A17 networks')
assertExactArray(dimensionEvidence?.models?.map((entry) => entry.modelCode), EXPECTED.modelCodes, 'Samsung A17 model codes')
for (const entry of dimensionEvidence.models) {
  assert(entry.sourcePageHttpStatus === 200, `Samsung A17 ${entry.network} page evidence is incomplete`)
  assert(entry.apiStatusCode === 200, `Samsung A17 ${entry.network} API evidence is incomplete`)
  assert(entry.reportedValueFound && entry.networkIdentityVerified && entry.plmDimensionsVerified, `Samsung A17 ${entry.network} evidence is incomplete`)
  assert(entry.reportedValue === EXPECTED.reportedValue, `Samsung A17 ${entry.network} dimensions changed`)
}

const geometry = model.geometryQa
assert(geometry.sourceGeometry.primaryThreshold === EXPECTED.primaryThreshold, 'A17 primary threshold changed')
assertExactArray(geometry.sourceGeometry.stabilityThresholds, EXPECTED.thresholds, 'A17 threshold band')
assert(geometry.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'A17 minimum IoU policy changed')
assert(geometry.sourceGeometry.allowedMaximumBoundsDrift === 4, 'A17 maximum bounds drift policy changed')
assert(geometry.sourceGeometry.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'A17 threshold stability failed')
assert(geometry.sourceGeometry.maximumBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'A17 threshold bounds drift failed')
assert(geometry.transform.spatialTransform === 'source-axis crop with fixed transparent padding only', 'A17 spatial transform changed')
assert(geometry.transform.morphologyOperations === 0, 'A17 morphology is forbidden')
assert(geometry.transform.inferredBoundaryPixels === 0, 'A17 boundary pixels were inferred')
assert(geometry.transform.inferredOpeningPixels === 0, 'A17 opening pixels were inferred')
assert(geometry.transform.sourceVisibleOpeningTransform.clearedPixels === 0, 'A17 source opening pixels were replaced')
assert(geometry.openingQaPassed && geometry.expectedOpeningCount === 1, 'A17 exact one-opening QA failed')
assert(geometry.significantOpenings.length === 1, 'A17 significant opening count changed')
assert(geometry.significantOpenings[0].openingId === EXPECTED.openingId, 'A17 opening identity changed')
assert(geometry.significantOpenings[0].pixels === geometry.decodedOpeningComponents[0].pixels, 'A17 decoded opening pixels changed')
assert(geometry.transform.enclosedArtifactCleanup.includes(EXPECTED.openingProfile), 'A17 opening profile changed')

const overlay = model.visualReview.evidence
assert(overlay.geometryUse === 'visual review only; never sampled by candidate generation', 'A17 visual overlay role changed')
const overlayBytes = await readFile(overlay.path)
assert(sha256(overlayBytes) === overlay.encodedSha256, 'A17 visual review overlay changed')

const publisherArguments = [PUBLISHER_PATH]
for (const finish of ['black', 'white']) {
  const output = model[finish]
  assert(output?.sourceKind === 'derived-official-source', `${finish}: A17 source kind changed`)
  const bytes = await readFile(output.path)
  assert(sha256(bytes) === output.sha256, `${finish}: reviewed A17 SHA-256 changed`)
  publisherArguments.push('--derived-source', `${model.modelId}:${finish}:${output.path}`)
}
publisherArguments.push(
  '--create-target',
  `${model.modelId}:${model.modelName}:${model.officialDimensions.widthMm}:${model.officialDimensions.heightMm}`,
  '--report',
  REPORT_PATH,
  ...modeFlags,
)
assert(!publisherArguments.includes('--sync-product-media'), 'Product Media synchronization is forbidden')

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, publisherArguments, { env: process.env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Publisher stopped by ${signal}`))
    else if (code) reject(new Error(`Publisher exited with code ${code}`))
    else resolve()
  })
})