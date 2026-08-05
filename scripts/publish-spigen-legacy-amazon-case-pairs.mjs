#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/spigen-legacy-amazon-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-spigen-legacy-amazon-upload-report.json'
const EXPECTED_MODELS = {
  'galaxy-a40': { asin: 'B07PP996WM', widthMm: 69.2, heightMm: 144.4 },
  'galaxy-a70': { asin: 'B07QKGR1DG', widthMm: 76.7, heightMm: 164.3 },
}
const EXPECTED_MODEL_IDS = new Set(Object.keys(EXPECTED_MODELS))

const modeFlags = ['--verify', '--apply'].filter((flag) => process.argv.includes(flag))
if (modeFlags.length > 1) throw new Error('Pass either --verify or --apply, not both')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertExactSet(actual, expected, label) {
  assert(actual.size === expected.size, `${label}: expected ${expected.size}, found ${actual.size}`)
  for (const value of expected) assert(actual.has(value), `${label}: missing ${value}`)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const review = JSON.parse(await readFile(REVIEW_PATH, 'utf8'))
assert(review.summary.modelsPublicationEligible === 2, 'Review must contain exactly 2 publication-eligible models')
assert(review.summary.candidateImagesVisuallyAccepted === 4, 'Review must contain exactly 4 accepted images')
assert(review.summary.modelsBlockedByCatalogIdentity === 0, 'Review must contain no blocked identities')
assert(review.blockedModels.length === 0, 'Review blocked-model list must be empty')
assert(review.publicationPolicy.shopifyStorageOnly, 'Review must require Shopify storage-only publication')
assert(review.publicationPolicy.forbiddenDestinations.includes('Shopify Product Media'), 'Review must forbid Product Media')
assertExactSet(new Set(review.models.map((model) => model.modelId)), EXPECTED_MODEL_IDS, 'Reviewed models')

const publisherArguments = [PUBLISHER_PATH]
for (const model of review.models) {
  const expected = EXPECTED_MODELS[model.modelId]
  assert(model.reviewStatus === 'accepted' && model.publicationEligible, `${model.modelId}: model is not accepted`)
  assert(model.verifiedRetailSource?.asin === expected.asin, `${model.modelId}: Amazon ASIN changed`)
  assert(model.officialDimensions?.widthMm === expected.widthMm, `${model.modelId}: official width changed`)
  assert(model.officialDimensions?.heightMm === expected.heightMm, `${model.modelId}: official height changed`)
  const pageVerification = model.officialDimensions.directPageVerification
  assert(pageVerification?.httpStatus === 200, `${model.modelId}: archived Samsung page did not return HTTP 200`)
  assert(pageVerification.modelIdentityFound && pageVerification.reportedValueFound, `${model.modelId}: Samsung evidence is incomplete`)
  assert(model.geometryQa?.cameraOpeningProfilePassed, `${model.modelId}: opening profile failed`)
  assert(model.geometryQa.unexpectedSignificantHoles.length === 0, `${model.modelId}: unexpected significant opening found`)

  for (const finish of ['black', 'white']) {
    const output = model[finish]
    assert(output?.sourceKind === 'derived-verified-retail-source', `${model.modelId}/${finish}: source kind changed`)
    const bytes = await readFile(output.path)
    assert(sha256(bytes) === output.sha256, `${model.modelId}/${finish}: reviewed SHA-256 changed`)
    publisherArguments.push('--derived-retail-source', `${model.modelId}:${finish}:${output.path}`)
  }
  publisherArguments.push(
    '--create-target',
    `${model.modelId}:${model.modelName}:${model.officialDimensions.widthMm}:${model.officialDimensions.heightMm}`,
  )
}

publisherArguments.push('--report', REPORT_PATH, ...modeFlags)
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