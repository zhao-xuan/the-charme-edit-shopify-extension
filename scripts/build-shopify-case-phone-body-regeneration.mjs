#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const AUDIT_PATH = 'reference/case-history/generated/all-phone-real-image-completion/shopify-case-phone-body-audit.json'
const MANIFEST_PATH = 'reference/case-history/shopify-case-phone-body-regeneration.json'
const CAMPAIGN_ROOT = 'reference/case-history/generated/shopify-case-phone-body-regeneration'
const LEDGER_PATH = path.join(CAMPAIGN_ROOT, 'generation-ledger.json')
const REFERENCE_DIR = path.join(CAMPAIGN_ROOT, 'references')
const CAMPAIGN = 'shopify-case-phone-body-regeneration-v1'
const OUTPUT_WIDTH = 1024
const OUTPUT_HEIGHT = 1536
const TARGET_VERTICAL_PADDING = 8
const EXPECTED_CAMERA_SIDE_OVERRIDES = new Map([
  ['pixel-5', 'left'],
  ['pixel-9a', 'left'],
])

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function keyOf(modelId, finish) {
  return `${modelId}:${finish}`
}

function sourcePathFor(modelId, finish) {
  return path.join(REFERENCE_DIR, `${modelId}-${finish}-shopify-source.png`)
}

function expectedCameraSide(target) {
  return EXPECTED_CAMERA_SIDE_OVERRIDES.get(target.modelId) || target.expectedCameraSide
}

function orientationCorrectionRequired(target) {
  const expected = expectedCameraSide(target)
  if (expected === 'left') return target.analysis.observedCameraSide === 'right'
  return target.orientationStatus === 'mirrored'
}

function orientationInstruction(target) {
  if (orientationCorrectionRequired(target)) {
    return `ORIENTATION CORRECTION IS MANDATORY: IMAGE 1 is horizontally mirrored and its camera opening is incorrectly on the upper-right. First mirror the ENTIRE physical case as one rigid product, including its complete silhouette, side buttons, bevel lighting, and opening, so the final rear view has the camera on the upper-left. Do not merely move or redraw the camera area.`
  }
  if (expectedCameraSide(target) === 'center') {
    return `ORIENTATION LOCK: this model uses a centred or full-width rear camera module. Keep the exact rear-view physical orientation and side-button placement from IMAGE 1. Do not mirror the product.`
  }
  return `ORIENTATION LOCK: IMAGE 1 is already a straight-on rear view with its camera opening on the upper-left. Keep the entire product in that orientation. Do not mirror or rotate it, and never put the camera on the right.`
}

function outputGeometry(target) {
  const bounds = target.analysis.alphaBounds
  const sourceVisibleWidth = bounds.maxX - bounds.minX + 1
  const sourceVisibleHeight = bounds.maxY - bounds.minY + 1
  const targetHeight = OUTPUT_HEIGHT - (TARGET_VERTICAL_PADDING * 2)
  const targetWidth = Math.round(targetHeight * sourceVisibleWidth / sourceVisibleHeight)
  return {
    sourceVisibleWidth,
    sourceVisibleHeight,
    targetWidth,
    targetHeight,
  }
}

