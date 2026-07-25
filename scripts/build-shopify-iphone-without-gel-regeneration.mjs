#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const AUDIT_PATH = 'reference/shopify-iphone-case-size-audit.json'
const REFERENCE_DIR = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const OUTPUT_PATH = 'reference/case-history/shopify-iphone-without-gel-regeneration.json'
const PROVENANCE_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidate-provenance.json'
const GEOMETRY_GUIDES_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/references/geometry-guides.json'
const CANDIDATE_DIR = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidates'
const CAMPAIGN_REFERENCE_DIR = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/references'
const FINISHES = ['black', 'white']
const EXPECTED_MODEL_COUNT = 20
const INITIAL_RENDERING_BIAS_CORRECTION = 1.04
const RETRY_NEAR_BEST_TOLERANCE_PERCENT = 0.25
const execFileAsync = promisify(execFile)

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function imageEvidence(filePath, bytes = null) {
  const imageBytes = bytes || await readFile(filePath)
  const image = sharp(imageBytes)
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let hasTransparentBackground = false
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * 4 + 3] <= 40) {
      hasTransparentBackground = true
      break
    }
  }

  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    const isSubject = hasTransparentBackground
      ? data[offset + 3] > 40
      : Math.min(data[offset], data[offset + 1], data[offset + 2]) < 246
    if (!isSubject) continue
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
  return {
    sha256: sha256(imageBytes),
    format: metadata.format,
    canvasPx: { width: info.width, height: info.height },
    visibleBoundsPx: { left, top, right, bottom, width, height },
    visibleAspect: round(width / height),
    widthFill: round(width / info.width),
    heightFill: round(height / info.height),
    hasTransparentBackground,
  }
}

async function sourceFor(modelId, finish) {
  const trialPath = path.join(REFERENCE_DIR, `trial-${modelId}-${finish}-source.png`)
  try {
    return { sourcePath: trialPath, bytes: await readFile(trialPath), sourceOrigin: 'campaign-trial-reference' }
  } catch (error) {
    if (error?.code !== 'ENOENT' || modelId !== 'iphone-14') throw error
  }

  const gitPath = `public/assets/cases/case-without-gel/${modelId}-${finish}.png`
  const { stdout } = await execFileAsync('git', ['show', `HEAD:${gitPath}`], {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  })
  const sourcePath = path.join(CAMPAIGN_REFERENCE_DIR, `${modelId}-${finish}-source.png`)
  await mkdir(CAMPAIGN_REFERENCE_DIR, { recursive: true })
  await writeFile(sourcePath, stdout)
  return { sourcePath, bytes: stdout, sourceOrigin: `git:HEAD:${gitPath}` }
}

