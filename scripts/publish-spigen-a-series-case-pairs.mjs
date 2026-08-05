#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a-series-case-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-spigen-a-series-upload-report.json'

const modeFlags = ['--verify', '--apply'].filter((flag) => process.argv.includes(flag))
if (modeFlags.length > 1) throw new Error('Pass either --verify or --apply, not both')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

const review = JSON.parse(await readFile(REVIEW_PATH, 'utf8'))
assert(review.summary.modelsPublicationEligible === 11, 'Review must contain exactly 11 publication-eligible models')
assert(review.summary.candidateImagesVisuallyAccepted === 22, 'Review must contain exactly 22 accepted images')
assert(review.summary.modelsBlockedByCatalogIdentity === 4, 'Review must retain exactly four blocked catalog identities')

const publisherArguments = [PUBLISHER_PATH]
for (const model of review.models) {
  assert(model.reviewStatus === 'accepted' && model.publicationEligible, `${model.modelId}: model is not accepted for publication`)
  assert(Number.isFinite(model.officialDimensions?.widthMm), `${model.modelId}: official width is missing`)
  assert(Number.isFinite(model.officialDimensions?.heightMm), `${model.modelId}: official height is missing`)
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