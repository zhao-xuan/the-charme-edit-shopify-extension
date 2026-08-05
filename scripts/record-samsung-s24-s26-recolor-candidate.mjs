#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MANIFEST_PATH = 'reference/case-history/samsung-s24-s26-recolors.json'
const PROVENANCE_PATH = 'reference/case-history/generated/samsung-s24-s26-recolors/candidate-provenance.json'
const CAMPAIGN = 'samsung-s24-s26-recolors-v1'
const VISIBLE_ALPHA_THRESHOLD = 8
const MAXIMUM_ASPECT_DRIFT_PERCENT = 3
const REVIEW_STATUSES = new Set(['accepted', 'rejected'])
const FAILURE_REASONS = new Set([
  'alpha-background',
  'geometry',
  'wrong-hardware',
  'wrong-finish',
  'cropped',
  'generation-error',
  'other',
])

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits))
}

function visibleBounds(data, info, threshold) {
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * info.channels + 3] < threshold) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No visible pixels at alpha >= ${threshold}`)
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

async function inspect(filePath, haloRadius = 3) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = visibleBounds(data, info, 128)
  const coreMask = Buffer.alloc(info.width * info.height)
  const alphaStats = { transparent: 0, partial: 0, opaque: 0 }
  const edgePixels = { top: 0, right: 0, bottom: 0, left: 0 }

  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * info.channels + 3]
    if (alpha === 0) alphaStats.transparent += 1
    else if (alpha === 255) alphaStats.opaque += 1
    else alphaStats.partial += 1
    if (alpha >= 128) coreMask[index] = 255
    if (alpha < VISIBLE_ALPHA_THRESHOLD) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    if (y === 0) edgePixels.top += 1
    if (x === info.width - 1) edgePixels.right += 1
    if (y === info.height - 1) edgePixels.bottom += 1
    if (x === 0) edgePixels.left += 1
  }

  let haloPixels = 0
  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * info.channels + 3]
    if (alpha < VISIBLE_ALPHA_THRESHOLD || alpha >= 128) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    let nearCore = false
    for (let offsetY = -haloRadius; offsetY <= haloRadius && !nearCore; offsetY += 1) {
      const neighborY = y + offsetY
      if (neighborY < 0 || neighborY >= info.height) continue
      for (let offsetX = -haloRadius; offsetX <= haloRadius; offsetX += 1) {
        const neighborX = x + offsetX
        if (neighborX < 0 || neighborX >= info.width) continue
        if (coreMask[neighborY * info.width + neighborX]) {
          nearCore = true
          break
        }
      }
    }
    if (!nearCore) haloPixels += 1
  }

  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  return {
    sha256: sha256(bytes),
    format: metadata.format,
    widthPx: info.width,
    heightPx: info.height,
    hasAlpha: metadata.hasAlpha,
    visibleBoundsPx: bounds,
    visibleAspect: round(bounds.width / bounds.height),
    alphaStats,
    cornerAlpha: {
      topLeft: alphaAt(0, 0),
      topRight: alphaAt(info.width - 1, 0),
      bottomRight: alphaAt(info.width - 1, info.height - 1),
      bottomLeft: alphaAt(0, info.height - 1),
    },
    edgePixels,
    haloPixelsOutsideDilatedCore: haloPixels,
  }
}

function automatedQa(candidate, target) {
  const aspectDriftPercent = Math.abs(candidate.visibleAspect / target.visibleAspect - 1) * 100
  const failures = []
  if (candidate.format !== 'png') failures.push('format')
  if (!candidate.hasAlpha) failures.push('alpha-channel')
  if (Object.values(candidate.cornerAlpha).some((alpha) => alpha !== 0)) failures.push('transparent-corners')
  if (Object.values(candidate.edgePixels).some((count) => count !== 0)) failures.push('canvas-edge-leak')
  if (candidate.haloPixelsOutsideDilatedCore > 100) failures.push('alpha-halo')
  if (aspectDriftPercent > MAXIMUM_ASPECT_DRIFT_PERCENT) failures.push('aspect-ratio')
  return {
    passed: failures.length === 0,
    failures,
    thresholds: {
      visibleAlpha: VISIBLE_ALPHA_THRESHOLD,
      maximumHaloPixels: 100,
      maximumAspectDriftPercent: MAXIMUM_ASPECT_DRIFT_PERCENT,
    },
    expectedVisibleAspect: target.visibleAspect,
    aspectDriftPercent: round(aspectDriftPercent, 2),
    candidate,
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporaryPath, filePath)
}

const key = argument('target')
const conversationUrl = argument('conversation-url')
const sourceUrl = argument('source-url')
const reviewStatus = argument('review-status')
const reviewNotes = argument('review-notes')
const failureReasons = argument('failure-reasons').split(',').map((value) => value.trim()).filter(Boolean)
const dryRun = process.argv.includes('--dry-run')

if (!key || (!dryRun && (!conversationUrl || !sourceUrl || !reviewStatus || !reviewNotes))) {
  throw new Error('Pass --target, --conversation-url, --source-url, --review-status and --review-notes')
}
if (!dryRun) {
  if (!conversationUrl.startsWith('https://chatgpt.com/c/')) throw new Error('Invalid ChatGPT conversation URL')
  if (!sourceUrl.startsWith('https://chatgpt.com/backend-api/estuary/content?')) throw new Error('Invalid ChatGPT Estuary URL')
  if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error(`Unsupported review status: ${reviewStatus}`)
  if (failureReasons.some((reason) => !FAILURE_REASONS.has(reason))) throw new Error('Unsupported failure reason')
  if (reviewStatus === 'rejected' && !failureReasons.length) throw new Error('Rejected candidates require a failure reason')
  if (reviewStatus === 'accepted' && failureReasons.length) throw new Error('Accepted candidates cannot have failure reasons')
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
if (manifest.campaign !== CAMPAIGN || manifest.publish !== false) throw new Error('Campaign safety state mismatch')
const target = manifest.targets.find((entry) => entry.key === key)
if (!target) throw new Error(`${key} is not a campaign target`)

const [sourceBytes, promptBytes, candidate] = await Promise.all([
  readFile(target.sourcePath),
  readFile(target.promptPath),
  inspect(target.candidatePath),
])
if (sha256(sourceBytes) !== target.sha256) throw new Error(`${target.sourcePath} no longer matches the manifest`)
if (sha256(promptBytes) !== target.promptSha256) throw new Error(`${target.promptPath} no longer matches the manifest`)
const qa = automatedQa(candidate, target)
if (dryRun) {
  console.log(JSON.stringify({ target: key, automatedQa: qa }, null, 2))
  process.exit(qa.passed ? 0 : 1)
}
if (reviewStatus === 'accepted' && !qa.passed) throw new Error('Cannot accept a candidate with automated QA failures')

let provenance = {
  schemaVersion: 1,
  campaign: CAMPAIGN,
  manifestPath: MANIFEST_PATH,
  publish: false,
  candidates: [],
}
try {
  provenance = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (provenance.campaign !== CAMPAIGN || provenance.publish !== false) throw new Error('Provenance safety state mismatch')

const existing = provenance.candidates.find((entry) => entry.key === key)
const immutable = {
  candidatePath: target.candidatePath,
  sha256: candidate.sha256,
  conversationUrl,
  sourceUrl,
  promptSha256: target.promptSha256,
  reviewStatus,
  failureReasons,
  reviewNotes,
}
if (existing) {
  for (const [field, value] of Object.entries(immutable)) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(value)) throw new Error(`${key} already has different ${field}`)
  }
  console.log(JSON.stringify({ recorded: false, replayed: true, candidate: existing }, null, 2))
  process.exit(0)
}

const record = {
  key,
  modelId: target.modelId,
  modelName: target.modelName,
  finish: target.finish,
  mode: target.mode,
  sourcePath: target.sourcePath,
  sourceSha256: target.sha256,
  promptPath: target.promptPath,
  promptSha256: target.promptSha256,
  candidatePath: target.candidatePath,
  sha256: candidate.sha256,
  widthPx: candidate.widthPx,
  heightPx: candidate.heightPx,
  conversationUrl,
  sourceUrl,
  generator: 'ChatGPT image generation',
  publish: false,
  automatedQa: qa,
  reviewStatus,
  failureReasons,
  reviewNotes,
  recordedAt: new Date().toISOString(),
}
provenance.candidates.push(record)
target.status = reviewStatus
target.outcome = {
  sha256: candidate.sha256,
  widthPx: candidate.widthPx,
  heightPx: candidate.heightPx,
  conversationUrl,
  sourceUrl,
  automatedQaPassed: qa.passed,
  automatedQaFailures: qa.failures,
  reviewStatus,
  failureReasons,
  reviewNotes,
  recordedAt: record.recordedAt,
}
manifest.summary.pending = manifest.targets.filter((entry) => entry.status === 'pending').length
manifest.summary.accepted = manifest.targets.filter((entry) => entry.status === 'accepted').length
manifest.summary.rejected = manifest.targets.filter((entry) => entry.status === 'rejected').length

await writeJsonAtomic(PROVENANCE_PATH, provenance)
await writeJsonAtomic(MANIFEST_PATH, manifest)
console.log(JSON.stringify({ recorded: true, replayed: false, candidate: record }, null, 2))