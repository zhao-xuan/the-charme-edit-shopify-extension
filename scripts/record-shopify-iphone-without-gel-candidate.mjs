#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_MANIFEST = 'reference/case-history/shopify-iphone-without-gel-regeneration.json'
const DEFAULT_OUTPUT = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidate-provenance.json'
const MAXIMUM_ASPECT_DRIFT_PERCENT = 1
const ANALYZER_VERSION = 'background-adaptive-v2'
const REVIEW_STATUSES = new Set(['pending-visual-review', 'accepted', 'rejected-size', 'rejected-hardware', 'rejected-gel', 'rejected-other'])

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function opaqueBackground(data, info) {
  const edge = Math.max(2, Math.min(8, Math.floor(Math.min(info.width, info.height) / 20)))
  const samples = []
  for (const [left, top] of [
    [0, 0],
    [info.width - edge, 0],
    [0, info.height - edge],
    [info.width - edge, info.height - edge],
  ]) {
    for (let y = top; y < top + edge; y += 1) {
      for (let x = left; x < left + edge; x += 1) {
        const offset = (y * info.width + x) * 4
        samples.push([data[offset], data[offset + 1], data[offset + 2]])
      }
    }
  }
  const rgb = [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel])))
  const sampleDistances = samples.map((sample) => Math.max(
    Math.abs(sample[0] - rgb[0]),
    Math.abs(sample[1] - rgb[1]),
    Math.abs(sample[2] - rgb[2]),
  ))
  return { rgb, threshold: Math.max(8, median(sampleDistances) + 6) }
}

function visualCameraQa(reviewStatus) {
  if (reviewStatus === 'accepted') return 'passed-by-review'
  if (reviewStatus === 'rejected-hardware') return 'failed'
  return 'pending'
}

