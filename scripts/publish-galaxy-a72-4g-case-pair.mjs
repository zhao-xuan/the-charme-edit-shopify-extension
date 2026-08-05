#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const REVIEW_PATH = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-normalized-handle-review.json'
const PUBLISHER_PATH = 'scripts/publish-shopify-iphone-without-gel-images.mjs'
const REPORT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-galaxy-a72-4g-upload-report.json'
const SOURCE_MODEL_ID = 'galaxy-a72-4g-5g'
const TARGET = {
  modelId: 'galaxy-a72-4g',
  modelName: 'Galaxy A72 4G',
  widthMm: 77.4,
  heightMm: 165,
}
const EXPECTED_HASHES = {
  black: '364f2d0ca5101b478d97800763cafdebfe2eb2cf73b4166adb7df9cda659525f',
  white: 'be809336aefbdd2fb2488c97092cd9dafe3b1aab04a9e10a48b1cadef42201c0',
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
const source = review.models.find((model) => model.modelId === SOURCE_MODEL_ID)
assert(source, `Missing ${SOURCE_MODEL_ID} in ${REVIEW_PATH}`)
assert(source.reviewStatus === 'accepted-image-blocked-catalog', 'A72 source review status changed')
assert(source.publicationEligible === false, 'Historical combined A72 target must remain blocked')
assert(/Rename the combined catalog target to Galaxy A72 4G/.test(source.blockReason), 'A72 catalog correction rationale changed')
assert(source.officialDimensions?.widthMm === TARGET.widthMm, 'A72 official width changed')
assert(source.officialDimensions?.heightMm === TARGET.heightMm, 'A72 official height changed')

const publisherArguments = [PUBLISHER_PATH]
for (const finish of ['black', 'white']) {
  const candidate = source[finish]
  assert(candidate?.path, `A72 ${finish} candidate is missing`)
  const bytes = await readFile(candidate.path)
  assert(candidate.sha256 === EXPECTED_HASHES[finish], `A72 ${finish} reviewed hash changed`)
  assert(sha256(bytes) === EXPECTED_HASHES[finish], `A72 ${finish} file hash changed`)
  publisherArguments.push('--derived-source', `${TARGET.modelId}:${finish}:${candidate.path}`)
}
publisherArguments.push(
  '--create-target',
  `${TARGET.modelId}:${TARGET.modelName}:${TARGET.widthMm}:${TARGET.heightMm}`,
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