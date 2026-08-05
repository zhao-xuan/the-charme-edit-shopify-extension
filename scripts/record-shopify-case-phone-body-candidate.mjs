#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MANIFEST_PATH = 'reference/case-history/shopify-case-phone-body-regeneration.json'
const CAMPAIGN_ROOT = 'reference/case-history/generated/shopify-case-phone-body-regeneration'
const LEDGER_PATH = path.join(CAMPAIGN_ROOT, 'generation-ledger.json')
const PROVENANCE_PATH = path.join(CAMPAIGN_ROOT, 'candidate-provenance.json')
const CANDIDATES_DIR = path.join(CAMPAIGN_ROOT, 'candidates')
const CAMPAIGN = 'shopify-case-phone-body-regeneration-v1'
const REVIEW_STATUSES = new Set(['accepted', 'rejected', 'failed-no-output'])
const FAILURE_REASONS = new Set([
  'prompt-contract',
  'wrong-orientation',
  'wrong-hardware',
  'missing-phone-body',
  'empty-camera-opening',
  'alpha-background',
  'geometry',
  'wrong-finish',
  'cropped',
  'generation-error',
  'other',
])
const ATTEMPT_SOURCES = new Set(['current-campaign', 'recovered-prior-generation'])

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

function ratioDrift(actual, expected) {
  return Math.abs(actual / expected - 1) * 100
}