function promptFor(target) {
  const finishLabel = target.finish === 'black' ? 'BLACK' : 'WHITE'
  const source = target.analysis
  const geometry = outputGeometry(target)
  const expectedSide = expectedCameraSide(target)
  return `Generate exactly ONE new downloadable transparent PNG image now.

IMAGE 1 is the authoritative current ${finishLabel} case-only render for the exact ${target.modelName}. Transform this same case into a realistic straight-on rear product render with the exact matching ${target.modelName} handset fully installed.

${orientationInstruction(target)}

PHONE BODY IS REQUIRED: the final image must visibly contain the real phone inside the case. Fill the entire currently transparent camera opening with the matching phone back and its exact rear camera hardware. Include the correct lens count, lens sizes, lens arrangement, flash, microphone, and sensors for ${target.modelName}. The hardware must be physically aligned inside the unchanged case opening. Do not leave an empty, white, grey, checkerboard, or transparent hole. Do not substitute another phone model, simplify the cameras, invent lenses, or show the front screen.

CASE LOCK: use IMAGE 1 as an immutable base image and edit only its transparent camera opening. Do not redraw, reinterpret, relight, shrink, or replace the case. Preserve its complete outer silhouette, corners, thickness, side-button positions, opening shape, raised rim, material, lighting, and ${finishLabel} colour. The case stays bare and without Gel: no resin, glitter, charms, decoration, text, or added case logo. Only the phone surfaces naturally visible through openings may be added.

SOLID FINISH LOCK: the entire visible case exterior must remain one uniform, opaque, solid pure ${finishLabel} silicone finish. Natural lighting and shading are allowed, but no surface texture, pattern, print, colour cast, gradient finish, transparency, translucency, clear panel, contrasting rim or button, two-tone treatment, metallic trim, or coloured accent is allowed anywhere on the case.

CANVAS AND ALPHA LOCK: output exactly ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}. Preserve the source product's alpha-visible aspect ratio of ${geometry.sourceVisibleWidth}:${geometry.sourceVisibleHeight}; do not stretch it or enlarge it to fill the canvas width. The complete case must be at least ${geometry.targetHeight} pixels tall, leaving no more than ${TARGET_VERTICAL_PADDING} transparent pixels above and below it. At that unchanged aspect ratio it will be about ${geometry.targetWidth} pixels wide and centred horizontally. Keep this nearly edge-to-edge vertical scale from IMAGE 1; do not turn it into a smaller catalogue thumbnail with visual breathing room. Keep the complete product uncropped. Every pixel outside the case and its one-pixel antialiased edge must have alpha 0. All canvas corners and edges must be transparent. No backdrop, floor, halo, haze, glow, or drop shadow.

FINAL PASS/FAIL: exact ${target.modelName} rear hardware present; no empty camera hole; correct physical orientation; camera ${expectedSide === 'center' ? 'module remains centred/full-width as designed' : 'is on the image left'}; unchanged uniform opaque solid pure ${finishLabel} case with no texture, pattern, transparency, or accent; complete uncropped transparent PNG; exactly ONE image and no explanatory text.`
}

