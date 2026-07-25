import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const sourceManifestPath = 'reference/case-history/iphone-14-16-user-corrections.json'
const outputPath = 'reference/case-history/iphone-14-15-grid-retries.json'
const shouldWrite = process.argv.includes('--write')
const minimumWidthFill = 0.97
const minimumHeightFill = 0.98

const retryVersions = new Map([
  ['iphone-14-plus:black', 'v4-gpt'],
  ['iphone-14-plus:white', 'v3-gpt'],
  ['iphone-14-pro:black', 'v3-gpt'],
  ['iphone-15:white', 'v3-gpt'],
  ['iphone-15-plus:black', 'v3-gpt'],
  ['iphone-15-pro:black', 'v8-gpt'],
])

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
  throw new Error(`${filePath} already exists; increment candidateVersion`)
}

function fill(bounds) {
  return {
    width: bounds.width / bounds.canvasWidth,
    height: bounds.height / bounds.canvasHeight,
  }
}

function gridRetryPrompt(source, sourceBounds, candidateFill) {
  const sourceRatio = sourceBounds.canvasWidth / sourceBounds.canvasHeight
  return `SECOND SIZE CORRECTION - EXACT PRODUCT-BOUND RETRY - HIGHEST PRIORITY: the previous correction is rejected because its measured complete-product fill was only ${(candidateFill.width * 100).toFixed(2)}% of canvas width and ${(candidateFill.height * 100).toFixed(2)}% of canvas height. Do not edit, trace, preserve or infer that rejected generated framing. Start again from IMAGE 1.

IMAGE 1 is exactly ${sourceBounds.canvasWidth}x${sourceBounds.canvasHeight}px with canvas width/height ratio ${sourceRatio.toFixed(6)}. Its visible product bounds are x=${sourceBounds.left}..${sourceBounds.right}, y=${sourceBounds.top}..${sourceBounds.bottom}, measuring ${sourceBounds.width}x${sourceBounds.height}px. The final image MUST preserve that canvas ratio and land the complete product on those same normalized four-side coordinates. Product fill must be at least 97% of canvas width and 98% of canvas height. Bring the shell to the near-edge source margins. Do not leave broad white side or bottom margins, make the case float, shrink it, narrow it, shorten it, add padding, zoom out or substitute a common portrait ratio.

IMAGE 1 alone controls product scale, width-to-height proportion and framing. Material crops, Glitter references, camera crops and generated examples have ZERO scale authority. Preserve all Gel geometry, material and hardware requirements from the contract below, but reject the result if the complete outer shell does not meet the numeric product-fill gate.

FINAL MEASURED PASS/FAIL: canvas ratio within 1% of ${sourceRatio.toFixed(6)}; visible product width fill at least 97%; visible product height fill at least 98%; exact source camera hardware; no red residue, logo, text or Glitter contamination. Output exactly ONE image only.

${source.promptText}`
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const prompts = []
for (const source of sourceManifest.prompts.filter((entry) => (
  entry.correctionType === 'source-grid-size-correction'
))) {
  await Promise.all(source.referenceImages.map((filePath) => access(filePath)))
  const [sourceBounds, candidateBounds, previousBytes] = await Promise.all([
    subjectBounds(source.sourcePath),
    subjectBounds(source.candidatePath),
    readFile(source.candidatePath),
  ])
  const candidateFill = fill(candidateBounds)
  const failed = candidateFill.width < minimumWidthFill || candidateFill.height < minimumHeightFill
  const key = `${source.modelId}:${source.finish}`
  if (!failed) {
    if (retryVersions.has(key)) throw new Error(`${key} now passes but still has a retry version`)
    continue
  }

  const candidateVersion = retryVersions.get(key)
  if (!candidateVersion) throw new Error(`Missing retry version for failing ${key}`)
  const promptText = gridRetryPrompt(source, sourceBounds, candidateFill)
  const fileName = `${source.modelId}-${source.finish}-${candidateVersion}.png`
  const candidatePath = path.join(path.dirname(source.candidatePath), fileName)
  const localImagePath = path.join(path.dirname(source.localImagePath), fileName)
  await Promise.all([assertMissing(candidatePath), assertMissing(localImagePath)])

  prompts.push({
    ...source,
    candidateVersion,
    promptText,
    promptSha256: sha256(promptText),
    candidatePath,
    localImagePath,
    imagePath: `${path.posix.dirname(source.imagePath)}/${fileName}`,
    reviewStatus: 'pending-generation',
    generationAttempt: 'exact-product-bound-retry',
    sourceGrid: {
      canvasWidth: sourceBounds.canvasWidth,
      canvasHeight: sourceBounds.canvasHeight,
      canvasRatio: Number((sourceBounds.canvasWidth / sourceBounds.canvasHeight).toFixed(6)),
      productBounds: [sourceBounds.left, sourceBounds.top, sourceBounds.right, sourceBounds.bottom],
    },
    retryOf: {
      candidateVersion: source.candidateVersion,
      candidatePath: source.candidatePath,
      sha256: sha256(previousBytes),
      measuredFill: {
        width: Number(candidateFill.width.toFixed(6)),
        height: Number(candidateFill.height.toFixed(6)),
      },
      reason: 'Visible product fill remained below the strict 97% width / 98% height review gate',
    },
  })
}

if (prompts.length !== retryVersions.size) {
  throw new Error(`Expected ${retryVersions.size} size retries, found ${prompts.length}`)
}
if (prompts.some((entry) => entry.publish || entry.setCurrent)) {
  throw new Error('Size retry candidates must remain unpublished')
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-14-15-grid-retries',
  generatedBy: 'scripts/build-iphone-14-15-grid-retries.mjs',
  sourceManifestPath,
  publish: false,
  candidateOnly: true,
  thresholds: { minimumWidthFill, minimumHeightFill },
  generationPolicy: 'Retry only iPhone 14/15 size candidates below the strict normalized product-fill gate. Preserve source hardware, Gel geometry and material; never publish before user review.',
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  records: prompts.length,
  referencesVerified: prompts.reduce((total, entry) => total + entry.referenceImages.length, 0),
  uniquePrompts: new Set(prompts.map((entry) => entry.promptSha256)).size,
  retries: prompts.map((entry) => ({
    target: `${entry.modelId}:${entry.finish}`,
    version: entry.candidateVersion,
    rejectedFill: entry.retryOf.measuredFill,
    sourceGrid: entry.sourceGrid,
  })),
  wrote: shouldWrite,
  outputPath,
}, null, 2))