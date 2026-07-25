import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputPath = 'reference/case-history/iphone-white-pixel-edge-regeneration.json'
const referencesDir = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const candidatesDir = 'reference/case-history/generated/black-white-glitter-shape-trials/candidates'
const publicDir = 'public/assets/cases/case-history/gpt-conversation-attempts'
const pixelMaterial = 'public/assets/cases/gpt-references/gpt-glitter-pixel-10-pro.png'
const acceptedWhiteEdgeCalibration = `${candidatesDir}/iphone-11-pro-max-white-v6-gpt.png`

const targets = [
  {
    modelId: 'iphone-11-pro-max',
    modelName: 'iPhone 11 Pro Max',
    candidateVersion: 'v6-gpt',
    expectedImageVersion: 'v3',
    correctionSource: `${candidatesDir}/iphone-11-pro-max-white-v4-gpt.png`,
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash and microphone and no LiDAR sensor',
  },
  {
    modelId: 'iphone-12-pro',
    modelName: 'iPhone 12 Pro',
    candidateVersion: 'v4-gpt',
    expectedImageVersion: 'v4',
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash, microphone and LiDAR sensor',
  },
  {
    modelId: 'iphone-12-pro-max',
    modelName: 'iPhone 12 Pro Max',
    candidateVersion: 'v2-gpt',
    expectedImageVersion: 'v3',
    useAcceptedWhiteEdgeCalibration: true,
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash, microphone and LiDAR sensor',
  },
  {
    modelId: 'iphone-13',
    modelName: 'iPhone 13',
    candidateVersion: 'v2-gpt',
    expectedImageVersion: 'v5',
    useAcceptedWhiteEdgeCalibration: true,
    hardware: 'exactly TWO large lenses in the original DIAGONAL arrangement, with the original flash and microphone and no Pro sensor',
  },
  {
    modelId: 'iphone-13-mini',
    modelName: 'iPhone 13 mini',
    candidateVersion: 'v2-gpt',
    expectedImageVersion: 'v3',
    useAcceptedWhiteEdgeCalibration: true,
    hardware: 'exactly TWO large lenses in the original DIAGONAL arrangement, with the original flash and microphone and no Pro sensor',
  },
  {
    modelId: 'iphone-14',
    modelName: 'iPhone 14',
    candidateVersion: 'v12-gpt',
    expectedImageVersion: 'v2',
    combinedGuide: true,
    useAcceptedWhiteEdgeCalibration: true,
    hardware: 'exactly TWO large lenses in the original DIAGONAL arrangement, with the original flash and microphone and no Pro sensor',
  },
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function promptFor(target) {
  if (target.correctionSource) {
    return `REJECTED. Generate exactly ONE NEW corrected full-canvas ${target.modelName} White Gel product image from the previous generated image and the same SIX original attachments.

The previous image passed the required plain White finish and Pixel 10 Pro outer-edge treatment, but it failed because GPT added a large low-contrast Apple logo in the broad Gel centre. Correct ONLY that defect: remove the Apple logo completely and replace the entire logo area with the same uninterrupted plain neutral-white Gel as its immediate surroundings. Leave no ghost, tonal silhouette, embossing, debossing, edge, icon or other trace of the logo.

Preserve every successful part of the previous image exactly: the particle-free plain White Gel body with zero Glitter, shimmer, fibres, flecks, sparkles or decorative dots; the thick transparent-to-milky outer wet bead with its existing irregular pooling, localized folds, varying thickness and elongated glossy liquid highlights; the complete accepted red-guide footprint; the short under-camera shoulder, early broad rise, high soft crown and close left/bottom/right fit; the exact three-lens ${target.modelName} camera hardware, flash and microphone; the complete shell, buttons, framing, scale, shadows and pure-white exterior background.

Do not smooth, regularize, thin, inset, resize, translate, redraw or restyle the successful wet edge. Do not change the phone, camera, shell colour, Gel colour, material, footprint, framing or canvas. Do not add any logo, text, symbol, watermark, red residue or transparent exterior background.

Priority rule: remove only the logo while preserving the previous image's successful plain White finish, Pixel-style wet edge, exact product hardware and accepted geometry.

Output exactly ONE new photorealistic full back-view image only.`
  }

  const attachmentCount = target.combinedGuide
    ? (target.useAcceptedWhiteEdgeCalibration ? 'SIX' : 'FIVE')
    : (target.useAcceptedWhiteEdgeCalibration ? 'SEVEN' : 'SIX')
  const whiteMaterialImage = target.combinedGuide ? 4 : 5
  const edgeImage = target.combinedGuide ? 5 : 6
  const calibrationImage = target.combinedGuide ? 6 : 7
  const guideImage = target.combinedGuide ? 1 : 3
  const baseAttachmentAuthority = target.combinedGuide
    ? `IMAGE 1 = the same-pixel-grid OFF-WHITE ${target.modelName} source with the accepted footprint mapped as a closed red guide. It is the sole authority for the complete phone, silicone shell, hardware, scale, proportions, framing, buttons, shadows, pure-white exterior background and final Gel boundary. The red line is the required CENTRELINE of the OUTERMOST raised Gel bead around the complete route.
IMAGE 2 = the latest accepted same-model Glitter result. It confirms ONLY the normalized Gel footprint. Never copy its Glitter particles, shell colour, camera rendering or material.
IMAGE 3 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash and microphone.
IMAGE 4 = the current same-model White Gel style and the SOLE authority for the broad plain White Gel body, its clean neutral colour and its completely particle-free finish. Its edge treatment and footprint are rejected; never copy them.
IMAGE 5 = the Pixel 10 Pro benchmark for the OUTERMOST WET EDGE TREATMENT ONLY. Copy only its transparent-to-milky pooled outer lip, optical depth, soft irregular thickness, restrained folds and glossy streak highlights. Never copy any Glitter, shimmer, fibres, specks, particles or the Pixel phone, horizontal camera bar, crop, proportions or footprint.`
    : `IMAGE 1 = the exact bare OFF-WHITE ${target.modelName} source and the sole authority for the complete phone, silicone shell, hardware, scale, proportions, framing, buttons, shadows and pure-white exterior background.
IMAGE 2 = the latest accepted same-model Glitter result. It controls ONLY the normalized Gel footprint. Never copy its Glitter particles, shell colour, camera rendering or material.
IMAGE 3 = IMAGE 1 with that accepted footprint mapped as a closed red guide. The red line is the required CENTRELINE of the OUTERMOST raised Gel bead around the complete route.
IMAGE 4 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash, microphone and sensors.
IMAGE 5 = the current same-model White Gel style and the SOLE authority for the broad plain White Gel body, its clean neutral colour and its completely particle-free finish. Its edge treatment and footprint are rejected; never copy them.
IMAGE 6 = the Pixel 10 Pro benchmark for the OUTERMOST WET EDGE TREATMENT ONLY. Copy only its transparent-to-milky pooled outer lip, optical depth, soft irregular thickness, restrained folds and glossy streak highlights. Never copy any Glitter, shimmer, fibres, specks, particles or the Pixel phone, horizontal camera bar, crop, proportions or footprint.`
  const attachmentAuthority = target.useAcceptedWhiteEdgeCalibration
    ? `${baseAttachmentAuthority}
IMAGE ${calibrationImage} = an accepted cross-model White Gel calibration proving the intended combined result: a completely particle-free blank plain-White body plus the irregular transparent-to-milky wet outer lip. It controls ONLY that body/edge material relationship. Never copy its iPhone 11 Pro Max hardware, camera, shell, framing, proportions, footprint or route; all target-model geometry still comes exclusively from IMAGES 1-4 and the red guide.`
    : baseAttachmentAuthority
  const acceptedCalibrationCheck = target.useAcceptedWhiteEdgeCalibration
    ? ` IMAGE ${calibrationImage} is the positive result-level check for translating that wet edge into White without importing any Glitter: match its blank particle-free broad body and visibly pooled edge relationship, while retaining only this target model's own geometry and hardware.`
    : ''

  return `Generate exactly ONE NEW full-canvas ${target.modelName} White Gel product image from the ${attachmentCount} attached images.

ATTACHMENT AUTHORITY:
${attachmentAuthority}

The previous ${target.modelName} White result is rejected because its Gel edge treatment does not look like IMAGE ${edgeImage}. Correct ONLY the OUTERMOST EDGE using IMAGE ${edgeImage}: make one thick transparent-to-milky wet outer lip with real optical depth, softly irregular fluid thickness, restrained organic folds, elongated glossy streak highlights and a tiny natural contact shadow. Preserve IMAGE ${whiteMaterialImage}'s plain White Gel finish across the broad interior: a calm continuous neutral-white body with smooth milky translucency and absolutely no visible particles.${acceptedCalibrationCheck}

EDGE MATERIAL IS THE MAIN CORRECTION. The complete outer bead must look soft, viscous, transparent and naturally pooled like IMAGE ${edgeImage}, not like a smooth uniform plastic gasket, embossed phone-case border, thin white outline, hard moulded ridge, double ring or flat opaque frame. Keep one continuous integrated wet bead. Preserve visible refraction and subtle unevenness around the left, bottom, right, under-camera shoulder and high crown. Do not simplify the Pixel 10 Pro edge language into a clean rounded rectangle.

VISIBLE EDGE PASS/FAIL TEST: a constant-width rounded rectangle, two smooth parallel perimeter lines, or a uniformly extruded clear border is a failure even if the centre is White. The OUTERMOST bead must visibly vary in thickness and pooling, with localized soft bulges, shallow organic folds and a few broad elongated liquid highlights like IMAGE ${edgeImage}. Its inner side must dissolve softly into the plain White body rather than forming a second continuous ring. These variations change only the bead's wet surface treatment; its centreline must still remain exactly on IMAGE ${guideImage}'s red route.

GEOMETRY IS INDEPENDENT FROM MATERIAL: put the centreline of that OUTERMOST wet bead directly over the entire closed red route in IMAGE ${guideImage}, then remove every red pixel. Do not inset, shrink, centre, lower, straighten or approximate the route. Preserve the short under-camera shoulder, the early broad up-and-right rise beside the camera island, one wide high soft crown, and the ultra-close continuous left/bottom/right fit inherited from IMAGE 2 and IMAGE ${guideImage}. The Gel must remain outside the complete camera island and must never wrap individual lenses or sensors.

ABSOLUTE PRODUCT LOCK: preserve IMAGE 1's complete ${target.modelName}, ${target.hardware}. Preserve the original shell colour and texture, camera-island size and position, buttons, silhouette, width/height ratio, phone scale, all four corners, complete bottom edge, shadows and straight-on framing. Keep the whole phone fully visible and uncropped. Never zoom, crop, reframe, rotate, resize, widen, shorten, redraw, smooth over, substitute hardware or copy any Pixel hardware.

WHITE VERSUS GLITTER IS AN ABSOLUTE FINISH LOCK. Match IMAGE ${whiteMaterialImage}, not IMAGE ${edgeImage}, for the broad Gel body's substance. The Gel must be clean neutral white, with no cream, beige, ivory, yellow or warm-grey cast. The broad centre must be visually quiet and uninterrupted: zero glitter, zero shimmer, zero fibres, zero micro-glints, zero metallic flecks, zero pearlescent particles, zero sparkles and zero decorative dots at any size or density. Keep it visibly distinct from the off-white silicone shell only through the outer lip's transparency, wet highlights, optical depth and subtle neutral contact shadow. Do not add an Apple logo, text, symbol, watermark, red residue or transparent exterior background.

BLANK CENTRE IS AN ABSOLUTE PRODUCT LOCK. Leave the entire broad White Gel centre completely blank. Do not add an Apple logo or any other logo, emblem, icon, symbol, text, watermark, embossing, debossing, tonal silhouette or ghosted shape. A faint, translucent, low-contrast or partially hidden logo is still a failure.

Priority rule: if anything conflicts, preserve IMAGE 1's exact ${target.modelName} product and hardware, IMAGE ${guideImage}'s exact closed footprint, IMAGE ${whiteMaterialImage}'s plain particle-free White finish, and only IMAGE ${edgeImage}'s outer wet-edge treatment in that order.

Output exactly ONE new photorealistic full back-view image only.`
}

function referencesFor(target) {
  const { modelId } = target
  if (modelId === 'iphone-14') {
    const references = [
      `${referencesDir}/trial-${modelId}-white-glitter-shape-guide-white-bg.png`,
      `${referencesDir}/trial-${modelId}-accepted-glitter-geometry.png`,
      `${referencesDir}/trial-${modelId}-white-camera-lock.png`,
      `${referencesDir}/trial-${modelId}-white-current-style.png`,
      pixelMaterial,
    ]
    if (target.useAcceptedWhiteEdgeCalibration) references.push(acceptedWhiteEdgeCalibration)
    return target.correctionSource ? [...references, target.correctionSource] : references
  }
  const references = [
    `${referencesDir}/trial-${modelId}-white-source.png`,
    `${referencesDir}/trial-${modelId}-accepted-glitter-geometry.png`,
    `${referencesDir}/trial-${modelId}-white-glitter-shape-guide-white-bg.png`,
    `${referencesDir}/trial-${modelId}-white-camera-lock.png`,
    `${referencesDir}/trial-${modelId}-white-current-style.png`,
    pixelMaterial,
  ]
  if (target.useAcceptedWhiteEdgeCalibration) references.push(acceptedWhiteEdgeCalibration)
  return target.correctionSource ? [...references, target.correctionSource] : references
}

const prompts = []
for (const target of targets) {
  const referenceImages = referencesFor(target)
  await Promise.all(referenceImages.map((filePath) => access(filePath)))
  const promptText = promptFor(target)
  const filename = `${target.modelId}-white-${target.candidateVersion}.png`
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
  campaign: 'iphone-white-pixel-edge-regeneration',
  generatedBy: 'scripts/build-iphone-white-pixel-edge-regeneration.mjs',
  publish: false,
  generationPolicy: 'Regenerate only the six requested White finishes. Each same-model White reference controls the plain particle-free White body. Pixel 10 Pro controls only the outer wet-edge treatment and never the interior substance. Same-model source, guide and camera references control product geometry.',
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