import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputPath = 'reference/case-history/iphone-white-pixel-material-regeneration.json'
const referencesDir = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const candidatesDir = 'reference/case-history/generated/black-white-glitter-shape-trials/candidates'
const publicDir = 'public/assets/cases/case-history/gpt-conversation-attempts'
const pixelMaterial = 'public/assets/cases/gpt-references/gpt-glitter-pixel-10-pro.png'

const targets = [
  {
    modelId: 'iphone-11-pro-max',
    modelName: 'iPhone 11 Pro Max',
    candidateVersion: 'v7-gpt',
    expectedImageVersion: 'v4',
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash and black dotted microphone and no LiDAR sensor',
  },
  {
    modelId: 'iphone-12-pro',
    modelName: 'iPhone 12 Pro',
    candidateVersion: 'v5-gpt',
    expectedImageVersion: 'v5',
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash, microphone and LiDAR sensor',
  },
  {
    modelId: 'iphone-12-pro-max',
    modelName: 'iPhone 12 Pro Max',
    candidateVersion: 'v3-gpt',
    expectedImageVersion: 'v4',
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash, microphone and LiDAR sensor',
  },
  {
    modelId: 'iphone-13',
    modelName: 'iPhone 13',
    candidateVersion: 'v3-gpt',
    expectedImageVersion: 'v6',
    hardware: 'exactly TWO large lenses in the original DIAGONAL arrangement, with the original flash and dotted microphone and no Pro sensor',
  },
  {
    modelId: 'iphone-14',
    modelName: 'iPhone 14',
    candidateVersion: 'v13-gpt',
    expectedImageVersion: 'v3',
    combinedGuide: true,
    hardware: 'exactly TWO large lenses in the original DIAGONAL arrangement, with the original flash and dotted microphone and no Pro sensor',
  },
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function promptFor(target) {
  const attachmentCount = target.combinedGuide ? 'FIVE' : 'SIX'
  const whiteImage = target.combinedGuide ? 4 : 5
  const pixelImage = target.combinedGuide ? 5 : 6
  const guideImage = target.combinedGuide ? 1 : 3
  const attachmentAuthority = target.combinedGuide
    ? `IMAGE 1 = the same-pixel-grid OFF-WHITE ${target.modelName} source with the accepted same-model footprint mapped as a closed red guide. It is the sole authority for the complete phone, silicone shell, hardware, scale, proportions, framing, buttons, shadows, pure-white exterior background and final Gel boundary. The red line is the required CENTRELINE of the OUTERMOST raised Gel bead around the complete route.
IMAGE 2 = the latest accepted same-model Glitter result. It confirms ONLY the normalized Gel footprint. Never copy its particles, colour, phone rendering or physical material.
IMAGE 3 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash and microphone.
IMAGE 4 = the previous same-model White result. It controls ONLY the clean neutral-WHITE HUE and absence of metallic or coloured Glitter. It has ZERO authority for opacity, smoothness, texture, gloss, folds, internal flow, edge treatment or footprint.
IMAGE 5 = the Pixel 10 Pro benchmark and the SOLE authority for the COMPLETE PHYSICAL GEL MATERIAL across both the broad interior and outer lip. Copy its wet translucent-to-milky optical depth, viscous poured body, dense fine tone-on-tone internal flow texture, soft wrinkles and folds, uneven pooling, refraction and long liquid highlights. Never copy its Pixel phone, camera bar, crop, proportions or footprint.`
    : `IMAGE 1 = the exact bare OFF-WHITE ${target.modelName} source and the sole authority for the complete phone, silicone shell, hardware, scale, proportions, framing, buttons, shadows and pure-white exterior background.
IMAGE 2 = the latest accepted same-model Glitter result. It controls ONLY the normalized Gel footprint. Never copy its particles, colour, phone rendering or physical material.
IMAGE 3 = IMAGE 1 with that accepted footprint mapped as a closed red guide. The red line is the required CENTRELINE of the OUTERMOST raised Gel bead around the complete route.
IMAGE 4 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash, microphone and sensors.
IMAGE 5 = the previous same-model White result. It controls ONLY the clean neutral-WHITE HUE and absence of metallic or coloured Glitter. It has ZERO authority for opacity, smoothness, texture, gloss, folds, internal flow, edge treatment or footprint.
IMAGE 6 = the Pixel 10 Pro benchmark and the SOLE authority for the COMPLETE PHYSICAL GEL MATERIAL across both the broad interior and outer lip. Copy its wet translucent-to-milky optical depth, viscous poured body, dense fine tone-on-tone internal flow texture, soft wrinkles and folds, uneven pooling, refraction and long liquid highlights. Never copy its Pixel phone, camera bar, crop, proportions or footprint.`

  return `Generate exactly ONE NEW full-canvas ${target.modelName} White Gel product image from the ${attachmentCount} attached images.

ATTACHMENT AUTHORITY:
${attachmentAuthority}

USER REJECTION TO CORRECT: the previous new White image changed the Gel material completely because IMAGE ${pixelImage} controlled only its outer edge. The broad centre became a flat smooth opaque White panel surrounded by a clear gasket. That is wrong. IMAGE ${pixelImage} must now control the physical substance and rendering of EVERY PIXEL OF GEL, from the complete broad centre through the complete outer bead.

PIXEL MATERIAL TRANSFER IS THE MAIN TASK. Reproduce IMAGE ${pixelImage}'s same continuous poured wet Gel medium over the entire guided region: translucent-to-milky white optical depth, visible internal refraction, dense fine WHITE filament-like flow texture embedded throughout the body, soft overlapping flow lines, localized wrinkles and folds, uneven pooled thickness, and long broad liquid highlights. The centre may be slightly calmer than the edge, but it must remain visibly wet, optically deep and materially textured like IMAGE ${pixelImage}; it must never become a featureless airbrushed fill, matte opaque slab, smooth plastic sheet, solid silicone insert, or clear border around a flat centre.

WHITE, NOT GLITTER: translate IMAGE ${pixelImage}'s physical Gel into a clean neutral-WHITE finish. All fine internal filaments and flow texture must be tone-on-tone white and non-metallic. Do not add coloured, silver, gold, iridescent or metallic flecks; discrete reflective dots; star-like pinpoints; sequins; chunky particles; or isolated sparkles. Do not make a Glitter colourway. IMAGE ${whiteImage} controls only this neutral White hue and non-metallic finish; it must not flatten or simplify IMAGE ${pixelImage}'s wet texture.

MATERIAL PASS/FAIL TEST: if the broad centre can be described as smooth, blank-looking, uniformly opaque or textureless, it fails even if the edge is glossy. At normal viewing size, the centre must visibly carry the same family of dense fine white internal flow texture, shallow folds, refraction and wet highlight language as IMAGE ${pixelImage}. If the result looks like a solid White phone back with a separate transparent perimeter gasket, it fails.

GEOMETRY IS INDEPENDENT FROM MATERIAL: put the centreline of the OUTERMOST wet bead directly over the entire closed red route in IMAGE ${guideImage}, then remove every red pixel. Do not inset, shrink, centre, lower, straighten or approximate the route. Preserve the short under-camera shoulder, early broad up-and-right rise beside the camera island, one wide high soft crown, and ultra-close continuous left/bottom/right fit inherited from IMAGE 2 and IMAGE ${guideImage}. The Gel must remain outside the complete camera island and must never wrap individual lenses or sensors.

OUTER BEAD: make the complete perimeter an integrated continuation of the same Pixel material, with stronger transparent-to-milky depth, visibly varying pooled thickness, soft localized folds, refraction and long glossy liquid streaks. It must not become a constant-width rounded rectangle, two smooth parallel perimeter lines, a hard moulded ridge, a thin outline or a separate clear plastic gasket. Its inner side must flow naturally into the textured broad body.

ABSOLUTE PRODUCT LOCK: preserve IMAGE 1's complete ${target.modelName}, ${target.hardware}. Preserve the original shell colour and texture, camera-island size and position, buttons, silhouette, width/height ratio, phone scale, all four corners, complete bottom edge, shadows and straight-on framing. Keep the whole phone fully visible and uncropped. Never zoom, crop, reframe, rotate, resize, widen, shorten, redraw, smooth over, substitute hardware or copy any Pixel hardware.

BLANK PRODUCT CENTRE DOES NOT MEAN TEXTURELESS. Leave the Gel free of every Apple logo, emblem, icon, text, watermark, embossing, debossing, tonal silhouette or ghosted symbol, but retain the required Pixel-derived internal white flow texture, refraction, folds and wet highlights across the centre. Do not add red residue or a transparent exterior background.

Priority rule: preserve IMAGE 1's exact ${target.modelName} product and hardware, IMAGE ${guideImage}'s exact closed footprint, IMAGE ${pixelImage}'s complete physical Gel material across centre and edge, and IMAGE ${whiteImage}'s neutral White non-metallic colour in that order.

Output exactly ONE new photorealistic full back-view image only.`
}

function referencesFor(target) {
  const { modelId } = target
  if (target.combinedGuide) {
    return [
      `${referencesDir}/trial-${modelId}-white-glitter-shape-guide-white-bg.png`,
      `${referencesDir}/trial-${modelId}-accepted-glitter-geometry.png`,
      `${referencesDir}/trial-${modelId}-white-camera-lock.png`,
      `${referencesDir}/trial-${modelId}-white-current-style.png`,
      pixelMaterial,
    ]
  }
  return [
    `${referencesDir}/trial-${modelId}-white-source.png`,
    `${referencesDir}/trial-${modelId}-accepted-glitter-geometry.png`,
    `${referencesDir}/trial-${modelId}-white-glitter-shape-guide-white-bg.png`,
    `${referencesDir}/trial-${modelId}-white-camera-lock.png`,
    `${referencesDir}/trial-${modelId}-white-current-style.png`,
    pixelMaterial,
  ]
}

const prompts = []
for (const target of targets) {
  const referenceImages = referencesFor(target)
  await Promise.all(referenceImages.map((filePath) => access(filePath)))
  const promptText = promptFor(target)
  const filename = `${target.modelId}-white-${target.candidateVersion}.png`
  await access(path.join(candidatesDir, filename)).then(
    () => { throw new Error(`${filename} already exists; increment candidateVersion`) },
    (error) => { if (error.code !== 'ENOENT') throw error },
  )
  prompts.push({
    modelId: target.modelId,
    modelName: target.modelName,
    finish: 'white',
    candidateVersion: target.candidateVersion,
    expectedImageVersion: target.expectedImageVersion,
    publish: false,
    generator: 'ChatGPT image generation',
    promptText,
    promptSha256: sha256(promptText),
    referenceImages,
    candidatePath: `${candidatesDir}/${filename}`,
    localImagePath: `${publicDir}/${filename}`,
    imagePath: `/assets/cases/case-history/gpt-conversation-attempts/${filename}`,
  })
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-white-pixel-material-regeneration',
  generatedBy: 'scripts/build-iphone-white-pixel-material-regeneration.mjs',
  publish: false,
  generationPolicy: 'Regenerate only the five user-rejected White finishes. Pixel 10 Pro controls the complete physical Gel material across centre and edge; same-model White controls only neutral White non-metallic colour; same-model source, guide and camera references control product geometry.',
  prompts,
}

if (process.argv.includes('--write')) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(JSON.stringify({
  records: prompts.length,
  uniqueModels: new Set(prompts.map((prompt) => prompt.modelId)).size,
  uniquePrompts: new Set(prompts.map((prompt) => prompt.promptSha256)).size,
  referencesVerified: prompts.reduce((total, prompt) => total + prompt.referenceImages.length, 0),
  wrote: process.argv.includes('--write'),
  outputPath,
}, null, 2))