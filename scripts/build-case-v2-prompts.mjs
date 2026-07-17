import { mkdir, writeFile } from 'node:fs/promises'

const MODELS = [
  {
    id: 'iphone-13',
    name: 'Apple iPhone 13',
    hardware: 'the complete original square camera island, both diagonal camera lenses, flash and sensors',
    keepout: 'one compact rounded-square keep-out around the complete camera island',
  },
  {
    id: 'iphone-14-pro',
    name: 'Apple iPhone 14 Pro',
    hardware: 'the complete original camera island, all three lenses, flash, LiDAR and sensors',
    keepout: 'one compact rounded-square keep-out around the complete camera island',
  },
  {
    id: 'iphone-16-pro-max',
    name: 'Apple iPhone 16 Pro Max',
    hardware: 'the complete original camera island, all three lenses, flash, LiDAR and sensors',
    keepout: 'one compact rounded-square keep-out around the complete camera island',
  },
  {
    id: 'galaxy-s24-ultra',
    name: 'Samsung Galaxy S24 Ultra',
    hardware: 'every original separate camera ring, lens, flash and sensor, preserving their exact count, size, spacing and alignment',
    keepout: 'one compact vertical rounded-capsule keep-out around the ENTIRE camera hardware group as a single unit',
  },
]

const FINISHES = [
  {
    id: 'black',
    shell: 'BLACK',
    shellFile: 'black',
    reference: 'gpt-black-material(1).png',
    label: 'Black',
    material: `BLACK MATERIAL LOCK: reproduce fixed gpt-black-material(1).png exactly. Use deep neutral jet-black gel, a broad calm matte-black centre with no large centre reflection, and bright white wet specular highlights mainly on the thick raised glossy rim. Do not borrow white or Glitter texture.`,
  },
  {
    id: 'white',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    reference: 'gpt-white-material(1).png',
    label: 'White',
    material: `WHITE MATERIAL LOCK: reproduce fixed gpt-white-material(1).png exactly. Preserve IMAGE 1's original off-white silicone shell unchanged, while the gel itself is a visibly distinct neutral clean white, never cream, beige, ivory or yellow. Keep a continuous fine light-grey contact shadow between gel and shell so the white gel never disappears into or fuses with the off-white case. The centre is calm and smooth with a restrained soft sheen; the thick raised rim carries the stronger wet gloss. Do not blow out the highlights or borrow Black or Glitter texture.`,
  },
  {
    id: 'glitter',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    reference: 'gpt-glitter-pixel-10-pro(1).png',
    label: 'Glitter',
    material: `GLITTER MATERIAL LOCK: reproduce fixed gpt-glitter-pixel-10-pro(1).png exactly. Keep its calm translucent-milky low-contrast pearl-white centre and its exact subtle embedded micro-shimmer. Do not invent sequins, crystals, sand, silver flakes, rainbow glitter, large sparkle dots, marble streaks or glossy centre bands. The thick raised rim carries the visible wet gloss and soft liquid folds.`,
  },
]

