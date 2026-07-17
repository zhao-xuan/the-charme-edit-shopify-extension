import { mkdir, writeFile } from 'node:fs/promises'

const MODELS = [
  { id: 'iphone-16', name: 'Apple iPhone 16' },
  { id: 'iphone-17', name: 'Apple iPhone 17' },
]

const FINISHES = [
  {
    id: 'black',
    label: 'Black',
    shell: 'BLACK',
    shellFile: 'black',
    materialReference: 'gpt-black-material(1).png',
    material: `BLACK MATERIAL LOCK: reproduce IMAGE 3 exactly. Use deep neutral jet-black gel, a broad calm matte-black centre with no large centre reflection, and bright white wet specular highlights mainly on the thick raised glossy rim. Do not borrow White or Glitter texture.`,
  },
  {
    id: 'white',
    label: 'White',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    materialReference: 'gpt-white-material(1).png',
    material: `WHITE MATERIAL LOCK: reproduce IMAGE 3 exactly. Preserve IMAGE 1's original off-white silicone shell unchanged, while the gel itself is a visibly distinct neutral clean white, never cream, beige, ivory or yellow. Keep a continuous fine light-grey contact shadow between gel and shell so the white gel never disappears into or fuses with the case. The centre is calm and smooth with a restrained soft sheen; the thick raised rim carries the stronger wet gloss.`,
  },
  {
    id: 'glitter',
    label: 'Glitter',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    materialReference: 'gpt-glitter-pixel-10-pro(1).png',
    material: `GLITTER MATERIAL LOCK: reproduce IMAGE 3 exactly. Keep its calm translucent-milky low-contrast pearl-white centre and exact subtle embedded micro-shimmer. Do not invent sequins, crystals, sand, silver flakes, rainbow glitter, large sparkle dots, marble streaks or glossy centre bands. The thick raised rim carries the visible wet gloss and soft liquid folds.`,
  },
]

const GUIDE = 'gpt-iphone-16-17-standard-gel-path.png'

function promptFor(model, finish) {
  const sourceFile = `${model.id}-${finish.shellFile}.png`
  return `Generate exactly ONE image now.

IMAGE 1 = the exact bare ${finish.shell} ${model.name} in its silicone case attached to THIS message (${sourceFile}). IMAGE 2 = the user-approved red-line gel-footprint guide attached to THIS message (${GUIDE}). IMAGE 3 = the fixed ${finish.materialReference}. Add ${finish.label} gel to IMAGE 1.

SOURCE AUTHORITY - NON-NEGOTIABLE: IMAGE 1 alone is authoritative for the phone, camera hardware and silicone shell. Preserve pixel-for-pixel its exact ${model.name} identity, two vertically stacked rear lenses inside the original narrow vertical camera housing, the separate circular flash to the right, every sensor, button, silhouette, body and shell proportion, width/height ratio, colour, texture, shadow, scale, position, framing, complete bottom edge and all four corners. Keep the whole phone fully visible and uncropped. Do not zoom, crop, reframe, rotate, shorten, widen, rescale, redraw, redesign, smooth over, fuse or substitute any product part. Never convert it into a Pro model, square camera island, diagonal-lens layout or three-lens layout. IMAGE 2 supplies gel geometry only and must never replace IMAGE 1's phone or hardware. IMAGE 3 supplies gel material only.

RED-LINE FOOTPRINT LOCK - COPY IMAGE 2: the red line marks the required gel perimeter and camera-side boundary. Reproduce that path as closely as physically possible, but NEVER render the red line, guide marks or any coloured outline in the final image. Make one continuous poured-gel slab covering the large lower and right-hand usable back inside that path.

STANDARD iPHONE 16/17 CAMERA-SIDE PATH: at the upper-left, the gel boundary must enter from the left side BELOW the complete vertical two-lens camera housing, sweep rightward as one broad, nearly horizontal, softly rounded shoulder beneath the entire camera housing, continue beneath the separate flash, then make one large smooth upward turn to the RIGHT of the flash and rise toward the top edge in the upper-right region. This creates the same single broad stepped L-shaped exclusion zone shown by IMAGE 2. Treat the full vertical camera housing and separate flash as one grouped keep-out.

FORBIDDEN CAMERA GEOMETRY: do not wrap gel tightly around either lens; do not put gel between the two lenses; do not create a U-shaped or keyhole notch around the flash; do not make individual lens or flash cut-outs; do not trace the circular hardware; do not bridge a narrow strip of gel between the camera housing and flash; do not use an iPhone Pro rounded-square camera island. The camera-side boundary must remain one simple continuous broad curve with generous radii and clear bare shell around every hardware edge.

VERY-CLOSE OUTER FIT: along the left side below the camera shoulder, the complete right side, bottom, and the top-right segment reached by the red-line path, leave one continuous one-pixel-like hairline of silicone shell between gel and the raised shell wall, approximately 0.3%-0.5% of case width and never wider than 0.7%. Keep the reveal optically equal, parallel to the shell wall and continuous around corners. Do not shrink or centre the gel, leave a normal-width border, touch the shell wall or climb onto it.

SHELL AND CAMERA PROPORTION LOCK: compare against IMAGE 1 before output. The phone's outer width-to-height ratio and camera hardware's relative size and placement must remain unchanged. Preserve the exact narrow vertical camera housing and separate flash spacing. No shell distortion, narrower body, enlarged camera, softened hardware, altered corner radius or missing edge.

GEL/SHELL SEPARATION: gel and silicone remain visibly separate materials. Preserve the shell-colour hairline and tiny natural contact shadow around the complete gel perimeter. Keep the glossy raised gel bead fully inside the flat back panel. Never blend the gel into the silicone rim, recolour the shell as gel, erase the shell reveal, create a double rim or make the gel look moulded into the case.

RAISED GEL RIM: follow IMAGE 2's thick, puffy, raised wet perimeter bead with restrained organic waves. Keep bead thickness and height visually consistent along the outer perimeter and the broad camera-side shoulder. The centre stays calmer and flatter. No thin hard cut edge, inflated corner blob or style change near the camera.

${finish.material}

FINAL QA BEFORE OUTPUT: exact ${model.name} source shell; vertical two-lens standard-model camera identity; one continuous slab; camera boundary follows IMAGE 2's broad under-camera shoulder and right-of-flash upward turn; no individual hardware notches; no red guide line; very-close equal outer hairline; shell and gel never fused; exact ${finish.label} material; no added logo, text, icon or symbol. Output one photorealistic ultra-high-resolution straight-on full back-view product image only.`
}

const conversationIndex = process.argv.indexOf('--conversation-url')
const conversationUrl = conversationIndex >= 0 ? process.argv[conversationIndex + 1] : ''
const prompts = MODELS.flatMap((model) => FINISHES.map((finish) => ({
  modelId: model.id,
  finish: finish.id,
  promptText: promptFor(model, finish),
  referenceImages: [
    `${model.id}-${finish.shellFile}.png`,
    GUIDE,
    finish.materialReference,
  ],
  generator: 'ChatGPT',
})))

const outputPath = 'reference/case-history/iphone-16-17-standard-prompts.json'
await mkdir('reference/case-history', { recursive: true })
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, conversationUrl, prompts }, null, 2)}\n`)
console.log(`Wrote ${prompts.length} prompts to ${outputPath}`)