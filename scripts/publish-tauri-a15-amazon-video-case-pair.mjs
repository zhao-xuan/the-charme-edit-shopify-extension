#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/tauri-a15-amazon-video-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-tauri-a15-amazon-video-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-a15-4g-5g',
  asin: 'B0CRDYG64S',
  accessoryCode: 'EF-QA156CTEGWW',
  compatibility: 'Galaxy A15 5G/LTE',
  widthMm: 76.8,
  heightMm: 160.1,
  reportedValue: '160.1 x 76.8 x 8.4',
  silhouetteThresholds: [79, 80, 81],
  openingThresholds: [114, 115, 116],
  openingIds: ['upper-camera', 'middle-camera', 'lower-camera', 'flash'],
  silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
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

function assertExactSet(actual, expected, label) {
  assert(actual.size === expected.size, `${label}: expected ${expected.size}, found ${actual.size}`)
  for (const value of expected) assert(actual.has(value), `${label}: missing ${value}`)
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
assert(review.models.length === 1 && review.models[0].modelId === EXPECTED.modelId, 'Reviewed model changed')

const model = review.models[0]
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy A15 4G / 5G is not accepted')
assert(model.visualReview?.status === 'accepted', 'A15 visual review is not accepted')
assert(model.verifiedRetailSource?.asin === EXPECTED.asin, 'Amazon ASIN changed')
assert(model.verifiedRetailSource?.silhouetteFrame?.frameTimestampSeconds === 17.8, 'Silhouette frame changed')
assert(model.verifiedRetailSource?.openingFrame?.frameTimestampSeconds === 6.5, 'Opening frame changed')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official height changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official dimension value changed')
assert(model.officialDimensions?.sharedCaseCompatibility?.compatibilityVerified, 'Samsung shared-case compatibility is not verified')
assert(model.officialDimensions.sharedCaseCompatibility.accessoryCode === EXPECTED.accessoryCode, 'Samsung accessory code changed')
assert(model.officialDimensions.sharedCaseCompatibility.reportedValue === EXPECTED.compatibility, 'Samsung compatibility value changed')
const dimensionEvidence = model.officialDimensions.directPageVerification?.evidence || []
assert(dimensionEvidence.length === 2, 'Expected LTE and 5G dimension evidence')
assertExactSet(new Set(dimensionEvidence.map((evidence) => evidence.network)), new Set(['LTE', '5G']), 'Dimension networks')
assert(dimensionEvidence.every((evidence) => evidence.apiStatusCode === 200 && evidence.reportedValueFound), 'Samsung dimension evidence is incomplete')
assert(dimensionEvidence.every((evidence) => evidence.reportedValue === EXPECTED.reportedValue), 'LTE and 5G dimensions differ')

const geometry = model.geometryQa
assertExactArray(geometry.sourceGeometry.stabilityThresholds, EXPECTED.silhouetteThresholds, 'Silhouette threshold band')
assert(geometry.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'Silhouette IoU policy changed')
assert(geometry.sourceGeometry.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'Silhouette threshold stability failed')
assert(geometry.sourceGeometry.maximumBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'Silhouette bounds drift failed')
assertExactArray(geometry.openingFrameGeometry.stabilityThresholds, EXPECTED.openingThresholds, 'Opening threshold band')
assert(geometry.openingFrameGeometry.requiredMinimumThresholdIou === 0.995, 'Opening IoU policy changed')
assert(geometry.openingFrameGeometry.minimumThresholdIou >= geometry.openingFrameGeometry.requiredMinimumThresholdIou, 'Opening threshold stability failed')
assert(geometry.openingFrameGeometry.maximumBoundsDrift <= geometry.openingFrameGeometry.allowedMaximumBoundsDrift, 'Opening bounds drift failed')
assert(geometry.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling changed')
assert(geometry.rectification.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'Rectified threshold stability failed')
assert(geometry.rectification.openingMappingQa.every((item) => item.mappedOutsideBodyPixels === 0), 'An opening mapped outside the body')
assert(geometry.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(geometry.openingQaPassed && geometry.expectedOpeningCount === 4, 'Exact four-opening QA failed')
assertExactSet(new Set(geometry.significantOpenings.map((opening) => opening.openingId)), new Set(EXPECTED.openingIds), 'Reviewed openings')

const publisherArguments = [PUBLISHER_PATH]
for (const finish of ['black', 'white']) {
  const output = model[finish]
  assert(output?.sourceKind === 'derived-verified-retail-source', `${finish}: source kind changed`)
  const bytes = await readFile(output.path)
  assert(sha256(bytes) === output.sha256, `${finish}: reviewed SHA-256 changed`)
  publisherArguments.push('--derived-retail-source', `${model.modelId}:${finish}:${output.path}`)
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