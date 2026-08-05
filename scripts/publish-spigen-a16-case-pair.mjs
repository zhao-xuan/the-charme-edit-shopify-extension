#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a16-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-spigen-a16-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-a16',
  modelName: 'Galaxy A16 5G',
  sourceModelId: 'galaxy-a16-5g',
  productId: '7295548358703',
  sku: 'ACS08891',
  gtin: '8809971237215',
  modelCode: 'SM-A166BZKDEUB',
  widthMm: 77.9,
  heightMm: 164.4,
  depthMm: 7.9,
  reportedValue: '164.4 x 77.9 x 7.9',
  thresholds: [11, 12, 13],
  primaryThreshold: 12,
  openingProfile: 'galaxy-a16-camera-and-flash-single',
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
assert(review.models.length === 1 && review.models[0].modelId === EXPECTED.modelId, 'Reviewed A16 model changed')

const model = review.models[0]
assert(model.modelName === EXPECTED.modelName, 'Reviewed A16 name changed')
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy A16 5G is not accepted')
assert(model.visualReview?.status === 'accepted', 'A16 visual review is not accepted')
assert(model.catalogIdentityEvidence?.matchedModel?.id === EXPECTED.modelId, 'A16 canonical model ID changed')
assert(model.catalogIdentityEvidence?.matchedModel?.name === EXPECTED.modelName, 'A16 canonical model name changed')
assert(model.officialSource?.productRecord?.productId === EXPECTED.productId, 'Spigen product ID changed')
assert(model.officialSource?.productRecord?.sku === EXPECTED.sku, 'Spigen SKU changed')
assert(model.officialSource?.productRecord?.gtin === EXPECTED.gtin, 'Spigen GTIN changed')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official A16 width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official A16 height changed')
assert(model.officialDimensions?.depthMm === EXPECTED.depthMm, 'Official A16 depth changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official A16 dimension value changed')
const dimensionEvidence = model.officialDimensions?.directPageVerification?.evidence
assert(dimensionEvidence?.modelCode === EXPECTED.modelCode, 'Samsung A16 model code changed')
assert(dimensionEvidence?.sourcePageHttpStatus === 200, 'Samsung A16 page evidence is incomplete')
assert(dimensionEvidence?.apiStatusCode === 200, 'Samsung A16 API evidence is incomplete')
assert(dimensionEvidence?.reportedValueFound && dimensionEvidence?.plmDimensionsVerified, 'Samsung A16 dimensions are not fully verified')

const geometry = model.geometryQa
assert(geometry.sourceGeometry.primaryThreshold === EXPECTED.primaryThreshold, 'A16 primary threshold changed')
assertExactArray(geometry.sourceGeometry.stabilityThresholds, EXPECTED.thresholds, 'A16 threshold band')
assert(geometry.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'A16 minimum IoU policy changed')
assert(geometry.sourceGeometry.allowedMaximumBoundsDrift === 4, 'A16 maximum bounds drift policy changed')
assert(geometry.sourceGeometry.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'A16 threshold stability failed')
assert(geometry.sourceGeometry.maximumBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'A16 threshold bounds drift failed')
assert(geometry.transform.spatialTransform === 'source-axis crop with fixed transparent padding only', 'A16 spatial transform changed')
assert(geometry.transform.morphologyOperations === 0, 'A16 morphology is forbidden')
assert(geometry.transform.inferredBoundaryPixels === 0, 'A16 boundary pixels were inferred')
assert(geometry.transform.inferredOpeningPixels === 0, 'A16 opening pixels were inferred')
assert(geometry.transform.sourceVisibleOpeningTransform.clearedPixels === 0, 'A16 source opening pixels were replaced')
assert(geometry.openingQaPassed && geometry.expectedOpeningCount === 1, 'A16 exact one-opening QA failed')
assert(geometry.significantOpenings.length === 1, 'A16 significant opening count changed')
assert(geometry.significantOpenings[0].openingId === EXPECTED.openingId, 'A16 opening identity changed')
assert(geometry.significantOpenings[0].pixels === geometry.decodedOpeningComponents[0].pixels, 'A16 decoded opening pixels changed')
assert(geometry.transform.enclosedArtifactCleanup.includes(EXPECTED.openingProfile), 'A16 opening profile changed')

const overlay = model.visualReview.evidence
assert(overlay.geometryUse === 'visual review only; never sampled by candidate generation', 'A16 visual overlay role changed')
const overlayBytes = await readFile(overlay.path)
assert(sha256(overlayBytes) === overlay.encodedSha256, 'A16 visual review overlay changed')

const publisherArguments = [PUBLISHER_PATH]
for (const finish of ['black', 'white']) {
  const output = model[finish]
  assert(output?.sourceKind === 'derived-official-source', `${finish}: A16 source kind changed`)
  const bytes = await readFile(output.path)
  assert(sha256(bytes) === output.sha256, `${finish}: reviewed A16 SHA-256 changed`)
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