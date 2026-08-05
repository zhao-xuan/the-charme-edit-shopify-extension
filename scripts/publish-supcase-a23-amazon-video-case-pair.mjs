#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/supcase-a23-amazon-video-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-supcase-a23-amazon-video-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-a23-4g-5g',
  asin: 'B0BMFRJYLG',
  widthMm: 76.9,
  heightMm: 165.4,
  depthMm: 8.4,
  reportedValue: '165.4 x 76.9 x 8.4',
  frameTimestampSeconds: 52,
  silhouetteThresholds: [1.5, 1.625, 1.75],
  primarySilhouetteThreshold: 1.625,
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
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy A23 4G / 5G is not accepted')
assert(model.visualReview?.status === 'accepted', 'A23 visual review is not accepted')
assert(model.verifiedRetailSource?.asin === EXPECTED.asin, 'Amazon ASIN changed')
assert(model.verifiedRetailSource?.hlsEvidence?.frame?.timestampSeconds === EXPECTED.frameTimestampSeconds, 'Source frame changed')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official height changed')
assert(model.officialDimensions?.depthMm === EXPECTED.depthMm, 'Official depth changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official dimension value changed')
const dimensionEvidence = model.officialDimensions.directPageVerification?.evidence || []
assert(dimensionEvidence.length === 2, 'Expected A23 4G and 5G dimension evidence')
assertExactArray(dimensionEvidence.map((item) => item.network), ['4G LTE', '5G'], 'Samsung network identities')
assert(dimensionEvidence.every((item) => item.apiStatusCode === 200 && item.dimensionVerified && item.networkIdentityVerified), 'Samsung evidence is incomplete')

const geometry = model.geometryQa
assert(geometry.sourceGeometry.primaryThreshold === EXPECTED.primarySilhouetteThreshold, 'Primary silhouette threshold changed')
assertExactArray(geometry.sourceGeometry.stabilityThresholds, EXPECTED.silhouetteThresholds, 'Silhouette threshold band')
assert(geometry.sourceGeometry.minimumThresholdIou >= geometry.sourceGeometry.requiredMinimumThresholdIou, 'Silhouette threshold stability failed')
assert(geometry.sourceGeometry.maximumBoundsDrift <= geometry.sourceGeometry.allowedMaximumBoundsDrift, 'Silhouette bounds drift failed')
assert(geometry.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling changed')
assert(geometry.transform.morphologyOperations === 0, 'Morphology is forbidden')
assert(geometry.transform.inferredBoundaryPixels === 0, 'Boundary pixels were inferred')
assert(geometry.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(geometry.openingQaPassed && geometry.expectedOpeningCount === 1, 'Exact camera-opening QA failed')
assert(geometry.significantOpenings.length === 1 && geometry.significantOpenings[0].openingId === 'camera', 'Reviewed opening changed')

const overlayBytes = await readFile(model.visualReview.evidence.path)
assert(sha256(overlayBytes) === model.visualReview.evidence.encodedSha256, 'Visual review overlay changed')

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