import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

const sourceManifestPath = argument('manifest')
const outputPath = argument('output')
const modelId = argument('model')
const finish = argument('finish')
const candidateVersion = argument('version')
const shouldWrite = process.argv.includes('--write')
const minimumWidthFill = 0.97
const minimumHeightFill = 0.98

if (!sourceManifestPath || !outputPath || !modelId || !finish || !candidateVersion) {
  throw new Error('Pass --manifest, --output, --model, --finish and --version')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function subjectBounds(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alphaHasBackground = Array.from({ length: info.width * info.height }, (_, index) => data[index * 4 + 3])
    .some((alpha) => alpha <= 40)
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    const isSubject = alphaHasBackground
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
  if (right < left || bottom < top) throw new Error(`No visible subject in ${filePath}`)
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    canvasWidth: info.width,
    canvasHeight: info.height,
  }
}

async function assertMissing(filePath) {
  try {
    await access(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`${filePath} already exists; increment the candidate version`)
}

function originalContract(promptText) {
  const marker = '\n\nUSER SIZE CORRECTION -'
  const markerIndex = promptText.indexOf(marker)
  return markerIndex >= 0 ? promptText.slice(markerIndex + 2) : promptText
}

function cameraLockPrompt(source, bounds) {
  const canvasRatio = bounds.canvasWidth / bounds.canvasHeight
  const widthFill = bounds.width / bounds.canvasWidth
  const heightFill = bounds.height / bounds.canvasHeight
  return `FOURTH CORRECTION - CAMERA HARDWARE COLOUR RESTORATION WITH PASSED SIZE LOCK - HIGHEST PRIORITY: the immediately previous candidate is archived and rejected because it changed IMAGE 1 and IMAGE 5's purple-grey iPhone 14 Pro camera island into neutral black/grey hardware. It passed the measured size gate at ${(widthFill * 100).toFixed(2)}% width fill and ${(heightFill * 100).toFixed(2)}% height fill. Regenerate from the original six references. Do not edit, trace or copy the rejected candidate's camera colour.

CAMERA HARDWARE PIXEL IDENTITY - NON-NEGOTIABLE: copy IMAGE 1 and the dedicated IMAGE 5 camera crop exactly. Preserve the original purple-grey camera-plate colour and chroma, three lens count, lens positions, purple lens rings, flash, microphone, dark LiDAR circle, tiny sensor, island border, highlights and shadows. Black Gel and the black silicone shell must never recolour, desaturate, cover, tint or redraw any part of that camera hardware. The camera island must remain visibly purple-grey, not black, charcoal or neutral grey.

PASSED SOURCE-EDGE SIZE LOCK - DO NOT REGRESS: preserve the immediately previous candidate's passed full-canvas product scale while rebuilding from IMAGE 1. The final canvas ratio must remain ${canvasRatio.toFixed(6)} within 1%; complete-product fill must remain at least 97% width and 98% height; the outer shell must reach both left and right canvas edges with no broad white side strips. Keep the full uncropped top, bottom, corners and buttons. Do not zoom out, shrink, narrow, shorten, add padding or return to the earlier failed framing.

GEL LOCK - NO REDESIGN: keep the established Black Gel material and the accepted IMAGE 3/4 footprint unchanged. Preserve the same broad camera-right rise, ultra-close left/bottom/right fit, thick glossy perimeter bead and calm black centre. Restore only source camera hardware identity while retaining the passed source-edge product scale. No logo, text, icon, red residue, Glitter contamination or extra object.

FINAL PASS/FAIL: exact purple-grey IMAGE 1/5 camera hardware; width fill at least 97%; height fill at least 98%; canvas ratio within 1% of ${canvasRatio.toFixed(6)}; one full uncropped shell; Black Gel unchanged; no logo or guide residue. Reject before output if the camera plate is neutral black/grey or if the size regresses. Output exactly ONE image only.

${originalContract(source.promptText)}`
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const source = sourceManifest.prompts.find((entry) => entry.modelId === modelId && entry.finish === finish)
if (!source) throw new Error(`${modelId}:${finish} is not in ${sourceManifestPath}`)
if (source.publish || source.setCurrent) throw new Error(`${modelId}:${finish} is not candidate-only`)
await Promise.all(source.referenceImages.map((filePath) => access(filePath)))

const [bounds, bytes] = await Promise.all([
  subjectBounds(source.candidatePath),
  readFile(source.candidatePath),
])
const widthFill = bounds.width / bounds.canvasWidth
const heightFill = bounds.height / bounds.canvasHeight
if (widthFill < minimumWidthFill || heightFill < minimumHeightFill) {
  throw new Error(`${modelId}:${finish} does not clear the size gate; do not start a camera-only retry`)
}

const fileName = `${modelId}-${finish}-${candidateVersion}.png`
const candidatePath = path.join(path.dirname(source.candidatePath), fileName)
const localImagePath = path.join(path.dirname(source.localImagePath), fileName)
await Promise.all([assertMissing(candidatePath), assertMissing(localImagePath), assertMissing(outputPath)])

const promptText = cameraLockPrompt(source, bounds)
const prompt = {
  ...source,
  candidateVersion,
  promptText,
  promptSha256: sha256(promptText),
  candidatePath,
  localImagePath,
  imagePath: `${path.posix.dirname(source.imagePath)}/${fileName}`,
  reviewStatus: 'pending-generation',
  generationAttempt: 'camera-hardware-lock-followup',
  retryOf: {
    candidateVersion: source.candidateVersion,
    candidatePath: source.candidatePath,
    sha256: sha256(bytes),
    measuredFill: {
      width: Number(widthFill.toFixed(6)),
      height: Number(heightFill.toFixed(6)),
    },
    reason: 'Camera island colour drifted from the purple-grey IMAGE 1/5 hardware to neutral black/grey',
  },
}

const manifest = {
  schemaVersion: 1,
  campaign: `${modelId}-${finish}-${candidateVersion}-camera-lock-followup`,
  generatedBy: 'scripts/build-iphone-camera-lock-followup.mjs',
  sourceManifestPath,
  publish: false,
  candidateOnly: true,
  thresholds: { minimumWidthFill, minimumHeightFill },
  generationPolicy: 'Retry one size-passing candidate for exact source camera hardware identity; never publish before user review.',
  prompts: [prompt],
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  target: `${modelId}:${finish}`,
  version: candidateVersion,
  rejectedCandidate: source.candidateVersion,
  passedFill: prompt.retryOf.measuredFill,
  promptSha256: prompt.promptSha256,
  wrote: shouldWrite,
  outputPath,
}, null, 2))