function promptFor(model, finish) {
  const sourceRevision = finish.id === 'white' ? 'final2' : 'final'
  const sourceFile = `v2-${sourceRevision}-${model.id}-${finish.id}-source.png`
  const geometryFile = finish.id === 'black' ? '' : `v2-final-${model.id}-${finish.id}-black-geometry.png`
  const geometryReference = geometryFile
    ? ` IMAGE 4 = the accepted same-model Black render attached to THIS message (${geometryFile}); it supplies geometry only, never colour or material.`
    : ''
  const geometryLock = geometryFile
    ? `

SAME-MODEL GEOMETRY LOCK: copy IMAGE 4's exact outer phone silhouette, width/height ratio, phone scale, framing, gel footprint, outer hairline, camera moat and raised-rim path. Preserve IMAGE 1's original hardware and shell colour. Forbid any narrower, wider, shorter, taller or newly rounded outer case. Change only the gel material from Black to ${finish.label}; do not copy any black pixels, black tint or black texture.`
    : ''
  const galaxyRule = model.id === 'galaxy-s24-ultra'
    ? `GALAXY INTERFERENCE LOCK: the gel must stay completely outside the outermost edge of every lens ring, flash and sensor. It must never enter the spaces between separate rings, touch a ring, cover a ring, create individual lens notches or invent an iPhone-style camera island. The single vertical capsule boundary must remain smooth from top to bottom.`
    : `CAMERA INTERFERENCE LOCK: the gel must stay completely outside the original camera island and all hardware. It must never touch, cover, trace or create individual notches around a lens, flash, LiDAR or sensor.`

  return `Generate exactly ONE image now.

IMAGE 1 = the exact bare ${finish.shell} ${model.name} in its silicone case attached to THIS message (${sourceFile}). IMAGE 2 = the fixed gpt-approved-layout(1).png. IMAGE 3 = the fixed ${finish.reference}.${geometryReference} Add ${finish.label} gel to IMAGE 1.

ABSOLUTE PRODUCT LOCK: IMAGE 1 alone is authoritative for the phone and shell. Preserve pixel-for-pixel its exact model, ${model.hardware}, buttons, silhouette, body and shell proportions, width/height ratio, colour, texture, shadows, phone scale, position, framing, complete bottom edge, all four corners and pure-white background. After excluding transparent/background pixels, the phone's outer width-to-height ratio must match IMAGE 1 within 1%, and the camera hardware must keep the same relative size and position inside that silhouette. Keep the whole phone fully visible and uncropped. Do not zoom, crop, reframe, rotate, shorten, widen, rescale, redraw, redesign, smooth over, fuse or substitute any product part. IMAGE 2 supplies gel footprint and raised-rim language only; it must never replace IMAGE 1's phone or shell. IMAGE 3 supplies gel material only.${geometryLock}

ONE FIXED GEOMETRY FOR EVERY FINISH: make one continuous large L-shaped poured-gel slab that covers every usable part of the flat back. Keep ${model.hardware} together inside ${model.keepout}. The gel fills the complete top-right area, runs beside and below that single keep-out, then covers the full lower back. There must be no accidental bare-shell island, missing patch, detached gel piece or uncoated band anywhere outside the intentional camera keep-out and the fixed outer hairline.

FIXED VERY-CLOSE OUTER CLEARANCE - NON-NEGOTIABLE: on the LEFT, RIGHT, BOTTOM and TOP-RIGHT outer sides, leave exactly one continuous, clearly visible ONE-PIXEL-LIKE hairline of silicone shell between gel and shell wall, approximately 0.3%-0.5% of the case width and never wider than 0.7%. This reveal must have the SAME optical width on every side, at every corner, for every model and every colour. The gel outline stays parallel to the shell wall and follows the shell corner radius. The previous result left roughly twice too much shell visible; reduce that gap by at least half. Do not shrink or centre the gel. Do not leave a normal border. Do not let the gel touch, overlap or climb onto the shell wall.

NO GEL/SHELL FUSION: gel and silicone are two visibly separate materials. Preserve that unbroken shell-colour hairline and a tiny natural contact shadow all around the gel perimeter. The glossy gel rim must remain fully inside the flat back panel. Never blend the gel rim into the silicone rim, recolour the shell as gel, erase the shell line, create a double rim or make the gel look moulded as part of the case.

FIXED SMALL CAMERA CLEARANCE: around the complete hardware group, leave one clean, compact and UNIFORM bare-shell moat approximately 1% of case width and never wider than 1.25%. The clearance must be visibly open at every point, including the closest lens or sensor, but must not be oversized. Use one smooth continuous boundary with a generous soft border radius; no sharp steps, pinches or hardware-shaped tracing. This same small optical clearance is required for all three finishes.

${galaxyRule}

RAISED RIM LOCK: copy fixed gpt-approved-layout(1).png's thick, puffy, raised, glossy wet perimeter bead with restrained organic waves. Keep the bead thickness and height visually constant around the outer perimeter and camera-side boundary. The broad centre is calmer and flatter. No thin hard cut edge, no inflated corner blob and no style change near the camera.

${finish.material}

FINAL QA BEFORE OUTPUT: exact source phone and camera scale; full uncropped shell; one continuous L slab; outer shell hairline close, visible and equal on all sides; gel and shell never fused; one small uniform rounded camera moat; zero hardware interference; no material drift; no logo, brand mark, text, icon or symbol. Output one photorealistic ultra-high-resolution straight-on full back-view product image only.`
}

const conversationIndex = process.argv.indexOf('--conversation-url')
const conversationUrl = conversationIndex >= 0 ? process.argv[conversationIndex + 1] : ''
const prompts = MODELS.flatMap((model) => FINISHES.map((finish) => ({
  modelId: model.id,
  finish: finish.id,
  promptText: promptFor(model, finish),
  referenceImages: [
    `v2-${finish.id === 'white' ? 'final2' : 'final'}-${model.id}-${finish.id}-source.png`,
    'gpt-approved-layout(1).png',
    finish.reference,
    ...(finish.id === 'black' ? [] : [`v2-final-${model.id}-${finish.id}-black-geometry.png`]),
  ],
  generator: 'ChatGPT',
})))

await mkdir('reference/case-history', { recursive: true })
await writeFile('reference/case-history/v2-prompts.json', `${JSON.stringify({
  schemaVersion: 1,
  conversationUrl,
  prompts,
}, null, 2)}\n`)
console.log(`Wrote ${prompts.length} prompts to reference/case-history/v2-prompts.json`)