function promptFor({ name, finish, widthMm, heightMm, targetAspect, previousAttempt, previousAttempts, geometryFirst, transformOnly, placementCalibrated }) {
  const finishLabel = finish === 'black' ? 'BLACK' : 'OFF-WHITE'
  const sourceImageLabel = geometryFirst ? 'IMAGE 2' : 'IMAGE 1'
  const geometryImageLabel = geometryFirst ? 'IMAGE 1' : 'IMAGE 2'
  const previousQa = previousAttempt?.automatedQa
  const measuredAttempts = (previousAttempts || []).filter((candidate) => (
    Number.isFinite(candidate.automatedQa?.bodyAspect)
  ))
  const narrowAttempt = measuredAttempts
    .filter((candidate) => candidate.automatedQa.bodyAspect < targetAspect)
    .sort((left, right) => right.automatedQa.bodyAspect - left.automatedQa.bodyAspect)[0]
  const wideAttempt = measuredAttempts
    .filter((candidate) => candidate.automatedQa.bodyAspect > targetAspect)
    .sort((left, right) => left.automatedQa.bodyAspect - right.automatedQa.bodyAspect)[0]
  const targetBodyWidthPx = previousQa ? Math.round(previousQa.bodyHeightPx * targetAspect) : null
  const bodyWidthDeltaPx = previousQa ? targetBodyWidthPx - previousQa.bodyWidthPx : null
  const widthDirection = bodyWidthDeltaPx > 0 ? 'WIDEN' : 'NARROW'
  const widthCorrectionPercent = previousQa
    ? Math.abs(bodyWidthDeltaPx / previousQa.bodyWidthPx) * 100
    : null
  if (placementCalibrated) {
    const previousWidthFillPercent = Number(
      previousAttempt?.promptText?.match(/and ([0-9]+(?:\.[0-9]+)?)% of canvas width/)?.[1],
    )
    const previousGenerationAspect = Number(
      previousAttempt?.promptText?.match(/generation silhouette aspect of ([0-9]+(?:\.[0-9]+)?)/)?.[1],
    ) || (previousWidthFillPercent ? previousWidthFillPercent / (2 * 98.4) : targetAspect)
    const measuredBiasCorrection = previousQa
      ? targetAspect / previousQa.bodyAspect
      : INITIAL_RENDERING_BIAS_CORRECTION
    const boundedBiasCorrection = Math.min(1.08, Math.max(0.92, measuredBiasCorrection))
    const calibratedWidthFillPercent = previousGenerationAspect * boundedBiasCorrection * 2 * 98.4
    const canvasWidthFillPercent = Math.min(99.5, calibratedWidthFillPercent)
    const generationAspect = canvasWidthFillPercent / (2 * 98.4)
    const calibrationInstruction = previousQa
      ? `GENERATION CALIBRATION: ${previousAttempt.candidateVersion.toUpperCase()} measured ${previousQa.bodyWidthPx}x${previousQa.bodyHeightPx}px at aspect ${previousQa.bodyAspect.toFixed(6)}, ${previousQa.bodyAspectDriftPercent.toFixed(2)}% from the real target. Compensate for that measured rendering bias by aiming for a generation silhouette aspect of ${generationAspect.toFixed(6)}. This is an instruction overcorrection only; final acceptance still uses the real ${targetAspect.toFixed(6)} ratio within 1%.\n\n`
      : ''
    return `${calibrationInstruction}Generate exactly ONE complete, straight-on, bare ${finishLabel} ${name} case. Only TWO things determine pass or fail: body size and camera hardware position. All other cosmetic details may vary.

IMAGE 1 is the same-model source. IMAGE 2 is the size/camera geometry guide.

1. BODY SIZE: use a portrait 1:2 canvas. Centre the complete uncropped body. The central body excluding side-button protrusions must occupy 98.4% of canvas height and ${canvasWidthFillPercent.toFixed(1)}% of canvas width. On an 887x1774 canvas this is approximately ${Math.round(1774 * 0.984 * generationAspect)}x${Math.round(1774 * 0.984)}px, with about ${((100 - canvasWidthFillPercent) / 2).toFixed(1)}% canvas margin on each side and 0.8% on top and bottom. The accepted physical body width/height ratio remains ${targetAspect.toFixed(6)} within 1%. Do not fake the ratio with extra background margin.

2. CAMERA: copy the exact same-model hardware from IMAGE 1: the same camera island or opening, lens count, lens arrangement, flash, microphone and sensors. Place and scale that unchanged hardware so its occupied region and relative position match IMAGE 2's blue region. Do not add, remove or rearrange any opening.

No Gel, resin, glitter, charms or decoration. Do not output a guide, comparison, crop or explanation.`
  }
  if (transformOnly) {
    return `TRANSFORM IMAGE 1 IN PLACE. Do not redraw, restyle or reinterpret the product.

IMAGE 1 is a complete bare ${finishLabel} ${name} whose camera hardware and camera position already passed visual review. Its central body measures ${previousQa.bodyWidthPx}x${previousQa.bodyHeightPx}px.

Keep the body height exactly ${previousQa.bodyHeightPx}px. ${widthDirection} only the complete central body silhouette by approximately ${Math.abs(bodyWidthDeltaPx)}px (${widthCorrectionPercent.toFixed(2)}%), from ${previousQa.bodyWidthPx}px to approximately ${targetBodyWidthPx}px wide. The final central-body width/height ratio must be ${targetAspect.toFixed(6)} within 1%.

Apply that width change uniformly to the entire existing case, including its camera island and side controls, so all hardware keeps exactly the same relative position. Preserve every existing design choice: exact ${name} camera island or opening, lens count, lens arrangement, flash, microphone, sensors, material, colour, lighting, shadows, logo, buttons and corners.

Keep the complete case straight-on, centred, fully visible and uncropped on the same background. Keep it bare: no Gel, resin, adhesive, glitter, charms or decoration. Output exactly ONE full-canvas image and no explanation.`
  }
  const bracketHeightPx = narrowAttempt && wideAttempt
    ? Math.round((narrowAttempt.automatedQa.bodyHeightPx + wideAttempt.automatedQa.bodyHeightPx) / 2)
    : null
  const bracketTargetWidthPx = bracketHeightPx ? Math.round(bracketHeightPx * targetAspect) : null
  const bracketNarrowWidthPx = bracketHeightPx
    ? Math.round(narrowAttempt.automatedQa.bodyAspect * bracketHeightPx)
    : null
  const bracketWideWidthPx = bracketHeightPx
    ? Math.round(wideAttempt.automatedQa.bodyAspect * bracketHeightPx)
    : null
  const retryPreamble = narrowAttempt && wideAttempt
    ? `RETRY WITH A MEASURED BRACKET: discard all previous generated results. ${narrowAttempt.candidateVersion.toUpperCase()} measured ${narrowAttempt.automatedQa.bodyWidthPx}x${narrowAttempt.automatedQa.bodyHeightPx}px and was too narrow; ${wideAttempt.candidateVersion.toUpperCase()} measured ${wideAttempt.automatedQa.bodyWidthPx}x${wideAttempt.automatedQa.bodyHeightPx}px and was too wide. At approximately ${bracketHeightPx}px body height, render the central body approximately ${bracketTargetWidthPx}px wide, strictly between the normalized ${bracketNarrowWidthPx}px narrow result and ${bracketWideWidthPx}px wide result. Do not reproduce either extreme. Correct the physical body proportion itself, not merely the canvas margins. Start again from ${sourceImageLabel} and follow ${geometryImageLabel} visually; do not reuse any rejected result.\n\n`
    : previousAttempt
    ? `RETRY AFTER REJECTED ${previousAttempt.candidateVersion.toUpperCase()}: discard the previous generated result. Its central body measured ${previousQa.bodyWidthPx}x${previousQa.bodyHeightPx}px and missed the required ratio by ${previousQa.bodyAspectDriftPercent.toFixed(2)}%. At that same body height, the target body width is approximately ${targetBodyWidthPx}px: ${widthDirection} the central body by approximately ${Math.abs(bodyWidthDeltaPx)}px (${widthCorrectionPercent.toFixed(2)}%) without changing its height. Correct the physical body proportion itself, not merely the canvas margins. Start again from ${sourceImageLabel} and follow ${geometryImageLabel} visually; do not reuse the rejected result.\n\n`
    : ''
  const geometryPriority = geometryFirst
    ? `GEOMETRY-FIRST RETRY: construct the output on IMAGE 1's required red body silhouette and blue camera map before transferring appearance from IMAGE 2. IMAGE 1 geometry has priority over IMAGE 2's current body proportions.\n\n`
    : ''
  return `${geometryPriority}${retryPreamble}Generate exactly ONE new full-canvas product image now.

${sourceImageLabel} is the authoritative bare ${finishLabel} ${name} source. Preserve its existing material, colour, lighting, shadows, logo if present, buttons, corners and all other appearance. This remains a WITHOUT-GEL image.

${geometryImageLabel} is a schematic geometry template only. Its RED outer outline controls only the central phone-body width-to-height proportion. Its BLUE rounded region controls only the camera hardware's occupied region and position relative to that body. Do not render the red, blue or grey guide colours in the product.

MAKE ONLY THESE TWO GEOMETRY CORRECTIONS:
1. SIZE: fit the central body silhouette to ${geometryImageLabel}'s red outline at the verified Apple proportion ${widthMm} mm wide x ${heightMm} mm high. Excluding side-button protrusions, width/height must be ${targetAspect.toFixed(6)} within 1%.
2. CAMERA: keep ${sourceImageLabel}'s exact camera island, lens count, lens arrangement, flash and sensors, but place and scale that unchanged hardware to occupy ${geometryImageLabel}'s blue region at the same relative position.

Do not intentionally adjust anything else. Preserve ${sourceImageLabel} as closely as possible outside those two corrections. Keep the product straight-on, centred, complete and uncropped on its existing background. Do not add or remove a logo, alter the finish, redesign the shell, substitute another model or invent camera openings.

Keep the case bare: no Gel, resin, adhesive, glitter, charms or decoration. Do not output a comparison, guide, grid, crop or explanation.

FINAL PASS/FAIL: central body ratio ${targetAspect.toFixed(6)} within 1%; exact ${name} camera hardware in ${geometryImageLabel}'s blue relative position; otherwise unchanged bare ${finishLabel} source; exactly one image.`
}

