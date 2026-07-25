import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outputPath = 'reference/case-history/iphone-14-16-user-corrections.json'
const historicalManifestPath = 'reference/case-history/iphone-black-white-glitter-shape-trials.json'
const promotionManifestPath = 'reference/case-history/iphone-14-15-black-white-gpt-promotion.json'
const campaignRoot = 'reference/case-history/generated/black-white-glitter-shape-trials'
const referencesDir = `${campaignRoot}/references`
const candidatesDir = `${campaignRoot}/candidates`
const publicDir = 'public/assets/cases/case-history/gpt-conversation-attempts'
const publicUrlRoot = '/assets/cases/case-history/gpt-conversation-attempts'
const shouldWrite = process.argv.includes('--write')

const sizeTargets = [
  ['iphone-14-plus', 'iPhone 14 Plus', 'black', 'v3-gpt'],
  ['iphone-14-plus', 'iPhone 14 Plus', 'white', 'v2-gpt'],
  ['iphone-14-pro', 'iPhone 14 Pro', 'black', 'v2-gpt'],
  ['iphone-14-pro', 'iPhone 14 Pro', 'white', 'v3-gpt'],
  ['iphone-14-pro-max', 'iPhone 14 Pro Max', 'black', 'v5-gpt'],
  ['iphone-14-pro-max', 'iPhone 14 Pro Max', 'white', 'v2-gpt'],
  ['iphone-15', 'iPhone 15', 'black', 'v2-gpt'],
  ['iphone-15', 'iPhone 15', 'white', 'v2-gpt'],
  ['iphone-15-plus', 'iPhone 15 Plus', 'black', 'v2-gpt'],
  ['iphone-15-plus', 'iPhone 15 Plus', 'white', 'v3-gpt'],
  ['iphone-15-pro', 'iPhone 15 Pro', 'black', 'v7-gpt'],
  ['iphone-15-pro', 'iPhone 15 Pro', 'white', 'v3-gpt'],
].map(([modelId, modelName, finish, candidateVersion]) => ({
  modelId,
  modelName,
  finish,
  candidateVersion,
  correctionType: 'source-grid-size-correction',
}))

const shapeTargets = [
  ['iphone-16', 'iPhone 16', 'black', 'v4-gpt'],
  ['iphone-16', 'iPhone 16', 'white', 'v1-gpt'],
  ['iphone-16', 'iPhone 16', 'glitter', 'v1-gpt'],
  ['iphone-16-plus', 'iPhone 16 Plus', 'black', 'v1-gpt'],
  ['iphone-16-plus', 'iPhone 16 Plus', 'white', 'v1-gpt'],
].map(([modelId, modelName, finish, candidateVersion]) => ({
  modelId,
  modelName,
  finish,
  candidateVersion,
  correctionType: 'iphone-16-plus-glitter-v2-geometry-only',
}))

const regenerationTargets = [
  ['iphone-16-pro', 'iPhone 16 Pro', 'black', 'v1-gpt'],
  ['iphone-16-pro', 'iPhone 16 Pro', 'white', 'v1-gpt'],
  ['iphone-16-pro-max', 'iPhone 16 Pro Max', 'black', 'v1-gpt'],
  ['iphone-16-pro-max', 'iPhone 16 Pro Max', 'white', 'v1-gpt'],
].map(([modelId, modelName, finish, candidateVersion]) => ({
  modelId,
  modelName,
  finish,
  candidateVersion,
  correctionType: 'full-black-white-regeneration',
}))

const historicalManifest = JSON.parse(await readFile(historicalManifestPath, 'utf8'))
const promotionManifest = JSON.parse(await readFile(promotionManifestPath, 'utf8'))

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function historicalPrompt(modelId, finish) {
  const prompt = historicalManifest.prompts.find((entry) => (
    entry.modelId === modelId && entry.finish === finish
  ))
  if (!prompt) throw new Error(`Missing historical prompt for ${modelId}:${finish}`)
  return prompt
}

