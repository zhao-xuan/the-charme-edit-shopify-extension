#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/pixel-5-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-pixel-5-upload-report.json'
const EXPECTED = {
  modelId: 'pixel-5',
  modelName: 'Pixel 5',
  widthMm: 70.4,
  heightMm: 144.7,
  depthMm: 8,
  productId: '83890',
  sku: 'ACS01894',
  alphaSha256: '7b3936fbe5eaa9938b0a3d4188b9904a6aa54c85201cd6311f3a8150bfd91816',
  candidateSha256: {
    black: 'c59a66fc69b051c93a1fbf770a9f2b2039b8e48c0d8d398eb2bdc1c01baae586',
    white: 'badd71663046fabfe010076c00b2825223b336daa5e0f9712d858f34828ab58f',
  },
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
assert(review.summary.modelsBlockedByCatalogIdentity === 0 && review.blockedModels.length === 0, 'Review must contain no blocked identities')
assert(review.models.length === 1, 'Review must contain exactly one model record')

const model = review.models[0]
assert(model.modelId === EXPECTED.modelId && model.modelName === EXPECTED.modelName, 'Reviewed Pixel 5 identity changed')
assert(model.reviewStatus === 'accepted' && model.publicationEligible, 'Pixel 5 is not accepted for publication')
assert(model.officialDimensions?.widthMm === EXPECTED.widthMm, 'Pixel 5 official width changed')
assert(model.officialDimensions?.heightMm === EXPECTED.heightMm, 'Pixel 5 official height changed')
assert(model.officialDimensions?.depthMm === EXPECTED.depthMm, 'Pixel 5 official depth changed')
const pageVerification = model.officialDimensions.directPageVerification
assert(pageVerification?.httpStatus === 200, 'Official Google dimension page did not return HTTP 200')
assert(pageVerification.modelIdentityFound && pageVerification.reportedValueFound, 'Official Pixel 5 dimensions were not verified')
assert(pageVerification.evidence?.length === 1, 'Expected one official Google dimension record')
assert(pageVerification.evidence[0].modelLabel === 'Pixel 5 phone (2020)', 'Official Google model identity changed')
assert(model.sourceEvidence?.kind === 'verified-reseller-real-product-image', 'Reviewed source is not the real-product photograph')
assert(model.sourceEvidence.productId === EXPECTED.productId, 'Reseller product identity changed')
assert(model.sourceEvidence.sku === EXPECTED.sku, 'Spigen SKU changed')
assert(model.sourceEvidence.manufacturerEvidence?.length === 2, 'Manufacturer corroboration is incomplete')
assert(model.geometryQa?.cameraOpeningProfilePassed, 'Pixel 5 dual-opening profile failed')
assert(model.geometryQa.cameraOpeningProfile.id === 'pixel-5-camera-and-fingerprint', 'Pixel 5 opening profile changed')
assert(model.geometryQa.significantOpenings.length === 2, 'Pixel 5 must retain camera and fingerprint openings')
assert(model.geometryQa.unexpectedSignificantHoles.length === 0, 'Unexpected significant opening found')
assert(model.geometryQa.sharedAlphaSha256 === EXPECTED.alphaSha256, 'Reviewed Pixel 5 alpha changed')

const publisherArguments = [PUBLISHER_PATH]
for (const finish of ['black', 'white']) {
  const candidate = model[finish]
  assert(candidate?.sourceKind === 'derived-verified-real-product-source', `${finish}: source classification changed`)
  assert(candidate.alphaSha256 === EXPECTED.alphaSha256, `${finish}: reviewed alpha changed`)
  assert(candidate.sha256 === EXPECTED.candidateSha256[finish], `${finish}: reviewed candidate SHA-256 changed`)
  const bytes = await readFile(candidate.path)
  assert(sha256(bytes) === EXPECTED.candidateSha256[finish], `${finish}: candidate file changed`)
  publisherArguments.push('--derived-source', `${EXPECTED.modelId}:${finish}:${candidate.path}`)
}

publisherArguments.push(
  '--create-target',
  `${EXPECTED.modelId}:${EXPECTED.modelName}:${EXPECTED.widthMm}:${EXPECTED.heightMm}`,
  '--report',
  REPORT_PATH,
  ...modeFlags,
)

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, publisherArguments, { env: process.env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Publisher stopped by ${signal}`))
    else if (code) reject(new Error(`Publisher exited with code ${code}`))
    else resolve()
  })
})