function nextVersion(provenance, modelId, finish) {
  const versions = (provenance.candidates || [])
    .filter((candidate) => candidate.modelId === modelId && candidate.finish === finish)
    .map((candidate) => Number(candidate.candidateVersion.match(/^v(\d+)-gpt$/)?.[1] || 0))
  return `v${Math.max(0, ...versions) + 1}-gpt`
}

async function main() {
  const [audit, geometryGuides] = await Promise.all([
    readFile(AUDIT_PATH, 'utf8').then(JSON.parse),
    readFile(GEOMETRY_GUIDES_PATH, 'utf8').then(JSON.parse),
  ])
  let provenance = { candidates: [] }
  try {
    provenance = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const targets = audit.products.filter((product) => product.dimensionStatus === 'issue')
  if (targets.length !== EXPECTED_MODEL_COUNT) {
    throw new Error(`Expected ${EXPECTED_MODEL_COUNT} dimension-issue models, found ${targets.length}`)
  }

  const prompts = []
  for (const product of targets) {
    const { width, height } = product.appleDeviceMm
    const targetAspect = width / height
    const geometryGuide = geometryGuides.guides.find((guide) => guide.modelId === product.id)
    if (!geometryGuide) throw new Error(`Missing geometry guide for ${product.id}`)
    for (const finish of FINISHES) {
      const { sourcePath, bytes, sourceOrigin } = await sourceFor(product.id, finish)
      const sourceEvidence = await imageEvidence(sourcePath, bytes)
      const previousAttempts = (provenance.candidates || []).filter((candidate) => (
        candidate.modelId === product.id && candidate.finish === finish
      ))
      const previousAttempt = previousAttempts.at(-1)
      const measuredRetryAttempts = previousAttempts
        .filter((candidate) => Number.isFinite(candidate.automatedQa?.bodyAspectDriftPercent))
      const bestRetryAttempt = [...measuredRetryAttempts]
        .sort((left, right) => (
          left.automatedQa.bodyAspectDriftPercent - right.automatedQa.bodyAspectDriftPercent
        ))[0]
      const latestNearBestRetryAttempt = bestRetryAttempt
        ? measuredRetryAttempts.filter((candidate) => (
            candidate.automatedQa.bodyAspectDriftPercent
              <= bestRetryAttempt.automatedQa.bodyAspectDriftPercent + RETRY_NEAR_BEST_TOLERANCE_PERCENT
          )).at(-1)
        : null
      const retryAttempt = latestNearBestRetryAttempt || bestRetryAttempt || previousAttempt
      const hasFailedGeometryFirst = previousAttempts.some((candidate) => candidate.inputStrategy === 'geometry-first')
      const nearTargetTransformAttempt = previousAttempts
        .filter((candidate) => (
          candidate.reviewStatus === 'rejected-size'
          && candidate.automatedQa?.bodyAspectDriftPercent <= 2
          && /camera[\s\S]*pass(?:ed)? visual review/i.test(candidate.reviewNotes || '')
        ))
        .sort((left, right) => (
          left.automatedQa.bodyAspectDriftPercent - right.automatedQa.bodyAspectDriftPercent
        ))[0]
      const hasTriedNearTargetTransform = nearTargetTransformAttempt && previousAttempts.some((candidate) => (
        candidate.inputStrategy === 'single-image-transform'
        && candidate.transformBase?.candidateVersion === nearTargetTransformAttempt.candidateVersion
      ))
      const placementCalibrated = !nearTargetTransformAttempt || hasTriedNearTargetTransform
      const oppositeSideBaseAttempt = hasFailedGeometryFirst
        && previousAttempt?.inputStrategy === 'single-image-transform'
        && previousAttempt.automatedQa?.bodyAspectDriftPercent > 5
        ? previousAttempts
            .filter((candidate) => (
              candidate.reviewStatus === 'rejected-size'
              && candidate.automatedQa?.bodyAspectDriftPercent <= 5
              && /camera[\s\S]*pass(?:ed)? visual review/i.test(candidate.reviewNotes || '')
              && Math.sign(candidate.automatedQa.bodyAspect - targetAspect)
                === -Math.sign(previousAttempt.automatedQa.bodyAspect - targetAspect)
            ))
            .sort((left, right) => (
              left.automatedQa.bodyAspectDriftPercent - right.automatedQa.bodyAspectDriftPercent
            ))[0]
        : null
      const transformBaseAttempt = nearTargetTransformAttempt || (hasFailedGeometryFirst
        ? oppositeSideBaseAttempt || previousAttempts
            .filter((candidate) => (
              candidate.reviewStatus === 'rejected-size'
              && candidate.automatedQa?.bodyAspectDriftPercent <= 5
              && /camera[\s\S]*pass(?:ed)? visual review/i.test(candidate.reviewNotes || '')
            ))
            .at(-1)
          : null)
      const transformOnly = Boolean(transformBaseAttempt) && !placementCalibrated
      const geometryFirst = !transformOnly
        && !placementCalibrated
        && previousAttempts.filter((candidate) => candidate.generationBase).length >= 2
      const acceptedAttempt = previousAttempt?.reviewStatus === 'accepted'
        && previousAttempt.automatedQa?.passed
        && previousAttempt.visualCameraQa === 'passed-by-review'
        ? previousAttempt
        : null
      if (acceptedAttempt) {
        prompts.push({
          modelId: product.id,
          modelName: product.name,
          finish,
          generator: acceptedAttempt.generator,
          candidateVersion: acceptedAttempt.candidateVersion,
          status: 'accepted',
          publish: false,
          targetMm: { width, height },
          targetAspect: round(targetAspect),
          sourcePath,
          sourceOrigin,
          sourceEvidence,
          inputStrategy: acceptedAttempt.inputStrategy || 'source-first',
          referenceImages: acceptedAttempt.referenceImages,
          geometryGuide: acceptedAttempt.geometryGuide,
          promptText: acceptedAttempt.promptText,
          promptSha256: acceptedAttempt.promptSha256,
          candidatePath: acceptedAttempt.candidatePath,
          candidate: {
            sha256: acceptedAttempt.sha256,
            widthPx: acceptedAttempt.widthPx,
            heightPx: acceptedAttempt.heightPx,
          },
          review: {
            automatedSizeQa: acceptedAttempt.automatedQa,
            visualCameraQa: acceptedAttempt.visualCameraQa,
            approved: true,
          },
        })
        continue
      }
      const candidateVersion = nextVersion(provenance, product.id, finish)
      const promptText = promptFor({
        name: product.name,
        finish,
        widthMm: width,
        heightMm: height,
        targetAspect,
        previousAttempt: transformOnly ? transformBaseAttempt : retryAttempt,
        previousAttempts,
        geometryFirst,
        transformOnly,
        placementCalibrated,
      })
      prompts.push({
        modelId: product.id,
        modelName: product.name,
        finish,
        generator: 'ChatGPT image generation',
        candidateVersion,
        status: 'pending-generation',
        publish: false,
        targetMm: { width, height },
        targetAspect: round(targetAspect),
        sourcePath,
        sourceOrigin,
        sourceEvidence,
        inputStrategy: placementCalibrated
          ? 'placement-calibrated'
          : transformOnly ? 'single-image-transform' : geometryFirst ? 'geometry-first' : 'source-first',
        transformBase: transformOnly && transformBaseAttempt ? {
          candidateVersion: transformBaseAttempt.candidateVersion,
          candidatePath: transformBaseAttempt.candidatePath,
          sha256: transformBaseAttempt.sha256,
          bodyWidthPx: transformBaseAttempt.automatedQa.bodyWidthPx,
          bodyHeightPx: transformBaseAttempt.automatedQa.bodyHeightPx,
          bodyAspectDriftPercent: transformBaseAttempt.automatedQa.bodyAspectDriftPercent,
          cameraReviewNotes: transformBaseAttempt.reviewNotes,
        } : null,
        referenceImages: transformOnly
          ? [transformBaseAttempt.candidatePath]
          : geometryFirst
          ? [geometryGuide.filePath, sourcePath]
          : [sourcePath, geometryGuide.filePath],
        geometryGuide: {
          filePath: geometryGuide.filePath,
          sha256: geometryGuide.sha256,
          bodyBoundsPx: geometryGuide.bodyBoundsPx,
          cameraBoundsPx: geometryGuide.cameraBoundsPx,
          cameraNormalized: geometryGuide.cameraNormalized,
        },
        promptText,
        promptSha256: sha256(Buffer.from(promptText)),
        candidatePath: path.join(CANDIDATE_DIR, `${product.id}-${finish}-${candidateVersion}.png`),
        candidate: null,
        review: {
          automatedSizeQa: 'pending',
          visualCameraQa: 'pending',
          approved: false,
        },
      })
    }
  }

  const manifest = {
    schemaVersion: 1,
    campaign: 'shopify-iphone-without-gel-size-regeneration',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/build-shopify-iphone-without-gel-regeneration.mjs',
    sourceAuditPath: AUDIT_PATH,
    geometryGuidesPath: GEOMETRY_GUIDES_PATH,
    scope: 'The 20 live Shopify iPhone records whose width_mm or height_mm differs from verified Apple device-body dimensions.',
    policy: 'Candidate-only. Correct only device-body size and camera placement. Preserve exact GPT bytes and provenance. Never publish until automated size QA and visual camera QA pass and publish is explicitly set true.',
    summary: {
      models: targets.length,
      finishes: FINISHES.length,
      prompts: prompts.length,
      acceptedCandidates: prompts.filter((entry) => entry.status === 'accepted').length,
      pendingGeneration: prompts.filter((entry) => entry.status === 'pending-generation').length,
      publishable: 0,
    },
    prompts,
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await mkdir(CANDIDATE_DIR, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(JSON.stringify({ output: OUTPUT_PATH, ...manifest.summary }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})