function visibleBounds(data, info, alphaThreshold) {
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * info.channels + 3] < alphaThreshold) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No visible pixels at alpha >= ${alphaThreshold}`)
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

async function inspect(filePath, alphaThreshold = 128, haloRadius = 3) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = visibleBounds(data, info, alphaThreshold)
  const coreMask = Buffer.alloc(info.width * info.height)
  const alphaStats = { transparent: 0, partial: 0, opaque: 0 }
  const edgePixels = { top: 0, right: 0, bottom: 0, left: 0 }

  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * info.channels + 3]
    if (alpha === 0) alphaStats.transparent += 1
    else if (alpha === 255) alphaStats.opaque += 1
    else alphaStats.partial += 1
    if (alpha >= alphaThreshold) coreMask[index] = 255
    if (alpha === 0) continue
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
    if (alpha === 0 || alpha >= alphaThreshold) continue
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
    bytes,
    sha256: sha256(bytes),
    format: metadata.format,
    widthPx: info.width,
    heightPx: info.height,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    visibleBoundsPx: bounds,
    widthFill: round(bounds.width / info.width),
    heightFill: round(bounds.height / info.height),
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

function evaluateQa(candidate, reference) {
  const targetAspect = reference.visibleAspect
  const maximumAspectDriftPercent = 1
  const minimumWidthFill = 0.97
  const minimumHeightFill = 0.98
  const candidateCanvasAspect = candidate.widthPx / candidate.heightPx
  const adaptiveMinimumWidthFill = Math.min(
    minimumWidthFill,
    minimumHeightFill * targetAspect / candidateCanvasAspect,
  )
  const adaptiveMinimumHeightFill = Math.min(
    minimumHeightFill,
    minimumWidthFill * candidateCanvasAspect / targetAspect,
  )
  const aspectDriftPercent = ratioDrift(candidate.visibleAspect, targetAspect)
  const failures = []
  if (candidate.format !== 'png') failures.push('format')
  if (!candidate.hasAlpha) failures.push('alpha-channel')
  if (Object.values(candidate.cornerAlpha).some((alpha) => alpha !== 0)) failures.push('transparent-corners')
  if (Object.values(candidate.edgePixels).some((count) => count !== 0)) failures.push('canvas-edge-leak')
  if (candidate.widthFill < adaptiveMinimumWidthFill) failures.push('width-fill')
  if (candidate.heightFill < adaptiveMinimumHeightFill) failures.push('height-fill')
  if (aspectDriftPercent > maximumAspectDriftPercent) failures.push('aspect-ratio')
  if (candidate.haloPixelsOutsideDilatedCore > 100) failures.push('alpha-halo')
  return {
    passed: failures.length === 0,
    failures,
    targetAspect: round(targetAspect),
    aspectDriftPercent: round(aspectDriftPercent, 2),
    candidate: { ...candidate, bytes: undefined },
    reference: {
      path: reference.path,
      sha256: reference.sha256,
      widthPx: reference.widthPx,
      heightPx: reference.heightPx,
      visibleBoundsPx: reference.visibleBoundsPx,
      visibleAspect: reference.visibleAspect,
    },
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  await rename(temporaryPath, filePath)
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function main() {
  const modelId = argument('model')
  const finish = argument('finish')
  const candidatePath = argument('candidate')
  const conversationUrl = argument('conversation-url')
  const sourceUrl = argument('source-url')
  const reviewStatus = argument('review-status')
  const reviewNotes = argument('review-notes')
  const attemptSource = argument('attempt-source', 'current-campaign')
  const submittedPromptPath = argument('submitted-prompt-file')
  const submittedAtLabel = argument('submitted-at-label')
  const failureReasons = argument('failure-reasons')
    .split(',')
    .map((reason) => reason.trim())
    .filter(Boolean)
  const claimConsumed = process.argv.includes('--claim-consumed')
  const noOutput = process.argv.includes('--no-output')
  const attachLateOutput = process.argv.includes('--attach-late-output')

  if (!modelId || !finish || !conversationUrl || !reviewStatus || !reviewNotes) {
    throw new Error('Pass --model, --finish, --conversation-url, --review-status and --review-notes')
  }
  if (!noOutput && (!candidatePath || !sourceUrl)) {
    throw new Error('Output records also require --candidate and --source-url')
  }
  if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error(`Unsupported review status: ${reviewStatus}`)
  if (!ATTEMPT_SOURCES.has(attemptSource)) throw new Error(`Unsupported attempt source: ${attemptSource}`)
  if (failureReasons.some((reason) => !FAILURE_REASONS.has(reason))) {
    throw new Error(`Unsupported failure reason: ${failureReasons.find((reason) => !FAILURE_REASONS.has(reason))}`)
  }
  if (reviewStatus === 'rejected' && !failureReasons.length) throw new Error('Rejected candidates require --failure-reasons')
  if (reviewStatus === 'accepted' && failureReasons.length) throw new Error('Accepted candidates cannot have failure reasons')
  if (noOutput && (reviewStatus !== 'failed-no-output' || !failureReasons.includes('generation-error'))) {
    throw new Error('--no-output requires failed-no-output status and generation-error reason')
  }
  if (!noOutput && reviewStatus === 'failed-no-output') throw new Error('failed-no-output requires --no-output')
  if (noOutput && attachLateOutput) throw new Error('--no-output and --attach-late-output cannot be combined')
  if (!conversationUrl.startsWith('https://chatgpt.com/c/')) throw new Error('Invalid ChatGPT conversation URL')
  if (sourceUrl && !sourceUrl.startsWith('https://chatgpt.com/backend-api/estuary/content?')) throw new Error('Invalid ChatGPT Estuary URL')

  const expectedCandidatePath = path.join(CANDIDATES_DIR, `${modelId}-${finish}-v1-gpt.png`)
  if (!noOutput && path.normalize(candidatePath) !== expectedCandidatePath) {
    throw new Error(`Candidate path must be ${expectedCandidatePath}`)
  }

  const [manifest, ledger] = await Promise.all([
    readFile(MANIFEST_PATH, 'utf8').then(JSON.parse),
    readFile(LEDGER_PATH, 'utf8').then(JSON.parse),
  ])
  if (manifest.campaign !== CAMPAIGN || ledger.campaign !== CAMPAIGN) throw new Error('Campaign mismatch')
  const prompt = manifest.prompts.find((entry) => entry.modelId === modelId && entry.finish === finish)
  const ledgerTarget = ledger.targets.find((entry) => entry.key === `${modelId}:${finish}`)
  if (!prompt || !ledgerTarget) throw new Error(`${modelId}:${finish} is not a campaign target`)
  if (claimConsumed && ledgerTarget.generationCount === 0) {
    ledgerTarget.generationCount = 1
    ledgerTarget.consumedRecordedAt = new Date().toISOString()
  }
  if (ledgerTarget.generationCount !== 1 || ledgerTarget.maximumGenerationCount !== 1) {
    throw new Error(`${ledgerTarget.key} has not consumed exactly one generation`)
  }

  const normalizedPromptPath = submittedPromptPath ? path.normalize(submittedPromptPath) : null
  if (normalizedPromptPath && !normalizedPromptPath.startsWith(`${CAMPAIGN_ROOT}${path.sep}`)) {
    throw new Error('--submitted-prompt-file must be inside the campaign directory')
  }
  const submittedPromptText = normalizedPromptPath
    ? await readFile(normalizedPromptPath, 'utf8')
    : prompt.promptText
  const submittedPromptSha256 = sha256(submittedPromptText)
  const promptContractMatched = submittedPromptSha256 === prompt.promptSha256
  if (attemptSource === 'current-campaign' && !promptContractMatched) {
    throw new Error('Current-campaign submission prompt does not match the manifest')
  }

  const reference = await inspect(prompt.sourcePath)
  reference.path = prompt.sourcePath
  if (reference.sha256 !== prompt.sourceSha256) throw new Error(`${prompt.sourcePath} changed after manifest creation`)
  const candidate = noOutput ? null : await inspect(candidatePath)
  if (candidate && candidate.format !== 'png') throw new Error(`${candidatePath} is not a PNG`)
  const automatedQa = candidate ? evaluateQa(candidate, reference) : null
  if (reviewStatus === 'accepted' && (!promptContractMatched || !automatedQa?.passed)) {
    throw new Error('Cannot accept a candidate with a prompt-contract or automated QA failure')
  }

  let provenance = {
    schemaVersion: 1,
    campaign: CAMPAIGN,
    manifestPath: MANIFEST_PATH,
    ledgerPath: LEDGER_PATH,
    publish: false,
    candidates: [],
  }
  try {
    provenance = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (provenance.campaign !== CAMPAIGN) throw new Error(`${PROVENANCE_PATH} belongs to another campaign`)

  const immutable = {
    candidatePath: candidatePath || null,
    sha256: candidate?.sha256 || null,
    conversationUrl,
    sourceUrl: sourceUrl || null,
    submittedPromptSha256,
  }
  const existingIndex = provenance.candidates.findIndex((entry) => entry.key === ledgerTarget.key)
  let existing = existingIndex >= 0 ? provenance.candidates[existingIndex] : null
  let lateOutputAttached = false
  let observationHistory = existing?.observationHistory || []
  if (attachLateOutput && existing?.reviewStatus === 'failed-no-output') {
    if (existing.conversationUrl !== conversationUrl || existing.submittedPromptSha256 !== submittedPromptSha256) {
      throw new Error(`${ledgerTarget.key} late output does not belong to the recorded submission`)
    }
    observationHistory = [
      ...observationHistory,
      {
        reviewStatus: existing.reviewStatus,
        failureReasons: existing.failureReasons,
        reviewNotes: existing.reviewNotes,
        observedAt: existing.recordedAt,
        supersededAt: new Date().toISOString(),
        supersededReason: 'same submission produced a late output file',
      },
    ]
    existing = null
    lateOutputAttached = true
  } else if (attachLateOutput && !existing) {
    throw new Error(`${ledgerTarget.key} has no no-output observation to supersede`)
  }
  if (existing) {
    for (const [field, value] of Object.entries(immutable)) {
      if (existing[field] !== value) throw new Error(`${ledgerTarget.key} already has different ${field}`)
    }
    if (existing.reviewStatus !== reviewStatus || !sameArray(existing.failureReasons, failureReasons) || existing.reviewNotes !== reviewNotes) {
      throw new Error(`${ledgerTarget.key} already has a different immutable review outcome`)
    }
  }

  const recordedAt = existing?.recordedAt || new Date().toISOString()
  const record = existing || {
    key: ledgerTarget.key,
    modelId,
    modelName: prompt.modelName,
    finish,
    generationCount: 1,
    maximumGenerationCount: 1,
    publish: false,
    generator: prompt.generator,
    candidatePath: candidatePath || null,
    sha256: candidate?.sha256 || null,
    widthPx: candidate?.widthPx || null,
    heightPx: candidate?.heightPx || null,
    conversationUrl,
    sourceUrl: sourceUrl || null,
    attemptSource,
    plannedPromptSha256: prompt.promptSha256,
    submittedPromptPath: normalizedPromptPath,
    submittedPromptSha256,
    promptContractMatched,
    submittedAt: ledgerTarget.submittedAt || null,
    submittedAtLabel: submittedAtLabel || null,
    automatedQa,
    reviewStatus,
    failureReasons,
    reviewNotes,
    recordedAt,
    ...(observationHistory.length ? { observationHistory } : {}),
  }
  if (!existing) {
    if (existingIndex >= 0) provenance.candidates[existingIndex] = record
    else provenance.candidates.push(record)
  }

  ledgerTarget.status = reviewStatus
  ledgerTarget.outcome = {
    candidatePath: candidatePath || null,
    sha256: candidate?.sha256 || null,
    widthPx: candidate?.widthPx || null,
    heightPx: candidate?.heightPx || null,
    conversationUrl,
    sourceUrl: sourceUrl || null,
    attemptSource,
    submittedPromptSha256,
    promptContractMatched,
    submittedAtLabel: submittedAtLabel || null,
    automatedQaPassed: automatedQa?.passed ?? null,
    automatedQaFailures: automatedQa?.failures || [],
    failureReasons,
    reviewNotes,
    recordedAt,
  }

  await writeJsonAtomic(PROVENANCE_PATH, provenance)
  await writeJsonAtomic(LEDGER_PATH, ledger)
  console.log(JSON.stringify({
    recorded: !existing,
    replayed: !!existing,
    lateOutputAttached,
    candidate: record,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})