#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/nillkin-a22-youtube-video-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-nillkin-a22-youtube-video-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-a22-5g',
  videoId: 'qNzLAFOzqpg',
  modelCode: 'SM-A226BZAUMEA',
  widthMm: 76.4,
  heightMm: 167.2,
  depthMm: 9,
  reportedValue: '167.2 x 76.4 x 9.0',
  edgeThresholds: [1.5, 1.75, 2],
  primaryEdgeThreshold: 1.75,
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
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy A22 5G is not accepted')
assert(model.visualReview?.status === 'accepted', 'A22 visual review is not accepted')
assert(model.verifiedRetailSource?.videoId === EXPECTED.videoId, 'YouTube video ID changed')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official height changed')
assert(model.officialDimensions?.depthMm === EXPECTED.depthMm, 'Official depth changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official dimension value changed')
assert(model.officialDimensions?.directPageVerification?.evidence?.modelCode === EXPECTED.modelCode, 'Samsung model code changed')
assert(model.officialDimensions.directPageVerification.evidence.apiStatusCode === 200, 'Samsung API evidence is incomplete')
assert(model.officialDimensions.directPageVerification.evidence.reportedValueFound, 'Samsung dimension value is not verified')

const geometry = model.geometryQa
assert(geometry.sourceGeometry.primaryThreshold === EXPECTED.primaryEdgeThreshold, 'Primary edge threshold changed')
assertExactArray(geometry.sourceGeometry.stabilityThresholds, EXPECTED.edgeThresholds, 'Edge threshold band')
assert(geometry.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'Minimum IoU policy changed')
assert(geometry.sourceGeometry.allowedMaximumBoundsDrift === 4, 'Maximum bounds drift policy changed')
assert(geometry.sourceGeometry.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'Threshold stability failed')
assert(geometry.sourceGeometry.minimumTemporalIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'Temporal stability failed')
assert(geometry.sourceGeometry.maximumThresholdBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'Threshold bounds drift failed')
assert(geometry.sourceGeometry.maximumTemporalBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'Temporal bounds drift failed')
assert(geometry.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling changed')
assert(geometry.transform.morphologyOperations === 0, 'Morphology is forbidden')
assert(geometry.transform.inferredBoundaryPixels === 0, 'Boundary pixels were inferred')
assert(geometry.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(geometry.openingQaPassed && geometry.expectedOpeningCount === 1, 'Exact one-opening QA failed')
assert(geometry.significantOpenings.length === 1 && geometry.significantOpenings[0].openingId === 'camera', 'Reviewed opening changed')

const overlay = model.visualReview.evidence
assert(overlay.geometryUse === 'visual review only; never sampled by candidate generation', 'Visual overlay role changed')
const overlayBytes = await readFile(overlay.path)
assert(sha256(overlayBytes) === overlay.encodedSha256, 'Visual review overlay changed')

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