import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const sourceManifestPath = 'reference/case-history/iphone-16-logo-safe-shape-corrections.json'
const outputPath = 'reference/case-history/iphone-16-shape-grid-retries.json'
const shouldWrite = process.argv.includes('--write')

const retryVersions = new Map([
  ['iphone-16:black', 'v6-gpt'],
  ['iphone-16:white', 'v3-gpt'],
  ['iphone-16-plus:white', 'v2-gpt'],
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

function gridLock(source, bounds) {
  const canvasRatio = bounds.canvasWidth / bounds.canvasHeight
  return `EXACT SOURCE-GRID RETRY - HIGHEST PRIORITY: the previous logo-safe candidate correctly removed all branding, but it is rejected because the complete phone/case width-to-height proportion drifted from IMAGE 1. Regenerate from the authoritative attachments; do not edit, trace or reuse that rejected candidate.

IMAGE 1 is exactly ${bounds.canvasWidth}x${bounds.canvasHeight}px, with canvas width/height ratio ${canvasRatio.toFixed(6)}. Its visible product bounds are x=${bounds.left}..${bounds.right}, y=${bounds.top}..${bounds.bottom}, measuring ${bounds.width}x${bounds.height}px. The final full canvas and complete visible product MUST use that same portrait ratio and the same normalized four-side coordinates. Preserve the exact width relative to height. Do not make the phone narrower, taller, shorter, wider, zoomed out, padded or recentered. Do not substitute a common portrait aspect ratio. IMAGE 3, material crops and camera crops have ZERO canvas-ratio authority.

The opaque red guide is registered to IMAGE 1's exact grid. It remains the sole Gel boundary authority and must continue to hide all branding. Preserve the blank unbranded Gel centre achieved by the logo-safe contract: no Apple logo, ghost, icon, text or symbol. Only correct the rejected product/canvas proportion while performing the same Gel-shape transfer.

FINAL GRID PASS/FAIL: reject the result unless its canvas width/height ratio is within 1% of ${canvasRatio.toFixed(6)} and the complete product lands at IMAGE 1's normalized left, top, right and bottom bounds. Output exactly ONE image only.

${source.promptText}`
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const prompts = []
for (const source of sourceManifest.prompts) {
  const key = `${source.modelId}:${source.finish}`
  const candidateVersion = retryVersions.get(key)
  if (!candidateVersion) continue

  await Promise.all(source.referenceImages.map((filePath) => access(filePath)))
  const bounds = await subjectBounds(source.sourcePath)
  const previousBytes = await readFile(source.candidatePath)
  const promptText = gridLock(source, bounds)
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
    generationAttempt: 'logo-safe-source-grid-retry',
    sourceGrid: {
      canvasWidth: bounds.canvasWidth,
      canvasHeight: bounds.canvasHeight,
      canvasRatio: Number((bounds.canvasWidth / bounds.canvasHeight).toFixed(6)),
      productBounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
    },
    retryOf: {
      candidateVersion: source.candidateVersion,
      candidatePath: source.candidatePath,
      sha256: sha256(previousBytes),
      reason: 'Canvas/product width-to-height proportion drifted beyond strict shape-only tolerance',
    },
  })
}

if (prompts.length !== retryVersions.size) {
  throw new Error(`Expected ${retryVersions.size} grid retries, found ${prompts.length}`)
}
if (prompts.some((entry) => entry.publish || entry.setCurrent)) {
  throw new Error('Grid retry candidates must remain unpublished')
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-16-shape-grid-retries',
  generatedBy: 'scripts/build-iphone-16-shape-grid-retries.mjs',
  sourceManifestPath,
  publish: false,
  candidateOnly: true,
  generationPolicy: 'Retry only the three logo-safe shape candidates whose canvas/product proportions drifted beyond strict tolerance. Preserve geometry, material, hardware and unbranded centres; never publish before user review.',
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
  sourceGrids: prompts.map((entry) => ({
    target: `${entry.modelId}:${entry.finish}`,
    ...entry.sourceGrid,
  })),
  wrote: shouldWrite,
  outputPath,
}, null, 2))