function referencePath(fileName) {
  return fileName.includes('/') ? fileName : `${referencesDir}/${fileName}`
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

function sizePrompt(target, basePrompt, bounds) {
  const label = target.finish === 'black' ? 'Black' : 'White'
  return `USER SIZE CORRECTION - REGENERATE EXACTLY ONE ${target.modelName} ${label} GEL IMAGE FROM THE SIX ATTACHMENTS.

The previous accepted candidate is now rejected only because the complete phone/case product was rendered visibly too small and, in some versions, with the wrong width-to-height proportion. Do not preserve, imitate or infer that rejected generated framing. Start again from IMAGE 1.

SOURCE PIXEL-GRID AND PRODUCT-SCALE LOCK - HIGHEST PRIORITY: IMAGE 1 is ${bounds.canvasWidth}x${bounds.canvasHeight}px. Its visible product bounds are x=${bounds.left}..${bounds.right}, y=${bounds.top}..${bounds.bottom}, measuring ${bounds.width}x${bounds.height}px. The final image must use that same portrait aspect ratio, same full-product scale, same straight-on position and the same near-edge margins. The complete case must fill the frame to the same degree as IMAGE 1. Do not add the broad white margins seen in the rejected candidate. Do not make the product smaller, narrower, shorter, wider, taller, zoomed out or floating in excess background.

IMAGE 1 alone controls the complete product grid: exact silhouette, phone proportions, camera size and coordinates, buttons, corners, bottom edge, shell and shadows. IMAGE 2 is a camera-free material crop and has ZERO scale, framing, silhouette or geometry authority. IMAGE 3 and IMAGE 4 control only the established Gel footprint. IMAGE 5 controls only camera hardware. IMAGE 6 controls only ${label} material.

Keep every established Gel detail from the six-image contract below, but obey the source-grid lock above whenever any instruction could be read differently. After rendering, compare the complete outer case bounds to IMAGE 1: all four sides must land at the same normalized coordinates, with no extra canvas padding.

${basePrompt}

FINAL SIZE PASS/FAIL: reject the result if the complete product is not the same normalized size and width-to-height proportion as IMAGE 1, even if its Gel material is otherwise correct. Output exactly ONE image only.`
}

function shapePrompt(target) {
  const label = target.finish === 'black' ? 'Black' : 'White'
  const shell = target.finish === 'black' ? 'BLACK' : 'OFF-WHITE'
  const hardware = 'exactly TWO large lenses stacked VERTICALLY in the original narrow vertical camera housing, with the original separate circular flash to its right'
  return `Generate exactly ONE NEW full-canvas ${target.modelName} ${label} Gel product image from the SIX attachments.

ATTACHMENT AUTHORITY:
IMAGE 1 = the exact bare ${shell} ${target.modelName} source. It alone controls the complete phone, shell, ${hardware}, scale, proportions, framing, buttons, corners, bottom edge, shadows and pure-white exterior background.
IMAGE 2 = a camera-free crop from the current accepted ${label} result. It controls ONLY the existing ${label} Gel visual details: colour, opacity, centre finish, raised-bead thickness, folds and highlight language. Its crop and old edge route have no geometry authority.
IMAGE 3 = the accepted iPhone 16 Plus Glitter v2 benchmark. It controls ONLY the complete normalized Gel SHAPE AND POSITION. Never copy its phone scale, hardware, shell, Glitter particles, colour or material.
IMAGE 4 = IMAGE 1 with the iPhone 16 Plus Glitter v2 footprint mapped into IMAGE 1 coordinates as a closed red guide. It is the final Gel boundary authority.
IMAGE 5 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash and sensors.
IMAGE 6 = the existing ${label} material reference. It reinforces material only and has zero product or geometry authority.

USER CORRECTION - ONLY SHAPE AND POSITION MAY CHANGE: preserve the current ${label} Gel colour, opacity, texture, centre treatment, gloss, folds, edge thickness, highlights and every other visual detail defined by IMAGE 2 and IMAGE 6. Change only the Gel footprint so it matches IMAGE 3 and IMAGE 4. Do not redesign, smooth, intensify, flatten, recolour or otherwise alter the material.

ABSOLUTE PRODUCT LOCK: preserve IMAGE 1's exact ${target.modelName}, ${hardware}, shell colour and texture, silhouette, native width-to-height ratio, product scale, position, framing, buttons, all four corners, complete bottom edge and shadows. Keep the whole phone straight-on, centred, fully visible and uncropped. Never zoom, crop, reframe, rotate, resize, widen, shorten, redraw, substitute hardware, change lens count or add a logo.

PLUS-GLITTER-V2 GEOMETRY LOCK: transfer IMAGE 3's footprint into the target coordinates exactly as resolved by IMAGE 4. Fill the complete red-tinted interior with one continuous ${label} Gel slab. Put the centreline of the OUTERMOST raised bead directly on the complete closed red route, then remove every red pixel. Do not inset, shrink, lower, centre, straighten, simplify or approximate it.

CAMERA-SIDE ROUTE: keep the narrow clean strip beneath the complete vertical camera housing, follow the short under-camera shoulder, begin one broad early up-and-right rise beside the camera/flash area, form one wide high soft crown, then descend the right edge. Do not trace individual lenses, create a moat, notch, keyhole, narrow neck, flat top or detached patch. Keep the complete camera hardware outside the Gel.

OUTER FIT: along the complete left, bottom and right sides, reproduce IMAGE 3's ultra-close fit to the inner silicone wall. Leave only the same continuous shell-colour hairline and tiny contact shadow. Do not widen the gap, touch the wall, fuse Gel into silicone or create a double rim.

FINAL QA: exact source phone and framing; existing ${label} material unchanged; only Gel shape/position changed; iPhone 16 Plus Glitter v2 footprint copied exactly; no Glitter, red residue, logo, text or symbol. Output exactly ONE photorealistic full back-view image only.`
}

function glitterShapePrompt(target, bounds) {
  return `Perform exactly ONE localized geometry correction on the iPhone 16 Glitter Gel image from the FOUR attachments.

IMAGE 1 = the current accepted iPhone 16 Glitter v2 image and the SOLE authority for the complete phone, shell, camera hardware, ${bounds.canvasWidth}x${bounds.canvasHeight}px canvas, product scale, framing, shadows and every existing Glitter Gel visual detail.
IMAGE 2 = the accepted iPhone 16 Plus Glitter v2 benchmark. It controls ONLY the normalized Gel SHAPE AND POSITION.
IMAGE 3 = IMAGE 1 with the iPhone 16 Plus Glitter v2 footprint mapped into its exact pixel grid as a closed red guide. It is the final Gel boundary authority.
IMAGE 4 = the exact iPhone 16 camera hardware crop. It locks the two vertically stacked lenses, narrow vertical housing, separate circular flash and sensors.

USER CORRECTION - ONLY GEL SHAPE AND POSITION MAY CHANGE. Preserve IMAGE 1's exact Glitter substance: identical transparent-to-milky body, particle size and density, optical depth, folds, wrinkles, refraction, wet highlights, raised-bead thickness, gloss and colour. Preserve the complete phone, shell, hardware, native proportions, product scale, white background and shadows. Do not regenerate, simplify, recolour, relight, zoom, crop, resize, widen, shorten or reframe any other detail.

Replace only the old Gel footprint. Transfer IMAGE 2's complete normalized footprint into iPhone 16 coordinates exactly as shown by IMAGE 3. Reflow the same existing Glitter Gel to cover the complete red-tinted interior. Put the centreline of the OUTERMOST raised wet bead directly on the complete closed red line, then remove every red pixel.

Copy the benchmark route exactly: a narrow clean strip under the complete camera housing, a short under-camera shoulder, one early broad up-and-right rise beside the camera/flash area, one wide high soft crown, and an ultra-close continuous hairline shell reveal along the full left, bottom and right sides. Do not preserve IMAGE 1's old lower crown or old camera-side curve. Do not create a moat, notch, keyhole, flat top, narrow neck, detached patch, wider outer gap or double rim.

FINAL PASS/FAIL: IMAGE 1's phone and Glitter rendering remain unchanged; only the Gel footprint changes to iPhone 16 Plus Glitter v2; exact ${bounds.canvasWidth}x${bounds.canvasHeight}px source composition; no red residue, logo, text or symbol. Output exactly ONE photorealistic full back-view image only.`
}

function regenerationPrompt(target, basePrompt) {
  const label = target.finish === 'black' ? 'Black' : 'White'
  return `FULL REGENERATION REQUEST: generate a completely new ${target.modelName} ${label} Gel image from the SIX authoritative attachments. The previous ${label} render is rejected. Do not edit, preserve, trace or reuse that rejected output. Rebuild from the exact bare source, same-model Glitter geometry, mapped guide, camera lock and ${label} material references.

This is a fresh Black/White regeneration, not a change to the accepted same-model Glitter image. Keep the Glitter finish untouched and use it only for footprint geometry. The new result remains unpublished until user review.

${basePrompt}

FINAL REGENERATION QA: fresh ${label} result; exact source phone, hardware, scale and framing; accepted same-model Glitter footprint; correct ${label} material; no logo, text, red guide or Glitter contamination. Output exactly ONE image only.`
}

function shapeReferences(target) {
  if (target.finish === 'glitter') {
    return [
      `${referencesDir}/trial-iphone-16-accepted-glitter-geometry.png`,
      `${referencesDir}/trial-iphone-16-plus-accepted-glitter-geometry.png`,
      `${referencesDir}/trial-iphone-16-glitter-plus-glitter-shape-guide.png`,
      `${referencesDir}/trial-iphone-16-white-camera-lock.png`,
    ]
  }
  const guideName = target.modelId === 'iphone-16'
    ? `trial-iphone-16-${target.finish}-plus-glitter-shape-guide.png`
    : `trial-iphone-16-plus-${target.finish}-glitter-shape-guide.png`
  return [
    `${referencesDir}/trial-${target.modelId}-${target.finish}-source.png`,
    `${referencesDir}/trial-${target.modelId}-${target.finish}-current-style.png`,
    `${referencesDir}/trial-iphone-16-plus-accepted-glitter-geometry.png`,
    `${referencesDir}/${guideName}`,
    `${referencesDir}/trial-${target.modelId}-${target.finish}-camera-lock.png`,
    `${referencesDir}/trial-${target.finish}-material.png`,
  ]
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

async function recordFor(target) {
  let promptText
  let referenceImages
  let sourcePath
  let expectedImageVersion
  if (target.correctionType === 'source-grid-size-correction') {
    const historical = historicalPrompt(target.modelId, target.finish)
    referenceImages = historical.referenceImages.map(referencePath)
    sourcePath = referenceImages[0]
    const bounds = await subjectBounds(sourcePath)
    promptText = sizePrompt(target, historical.promptText, bounds)
    const current = promotionManifest.prompts.find((entry) => (
      entry.modelId === target.modelId && entry.finish === target.finish
    ))
    if (!current) throw new Error(`Missing current promotion for ${target.modelId}:${target.finish}`)
    expectedImageVersion = current.imageVersion
  } else if (target.correctionType === 'iphone-16-plus-glitter-v2-geometry-only') {
    referenceImages = shapeReferences(target)
    sourcePath = referenceImages[0]
    const bounds = await subjectBounds(sourcePath)
    promptText = target.finish === 'glitter'
      ? glitterShapePrompt(target, bounds)
      : shapePrompt(target)
    if (target.finish === 'glitter') expectedImageVersion = 'v2'
  } else {
    const historical = historicalPrompt(target.modelId, target.finish)
    referenceImages = historical.referenceImages.map(referencePath)
    sourcePath = referenceImages[0]
    promptText = regenerationPrompt(target, historical.promptText)
  }

  await Promise.all(referenceImages.map((filePath) => access(filePath)))
  const fileName = `${target.modelId}-${target.finish}-${target.candidateVersion}.png`
  const candidatePath = `${candidatesDir}/${fileName}`
  const localImagePath = `${publicDir}/${fileName}`
  await Promise.all([assertMissing(candidatePath), assertMissing(localImagePath)])

  return {
    modelId: target.modelId,
    modelName: target.modelName,
    finish: target.finish,
    correctionType: target.correctionType,
    candidateVersion: target.candidateVersion,
    ...(expectedImageVersion ? { expectedImageVersion } : {}),
    publish: false,
    setCurrent: false,
    generator: 'ChatGPT image generation',
    promptText,
    promptSha256: sha256(promptText),
    referenceImages,
    sourcePath,
    candidatePath,
    localImagePath,
    imagePath: `${publicUrlRoot}/${fileName}`,
    reviewStatus: 'pending-generation',
  }
}

const prompts = []
for (const target of [...sizeTargets, ...shapeTargets, ...regenerationTargets]) {
  prompts.push(await recordFor(target))
}

if (prompts.length !== 21) throw new Error(`Expected 21 prompts, found ${prompts.length}`)
if (new Set(prompts.map((entry) => `${entry.modelId}:${entry.finish}`)).size !== prompts.length) {
  throw new Error('Duplicate model/finish target')
}
if (prompts.some((entry) => entry.publish || entry.setCurrent)) {
  throw new Error('Correction candidates must remain unpublished')
}
if (prompts.some((entry) => entry.modelId === 'iphone-15-pro-max')) {
  throw new Error('iPhone 15 Pro Max must not be included')
}
if (prompts.some((entry) => entry.modelId === 'iphone-16-plus' && entry.finish === 'glitter')) {
  throw new Error('iPhone 16 Plus Glitter v2 is the benchmark and must not be regenerated')
}
if (new Set(prompts.map((entry) => entry.candidatePath)).size !== prompts.length) {
  throw new Error('Duplicate candidate path')
}
if (new Set(prompts.map((entry) => entry.promptSha256)).size !== prompts.length) {
  throw new Error('Prompt text must be unique per target')
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-14-16-user-corrections',
  generatedBy: 'scripts/build-iphone-14-16-user-corrections.mjs',
  publish: false,
  candidateOnly: true,
  benchmark: {
    modelId: 'iphone-16-plus',
    finish: 'glitter',
    imageVersion: 'v2',
    sha256: '2caf0bc63bd01474a5f936803ca2ad0154c18af71a639a52f2eb38232efd6271',
    widthPx: 863,
    heightPx: 1822,
    referenceImage: `${referencesDir}/trial-iphone-16-plus-accepted-glitter-geometry.png`,
  },
  generationPolicy: 'Create 12 source-grid size corrections for selected iPhone 14/15 Black and White finishes, 5 shape-only iPhone 16/16 Plus corrections using iPhone 16 Plus Glitter v2, and 4 fresh iPhone 16 Pro/Pro Max Black and White candidates. Never publish before user review.',
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  records: prompts.length,
  sizeCorrections: prompts.filter((entry) => entry.correctionType === 'source-grid-size-correction').length,
  shapeOnlyCorrections: prompts.filter((entry) => entry.correctionType === 'iphone-16-plus-glitter-v2-geometry-only').length,
  fullRegenerations: prompts.filter((entry) => entry.correctionType === 'full-black-white-regeneration').length,
  referencesVerified: prompts.reduce((total, entry) => total + entry.referenceImages.length, 0),
  uniquePrompts: new Set(prompts.map((entry) => entry.promptSha256)).size,
  wrote: shouldWrite,
  outputPath,
}, null, 2))