async function imageEvidence(filePath, targetAspect) {
  const bytes = await readFile(filePath)
  const image = sharp(bytes)
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let hasTransparentBackground = false
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * 4 + 3] <= 40) {
      hasTransparentBackground = true
      break
    }
  }
  const background = hasTransparentBackground ? null : opaqueBackground(data, info)
  const isSubject = (offset) => hasTransparentBackground
    ? data[offset + 3] > 40
    : Math.max(
      Math.abs(data[offset] - background.rgb[0]),
      Math.abs(data[offset + 1] - background.rgb[1]),
      Math.abs(data[offset + 2] - background.rgb[2]),
    ) > background.threshold

  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    if (!isSubject(offset)) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No visible shell found in ${filePath}`)

  const width = right - left + 1
  const height = bottom - top + 1
  const widthFill = width / info.width
  const heightFill = height / info.height
  const visibleAspect = width / height
  const aspectDriftPercent = Math.abs(visibleAspect / targetAspect - 1) * 100
  const centralRowWidths = []
  for (let y = Math.floor(info.height * 0.3); y < Math.ceil(info.height * 0.75); y += 1) {
    let rowLeft = info.width
    let rowRight = -1
    for (let x = 0; x < info.width; x += 1) {
      if (!isSubject((y * info.width + x) * 4)) continue
      rowLeft = Math.min(rowLeft, x)
      rowRight = Math.max(rowRight, x)
    }
    if (rowRight >= rowLeft) centralRowWidths.push(rowRight - rowLeft + 1)
  }
  const centralColumnHeights = []
  for (let x = Math.floor(info.width * 0.3); x < Math.ceil(info.width * 0.7); x += 1) {
    let columnTop = info.height
    let columnBottom = -1
    for (let y = 0; y < info.height; y += 1) {
      if (!isSubject((y * info.width + x) * 4)) continue
      columnTop = Math.min(columnTop, y)
      columnBottom = Math.max(columnBottom, y)
    }
    if (columnBottom >= columnTop) centralColumnHeights.push(columnBottom - columnTop + 1)
  }
  if (!centralRowWidths.length || !centralColumnHeights.length) {
    throw new Error(`Could not measure the central shell body in ${filePath}`)
  }
  const bodyWidth = median(centralRowWidths)
  const bodyHeight = median(centralColumnHeights)
  const bodyAspect = bodyWidth / bodyHeight
  const bodyAspectDriftPercent = Math.abs(bodyAspect / targetAspect - 1) * 100
  const failures = []
  if (bodyAspectDriftPercent > MAXIMUM_ASPECT_DRIFT_PERCENT) failures.push('body-aspect-ratio')

  return {
    bytes,
    sha256: sha256(bytes),
    format: metadata.format,
    canvasPx: { width: info.width, height: info.height },
    visibleBoundsPx: { left, top, right, bottom, width, height },
    widthFill: round(widthFill),
    heightFill: round(heightFill),
    visibleAspect: round(visibleAspect),
    targetAspect: round(targetAspect),
    aspectDriftPercent: round(aspectDriftPercent, 2),
    bodyWidthPx: bodyWidth,
    bodyHeightPx: bodyHeight,
    bodyAspect: round(bodyAspect),
    bodyAspectDriftPercent: round(bodyAspectDriftPercent, 2),
    hasTransparentBackground,
    opaqueBackgroundRgb: background?.rgb || null,
    subjectThreshold: background?.threshold || null,
    analyzerVersion: ANALYZER_VERSION,
    acceptanceScope: 'device-body aspect ratio only; camera placement requires visual review',
    passed: failures.length === 0,
    failures,
  }
}

async function main() {
  const manifestPath = argument('manifest', DEFAULT_MANIFEST)
  const outputPath = argument('output', DEFAULT_OUTPUT)
  const modelId = argument('model')
  const finish = argument('finish')
  const candidateVersion = argument('version')
  const candidatePath = argument('candidate')
  const conversationUrl = argument('conversation-url')
  const sourceUrl = argument('source-url')
  const reviewStatus = argument('review-status', 'pending-visual-review')
  const reviewNotes = argument('review-notes')
  const reanalyze = process.argv.includes('--reanalyze')
  const updateReview = process.argv.includes('--update-review')
  if (!modelId || !finish || !candidateVersion || !candidatePath || !conversationUrl || !sourceUrl) {
    throw new Error('Pass --model, --finish, --version, --candidate, --conversation-url and --source-url')
  }
  if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error(`Unsupported review status: ${reviewStatus}`)
  if (!conversationUrl.startsWith('https://chatgpt.com/c/')) throw new Error('Invalid ChatGPT conversation URL')
  if (!sourceUrl.startsWith('https://chatgpt.com/backend-api/estuary/content?')) throw new Error('Invalid ChatGPT Estuary URL')

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let provenance = {
    schemaVersion: 1,
    campaign: manifest.campaign,
    manifestPath,
    publish: false,
    candidates: [],
  }
  try {
    provenance = JSON.parse(await readFile(outputPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (provenance.campaign !== manifest.campaign || provenance.manifestPath !== manifestPath) {
    throw new Error(`Existing provenance at ${outputPath} belongs to a different campaign or manifest`)
  }
  const existing = provenance.candidates.find((entry) => (
    entry.modelId === modelId && entry.finish === finish && entry.candidateVersion === candidateVersion
  ))
  if (existing) {
    if (!Number.isFinite(existing.targetAspect) || existing.targetAspect <= 0) {
      throw new Error(`${modelId}:${finish}:${candidateVersion} has an invalid stored targetAspect`)
    }
    const existingEvidence = await imageEvidence(candidatePath, existing.targetAspect)
    const replay = { candidatePath, sha256: existingEvidence.sha256, conversationUrl, sourceUrl }
    if (existingEvidence.format !== 'png') throw new Error(`${candidatePath} is not a PNG`)
    if (Object.keys(replay).some((field) => existing[field] !== replay[field])) {
      throw new Error(`${modelId}:${finish}:${candidateVersion} already has different immutable provenance`)
    }
    if (!updateReview && existing.reviewStatus !== reviewStatus) {
      throw new Error(`${modelId}:${finish}:${candidateVersion} already has a different review status; pass --update-review`)
    }
    if (reviewStatus === 'accepted' && !existingEvidence.passed) {
      throw new Error(`Cannot accept candidate that fails automated size QA: ${existingEvidence.failures.join(', ')}`)
    }
    if (reviewStatus === 'accepted' && !reviewNotes) {
      throw new Error('Accepted candidates require visual camera review notes')
    }

    let changed = false
    const changedAt = new Date().toISOString()
    if (reanalyze && JSON.stringify(existing.automatedQa) !== JSON.stringify({ ...existingEvidence, bytes: undefined })) {
      existing.automatedQaHistory = existing.automatedQaHistory || []
      existing.automatedQaHistory.push({
        automatedQa: existing.automatedQa,
        supersededAt: changedAt,
      })
      existing.automatedQa = { ...existingEvidence, bytes: undefined }
      existing.qaReanalyzedAt = changedAt
      changed = true
    }
    if (updateReview && (existing.reviewStatus !== reviewStatus || existing.reviewNotes !== reviewNotes)) {
      existing.reviewHistory = existing.reviewHistory || []
      existing.reviewHistory.push({
        reviewStatus: existing.reviewStatus,
        visualCameraQa: existing.visualCameraQa || visualCameraQa(existing.reviewStatus),
        reviewNotes: existing.reviewNotes,
        supersededAt: changedAt,
      })
      existing.reviewStatus = reviewStatus
      existing.visualCameraQa = visualCameraQa(reviewStatus)
      existing.reviewNotes = reviewNotes
      existing.reviewUpdatedAt = changedAt
      changed = true
    }
    if (changed) await writeFile(outputPath, `${JSON.stringify(provenance, null, 2)}\n`)
    console.log(JSON.stringify({ recorded: false, reanalyzed: reanalyze, reviewUpdated: updateReview, candidate: existing }, null, 2))
    return
  }

  const prompt = manifest.prompts.find((entry) => entry.modelId === modelId && entry.finish === finish)
  if (!prompt) throw new Error(`${modelId}:${finish} is not in ${manifestPath}`)
  if (prompt.candidateVersion !== candidateVersion) {
    throw new Error(`${modelId}:${finish} active version is ${prompt.candidateVersion}, not ${candidateVersion}`)
  }
  if (!Number.isFinite(prompt.targetAspect) || prompt.targetAspect <= 0) {
    throw new Error(`${modelId}:${finish} has an invalid targetAspect in ${manifestPath}`)
  }
  const evidence = await imageEvidence(candidatePath, prompt.targetAspect)
  if (evidence.format !== 'png') throw new Error(`${candidatePath} is not a PNG`)
  if (reviewStatus === 'accepted' && !evidence.passed) {
    throw new Error(`Cannot accept candidate that fails automated size QA: ${evidence.failures.join(', ')}`)
  }
  if (reviewStatus === 'accepted' && !reviewNotes) {
    throw new Error('Accepted candidates require visual camera review notes')
  }

  const candidate = {
    modelId,
    modelName: prompt.modelName,
    finish,
    candidateVersion,
    publish: false,
    generator: prompt.generator,
    promptText: prompt.promptText,
    promptSha256: prompt.promptSha256,
    targetMm: prompt.targetMm,
    targetAspect: prompt.targetAspect,
    sourcePath: prompt.sourcePath,
    sourceSha256: prompt.sourceEvidence.sha256,
    inputStrategy: prompt.inputStrategy || 'source-first',
    transformBase: prompt.transformBase || null,
    referenceImages: prompt.referenceImages,
    geometryGuide: prompt.geometryGuide,
    candidatePath,
    sha256: evidence.sha256,
    widthPx: evidence.canvasPx.width,
    heightPx: evidence.canvasPx.height,
    automatedQa: { ...evidence, bytes: undefined },
    conversationUrl,
    sourceUrl,
    reviewStatus,
    visualCameraQa: visualCameraQa(reviewStatus),
    reviewNotes,
    recordedAt: new Date().toISOString(),
  }

  provenance.candidates.push(candidate)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(provenance, null, 2)}\n`)
  console.log(JSON.stringify({ recorded: true, candidate }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})