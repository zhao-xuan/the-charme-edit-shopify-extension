#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/spigen-exact-model-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-spigen-exact-model-upload-report.json'
const EXPECTED_MODEL_IDS = new Set([
  'galaxy-note-20-4g-5g',
  'galaxy-note-20-ultra-4g-5g',
  'galaxy-s10-plus',
  'galaxy-s9',
  'galaxy-s9-plus',
  'pixel-10',
  'pixel-10-pro',
  'pixel-10-pro-xl',
  'pixel-9a',
])
const COMBINED_NETWORK_MODEL_IDS = new Set([
  'galaxy-note-20-4g-5g',
  'galaxy-note-20-ultra-4g-5g',
])
const EXPECTED_SOURCE_IDENTITIES = {
  'galaxy-note-20-4g-5g': { sku: 'ACS01418', gtin: '8809710754102' },
  'galaxy-note-20-ultra-4g-5g': { sku: 'ACS01392', gtin: '8809710753945' },
  'galaxy-s10-plus': { sku: '606CS25770', gtin: '8809640251979' },
  'galaxy-s9': { sku: '592CS22834', gtin: '8809565305177' },
  'galaxy-s9-plus': { sku: '593CS22933', gtin: '8809565306167' },
  'pixel-10': { sku: 'ACS09698', gtin: '8800283307597' },
  'pixel-10-pro': { sku: 'ACS09698', gtin: '8800283307597' },
  'pixel-10-pro-xl': { sku: 'ACS09721', gtin: '8800283307825' },
  'pixel-9a': { sku: 'ACS09046', gtin: '8809971238779' },
}

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
assert(review.summary.modelsPublicationEligible === 9, 'Review must contain exactly 9 publication-eligible models')
assert(review.summary.candidateImagesVisuallyAccepted === 18, 'Review must contain exactly 18 accepted images')
assert(review.summary.modelsBlockedByCatalogIdentity === 0, 'Review must contain no blocked catalog identities')
assert(review.blockedModels.length === 0, 'Review blocked-model list must be empty')
assertExactSet(new Set(review.models.map((model) => model.modelId)), EXPECTED_MODEL_IDS, 'Reviewed models')

const publisherArguments = [PUBLISHER_PATH]
for (const model of review.models) {
  assert(model.reviewStatus === 'accepted' && model.publicationEligible, `${model.modelId}: model is not accepted for publication`)
  assert(Number.isFinite(model.officialDimensions?.widthMm), `${model.modelId}: official width is missing`)
  assert(Number.isFinite(model.officialDimensions?.heightMm), `${model.modelId}: official height is missing`)
  const pageVerification = model.officialDimensions.directPageVerification
  assert(pageVerification?.httpStatus === 200, `${model.modelId}: official dimension page did not return HTTP 200`)
  assert(pageVerification.modelIdentityFound, `${model.modelId}: official model identity was not found`)
  assert(pageVerification.reportedValueFound, `${model.modelId}: official dimension value was not found`)
  assert(pageVerification.evidence?.length > 0, `${model.modelId}: official dimension evidence is missing`)
  for (const evidence of pageVerification.evidence) {
    assert(evidence.httpStatus === 200, `${model.modelId}: an official evidence page did not return HTTP 200`)
    assert(evidence.modelIdentityFound, `${model.modelId}: an evidence model identity was not found`)
    assert(evidence.reportedValueFound, `${model.modelId}: an evidence dimension value was not found`)
    assert(evidence.reportedValue === model.officialDimensions.reportedValue, `${model.modelId}: evidence dimensions differ`)
  }
  if (COMBINED_NETWORK_MODEL_IDS.has(model.modelId)) {
    assertExactSet(
      new Set(pageVerification.evidence.map((evidence) => evidence.network)),
      new Set(['LTE', '5G']),
      `${model.modelId} network identities`,
    )
  }
  assert(model.geometryQa?.cameraOpeningProfilePassed, `${model.modelId}: camera-opening profile failed`)
  assert(model.geometryQa.unexpectedSignificantHoles.length === 0, `${model.modelId}: unexpected significant opening found`)
  const sourceIdentity = EXPECTED_SOURCE_IDENTITIES[model.modelId]
  assert(model.officialSource?.sku === sourceIdentity.sku, `${model.modelId}: exact Spigen SKU changed`)
  assert(model.officialSource?.gtin === sourceIdentity.gtin, `${model.modelId}: exact Spigen GTIN changed`)

  for (const finish of ['black', 'white']) {
    const output = model[finish]
    assert(output?.sourceKind === 'derived-official-source', `${model.modelId}/${finish}: source kind is not approved`)
    const bytes = await readFile(output.path)
    assert(sha256(bytes) === output.sha256, `${model.modelId}/${finish}: reviewed SHA-256 changed`)
    publisherArguments.push('--derived-source', `${model.modelId}:${finish}:${output.path}`)
  }
  publisherArguments.push(
    '--create-target',
    `${model.modelId}:${model.modelName}:${model.officialDimensions.widthMm}:${model.officialDimensions.heightMm}`,
  )
}

const modelById = new Map(review.models.map((model) => [model.modelId, model]))
const pixel10 = modelById.get('pixel-10')
const pixel10Pro = modelById.get('pixel-10-pro')
const pixel10ProXl = modelById.get('pixel-10-pro-xl')
assert(pixel10.officialSource.sha256 === pixel10Pro.officialSource.sha256, 'Pixel 10 / 10 Pro shared official source changed')
assert(pixel10.officialSource.sha256 !== pixel10ProXl.officialSource.sha256, 'Pixel 10 Pro XL must retain its distinct official source')
assert(pixel10.black.alphaSha256 === pixel10Pro.black.alphaSha256, 'Pixel 10 / 10 Pro normalized geometry differs')
assert(pixel10.black.alphaSha256 === pixel10ProXl.black.alphaSha256, 'Pixel 10 Pro XL normalized official geometry differs')
assert(
  pixel10.officialDimensions.widthMm !== pixel10ProXl.officialDimensions.widthMm
    && pixel10.officialDimensions.heightMm !== pixel10ProXl.officialDimensions.heightMm,
  'Pixel 10 Pro XL must retain its distinct physical scale',
)

publisherArguments.push('--report', REPORT_PATH, ...modeFlags)

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, publisherArguments, { env: process.env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Publisher stopped by ${signal}`))
    else if (code) reject(new Error(`Publisher exited with code ${code}`))
    else resolve()
  })
})