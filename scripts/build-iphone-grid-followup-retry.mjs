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

function fill(bounds) {
  return {
    width: bounds.width / bounds.canvasWidth,
    height: bounds.height / bounds.canvasHeight,
  }
}

function originalContract(promptText) {
  const marker = '\n\nUSER SIZE CORRECTION -'
  const markerIndex = promptText.indexOf(marker)
  return markerIndex >= 0 ? promptText.slice(markerIndex + 2) : promptText
}

function followupPrompt(source, sourceBounds, rejectedFill) {
  const sourceRatio = sourceBounds.canvasWidth / sourceBounds.canvasHeight
  const sourceWidthFill = sourceBounds.width / sourceBounds.canvasWidth
  const sourceHeightFill = sourceBounds.height / sourceBounds.canvasHeight
  return `THIRD SIZE CORRECTION - SOURCE-EDGE PRODUCT-BOUND RETRY - HIGHEST PRIORITY: the immediately previous exact-bound candidate is archived and rejected because it still measured only ${(rejectedFill.width * 100).toFixed(2)}% of canvas width and ${(rejectedFill.height * 100).toFixed(2)}% of canvas height. Do not preserve, trace, edit or infer that rejected candidate's framing. Start again from IMAGE 1.

IMAGE 1 is exactly ${sourceBounds.canvasWidth}x${sourceBounds.canvasHeight}px with canvas ratio ${sourceRatio.toFixed(6)}. Its complete product bounds are x=${sourceBounds.left}..${sourceBounds.right}, y=${sourceBounds.top}..${sourceBounds.bottom}, measuring ${sourceBounds.width}x${sourceBounds.height}px (${(sourceWidthFill * 100).toFixed(2)}% width and ${(sourceHeightFill * 100).toFixed(2)}% height fill). Match those four normalized source coordinates, not the previous generated image.

ZERO HORIZONTAL PADDING - NON-NEGOTIABLE: the source product reaches ${sourceBounds.left === 0 ? 'the left canvas edge' : `x=${sourceBounds.left}`} and ${sourceBounds.right === sourceBounds.canvasWidth - 1 ? 'the right canvas edge' : `x=${sourceBounds.right}`}. The final outer silicone shell must reach the same normalized left and right coordinates. Leave no replacement white side strips, no conventional product-photo margin and no centring padding. This is not permission to crop or widen the phone: preserve the complete source contour and source width-to-height proportion while matching its edge placement.

SOURCE-SCALE TARGET: aim for at least ${(Math.max(0.99, sourceWidthFill) * 100).toFixed(2)}% width fill and ${(Math.max(0.99, sourceHeightFill) * 100).toFixed(2)}% height fill so the measured result safely clears the hard 97% width / 98% height gate. IMAGE 1 alone controls canvas ratio, product scale, framing and hardware. All material crops, generated examples, camera crops and Glitter references have ZERO scale authority.

FINAL MEASURED PASS/FAIL: reject before output if width fill is below 97%, height fill is below 98%, canvas ratio differs from ${sourceRatio.toFixed(6)} by more than 1%, or either side has added white padding. Preserve the full Gel contract below, exact source camera hardware and one complete uncropped shell. No red residue, logo, text, icon, Glitter contamination or extra object. Output exactly ONE image only.

${originalContract(source.promptText)}`
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const source = sourceManifest.prompts.find((entry) => entry.modelId === modelId && entry.finish === finish)
if (!source) throw new Error(`${modelId}:${finish} is not in ${sourceManifestPath}`)
if (source.publish || source.setCurrent) throw new Error(`${modelId}:${finish} is not candidate-only`)
await Promise.all(source.referenceImages.map((filePath) => access(filePath)))

const [sourceBounds, rejectedBounds, rejectedBytes] = await Promise.all([
  subjectBounds(source.sourcePath),
  subjectBounds(source.candidatePath),
  readFile(source.candidatePath),
])
const rejectedFill = fill(rejectedBounds)
if (rejectedFill.width >= minimumWidthFill && rejectedFill.height >= minimumHeightFill) {
  throw new Error(`${modelId}:${finish} already clears the strict product-fill gate`)
}

const fileName = `${modelId}-${finish}-${candidateVersion}.png`
const candidatePath = path.join(path.dirname(source.candidatePath), fileName)
const localImagePath = path.join(path.dirname(source.localImagePath), fileName)
await Promise.all([assertMissing(candidatePath), assertMissing(localImagePath), assertMissing(outputPath)])

const promptText = followupPrompt(source, sourceBounds, rejectedFill)
const prompt = {
  ...source,
  candidateVersion,
  promptText,
  promptSha256: sha256(promptText),
  candidatePath,
  localImagePath,
  imagePath: `${path.posix.dirname(source.imagePath)}/${fileName}`,
  reviewStatus: 'pending-generation',
  generationAttempt: 'source-edge-product-bound-followup',
  sourceGrid: {
    canvasWidth: sourceBounds.canvasWidth,
    canvasHeight: sourceBounds.canvasHeight,
    canvasRatio: Number((sourceBounds.canvasWidth / sourceBounds.canvasHeight).toFixed(6)),
    productBounds: [sourceBounds.left, sourceBounds.top, sourceBounds.right, sourceBounds.bottom],
  },
  retryOf: {
    candidateVersion: source.candidateVersion,
    candidatePath: source.candidatePath,
    sha256: sha256(rejectedBytes),
    measuredFill: {
      width: Number(rejectedFill.width.toFixed(6)),
      height: Number(rejectedFill.height.toFixed(6)),
    },
    reason: 'Visible product fill remained below the strict 97% width / 98% height review gate',
  },
}

const manifest = {
  schemaVersion: 1,
  campaign: `${modelId}-${finish}-${candidateVersion}-grid-followup`,
  generatedBy: 'scripts/build-iphone-grid-followup-retry.mjs',
  sourceManifestPath,
  publish: false,
  candidateOnly: true,
  thresholds: { minimumWidthFill, minimumHeightFill },
  generationPolicy: 'Retry one failed source-grid candidate against exact source-edge coordinates; preserve all generated bytes and never publish before user review.',
  prompts: [prompt],
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  target: `${modelId}:${finish}`,
  version: candidateVersion,
  rejectedFill: prompt.retryOf.measuredFill,
  sourceGrid: prompt.sourceGrid,
  promptSha256: prompt.promptSha256,
  wrote: shouldWrite,
  outputPath,
}, null, 2))