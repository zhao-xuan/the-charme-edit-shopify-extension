#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/insignia-note9-bestbuy-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-insignia-note9-bestbuy-upload-report.json'
const EXPECTED = {
  modelId: 'galaxy-note-9',
  sku: '6267400',
  modelNumber: 'NS-MSGN9TC',
  widthMm: 76.4,
  heightMm: 161.9,
  reportedValue: '161.9 x 76.4 x 8.8',
}

const modeFlags = ['--verify', '--apply'].filter((flag) => process.argv.includes(flag))
if (modeFlags.length > 1) throw new Error('Pass either --verify or --apply, not both')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const review = JSON.parse(await readFile(REVIEW_PATH, 'utf8'))
assert(review.summary.modelsPublicationEligible === 1, 'Review must contain exactly one publication-eligible model')
assert(review.summary.candidateImagesVisuallyAccepted === 2, 'Review must contain exactly two accepted images')
assert(review.summary.modelsBlockedByCatalogIdentity === 0, 'Review must contain no blocked identities')
assert(review.blockedModels.length === 0, 'Review blocked-model list must be empty')
assert(review.publicationPolicy.shopifyStorageOnly, 'Review must require Shopify storage-only publication')
assert(review.publicationPolicy.forbiddenDestinations.includes('Shopify Product Media'), 'Review must forbid Product Media')
assert(review.publicationPolicy.forbiddenDestinations.includes('Shopify variant media associations'), 'Review must forbid variant media')
assert(review.models.length === 1 && review.models[0].modelId === EXPECTED.modelId, 'Reviewed model changed')

const model = review.models[0]
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Galaxy Note 9 is not accepted')
assert(model.verifiedRetailSource?.sku === EXPECTED.sku, 'Best Buy SKU changed')
assert(model.verifiedRetailSource?.modelNumber === EXPECTED.modelNumber, 'Insignia model number changed')
assert(model.verifiedRetailSource?.productRecordVerificationMethod === 'live-browser-bestbuy-graphql', 'Best Buy verification method changed')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Official width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Official height changed')
assert(model.officialDimensions?.reportedValue === EXPECTED.reportedValue, 'Official dimension value changed')
const pageVerification = model.officialDimensions.directPageVerification
assert(pageVerification?.archivedPageHttpStatus === 200, 'Archived Samsung page did not return HTTP 200')
assert(pageVerification?.apiStatusCode === 200, 'Samsung model API did not return statusCode 200')
assert(pageVerification.modelIdentityFound && pageVerification.reportedValueFound, 'Samsung evidence is incomplete')
assert(model.geometryQa?.cameraOpeningProfilePassed, 'Strict Note 9 opening profile failed')
assert(model.geometryQa.cameraOpeningProfile.normalizeInternalTransparencyForStability, 'Geometry normalization is disabled')
assert(model.geometryQa.minimumThresholdIou >= model.geometryQa.requiredMinimumThresholdIou, 'Threshold stability failed')
assert(model.geometryQa.significantOpenings.length === 1, 'Expected exactly one significant opening')
assert(model.geometryQa.significantOpenings[0].openingId === 'camera-and-fingerprint', 'Unexpected opening identity')
assert(model.geometryQa.unexpectedSignificantHoles.length === 0, 'Unexpected significant opening found')
assert(model.geometryQa.explicitSourceOpeningTransform.clearedPixels === 0, 'Empty-shell source used inferred opening clears')

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