function entryFor(target) {
  const promptText = promptFor(target)
  return {
    key: keyOf(target.modelId, target.finish),
    modelId: target.modelId,
    modelName: target.modelName,
    finish: target.finish,
    generator: 'ChatGPT image generation',
    maximumGenerationCount: 1,
    sourceUrl: target.url,
    sourcePath: sourcePathFor(target.modelId, target.finish),
    sourceSha256: target.analysis.sha256,
    sourceWidthPx: target.analysis.width,
    sourceHeightPx: target.analysis.height,
    sourceStatus: target.status,
    sourceOrientation: target.analysis.observedCameraSide,
    expectedCameraSide: expectedCameraSide(target),
    orientationCorrectionRequired: orientationCorrectionRequired(target),
    promptText,
    promptSha256: sha256(promptText),
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function prepareSource(entry) {
  let existing = null
  try {
    existing = await readFile(entry.sourcePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (existing) {
    if (sha256(existing) !== entry.sourceSha256) throw new Error(`${entry.sourcePath} has unexpected bytes`)
    return { downloaded: false, sourcePath: entry.sourcePath, sha256: entry.sourceSha256 }
  }
  const response = await fetch(entry.sourceUrl, { headers: { accept: 'image/png' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${entry.sourceUrl}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== entry.sourceSha256) throw new Error(`${entry.key} live source changed since the audit`)
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
  if (metadata.format !== 'png') throw new Error(`${entry.key} source is not PNG`)
  await mkdir(path.dirname(entry.sourcePath), { recursive: true })
  await writeFile(entry.sourcePath, bytes, { flag: 'wx' })
  return { downloaded: true, sourcePath: entry.sourcePath, sha256: entry.sourceSha256 }
}

async function main() {
  const audit = JSON.parse(await readFile(AUDIT_PATH, 'utf8'))
  const existingLedger = await readJson(LEDGER_PATH, null)
  if (existingLedger && existingLedger.campaign !== CAMPAIGN) {
    throw new Error(`${LEDGER_PATH} belongs to another campaign`)
  }
  const existingManifest = await readJson(MANIFEST_PATH, null)
  if (existingManifest && existingManifest.campaign !== CAMPAIGN) {
    throw new Error(`${MANIFEST_PATH} belongs to another campaign`)
  }
  const previousByKey = new Map((existingLedger?.targets || []).map((entry) => [entry.key, entry]))
  const previousPromptByKey = new Map((existingManifest?.prompts || []).map((entry) => [entry.key, entry]))
  const prompts = (audit.generationTargets || []).map((target) => {
    const generated = entryFor(target)
    const previous = previousByKey.get(generated.key)
    if (!previous || (previous.status === 'pending' && previous.generationCount === 0)) return generated
    const frozen = previousPromptByKey.get(generated.key)
    if (!frozen || frozen.promptSha256 !== previous.promptSha256) {
      throw new Error(`${generated.key} consumed prompt is not recoverable from the existing manifest`)
    }
    if (frozen.sourceSha256 !== generated.sourceSha256) {
      throw new Error(`${generated.key} source changed after submission`)
    }
    return frozen
  })
  if (prompts.length !== audit.summary.shellOnly) {
    throw new Error(`Expected ${audit.summary.shellOnly} shell-only targets, found ${prompts.length}`)
  }
  if (new Set(prompts.map((entry) => entry.key)).size !== prompts.length) {
    throw new Error('Duplicate model/finish key in phone-body generation targets')
  }
  const manifest = {
    schemaVersion: 1,
    campaign: CAMPAIGN,
    generatedAt: new Date().toISOString(),
    publish: false,
    sourceAuditPath: AUDIT_PATH,
    generationPolicy: {
      maximumPerModelAndFinish: 1,
      claimBeforeSubmission: true,
      retriesAllowed: false,
      exactOriginalBytesOnly: true,
      postProcessingAllowed: false,
      productMediaAllowed: false,
      variantMediaAllowed: false,
      uploadDestination: 'Shopify Files and charme_product body_image_black/body_image_white only',
    },
    summary: {
      modelFinishTargets: prompts.length,
      models: new Set(prompts.map((entry) => entry.modelId)).size,
      mirroredSourceTargets: prompts.filter((entry) => entry.orientationCorrectionRequired).length,
    },
    prompts,
  }
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true })
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)

  const targets = prompts.map((prompt) => {
    const previous = previousByKey.get(prompt.key)
    if (!previous) {
      return {
        key: prompt.key,
        modelId: prompt.modelId,
        modelName: prompt.modelName,
        finish: prompt.finish,
        promptSha256: prompt.promptSha256,
        sourceSha256: prompt.sourceSha256,
        generationCount: 0,
        maximumGenerationCount: 1,
        status: 'pending',
      }
    }
    if (previous.sourceSha256 !== prompt.sourceSha256) {
      throw new Error(`${prompt.key} source changed after ledger creation`)
    }
    if (previous.promptSha256 !== prompt.promptSha256) {
      if (previous.status === 'pending' && previous.generationCount === 0) {
        return { ...previous, promptSha256: prompt.promptSha256 }
      }
      throw new Error(`${prompt.key} prompt changed after submission`)
    }
    if (previous.generationCount > 1) throw new Error(`${prompt.key} exceeds its one-generation limit`)
    return previous
  })
  const ledger = {
    schemaVersion: 1,
    campaign: CAMPAIGN,
    manifestPath: MANIFEST_PATH,
    maximumPerModelAndFinish: 1,
    targets,
  }

  const modelId = argument('model')
  const finish = argument('finish')
  const selected = modelId && finish
    ? prompts.find((entry) => entry.key === keyOf(modelId, finish))
    : null
  if ((process.argv.includes('--prepare') || process.argv.includes('--claim')) && !selected) {
    throw new Error('Pass a shell-only --model and --finish target')
  }
  let prepared = null
  if (process.argv.includes('--prepare')) prepared = await prepareSource(selected)
  if (process.argv.includes('--claim')) {
    await access(selected.sourcePath)
    const sourceBytes = await readFile(selected.sourcePath)
    if (sha256(sourceBytes) !== selected.sourceSha256) throw new Error(`${selected.key} prepared source hash mismatch`)
    const ledgerTarget = targets.find((entry) => entry.key === selected.key)
    if (ledgerTarget.generationCount !== 0 || ledgerTarget.status !== 'pending') {
      throw new Error(`${selected.key} already used its one permitted generation`)
    }
    ledgerTarget.generationCount = 1
    ledgerTarget.status = 'submitted'
    ledgerTarget.submittedAt = new Date().toISOString()
  }
  await mkdir(path.dirname(LEDGER_PATH), { recursive: true })
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`)
  console.log(JSON.stringify({
    manifest: MANIFEST_PATH,
    ledger: LEDGER_PATH,
    summary: manifest.summary,
    selected: selected ? {
      key: selected.key,
      sourcePath: selected.sourcePath,
      promptSha256: selected.promptSha256,
      generationCount: targets.find((entry) => entry.key === selected.key).generationCount,
      status: targets.find((entry) => entry.key === selected.key).status,
      prepared,
    } : null,
  }, null, 2))
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})