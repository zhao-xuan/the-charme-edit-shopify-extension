import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const CAMPAIGN = 'standard-13-15'
const RUN = 'run6'
const REFERENCE_DIR = path.join('reference', 'case-history', 'generated', CAMPAIGN, 'references')
const OUTPUT_PATH = path.join('reference', 'case-history', `${CAMPAIGN}-prompts.json`)

const MODELS = [
  {
    id: 'iphone-13',
    name: 'Apple iPhone 13',
    imageVersion: 'v3',
    guide: { black: { shoulderX: 379, shoulderY: 501 }, white: { shoulderX: 364, shoulderY: 485 } },
  },
  {
    id: 'iphone-14',
    name: 'Apple iPhone 14',
    imageVersion: 'v1',
    guide: { black: { shoulderX: 382, shoulderY: 502 }, white: { shoulderX: 390, shoulderY: 464 } },
  },
  {
    id: 'iphone-15',
    name: 'Apple iPhone 15',
    imageVersion: 'v1',
    guide: { black: { shoulderX: 390, shoulderY: 509 }, white: { shoulderX: 377, shoulderY: 494 } },
  },
]

const STYLE_REFERENCE = {
  source: 'public/assets/cases/gpt-references/gpt-approved-layout.png',
  file: `${RUN}-raised-rim-detail.png`,
  extract: { left: 95, top: 1170, width: 620, height: 330 },
}

const FINISHES = [
  {
    id: 'black',
    label: 'Black',
    shell: 'BLACK',
    shellFile: 'black',
    materialFile: `${RUN}-black-material-detail.png`,
    materialSource: 'public/assets/cases/gpt-references/gpt-black-material.png',
    materialExtract: { left: 340, top: 520, width: 360, height: 360 },
    material: `BLACK MATERIAL LOCK: reproduce IMAGE 4's material only. Use deep neutral jet-black gel, a broad calm matte-black centre with no large centre reflection, and bright white wet specular highlights mainly on the thick raised glossy rim. Never borrow White or Glitter texture.`,
  },
  {
    id: 'white',
    label: 'White',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    materialFile: `${RUN}-white-material-detail.png`,
    materialSource: 'public/assets/cases/gpt-references/gpt-white-material.png',
    materialExtract: { left: 340, top: 520, width: 360, height: 360 },
    material: `WHITE MATERIAL LOCK: reproduce IMAGE 4's material only. Preserve IMAGE 1's off-white silicone shell unchanged while the gel is a visibly distinct neutral clean white, never cream, beige, ivory or yellow. Keep a continuous fine light-grey contact shadow between gel and shell so the white gel never disappears into the case. The centre is calm with restrained soft sheen; the raised rim carries stronger wet gloss.`,
  },
  {
    id: 'glitter',
    label: 'Glitter',
    shell: 'OFF-WHITE',
    shellFile: 'white',
    materialFile: `${RUN}-glitter-material-detail.png`,
    materialSource: 'public/assets/cases/gpt-references/gpt-glitter-pixel-10-pro.png',
    materialExtract: { left: 170, top: 620, width: 330, height: 330 },
    material: `GLITTER MATERIAL LOCK: reproduce IMAGE 4's material only. Keep its calm translucent-milky low-contrast pearl-white centre and exact subtle embedded micro-shimmer. Never invent sequins, crystals, sand, silver flakes, rainbow glitter, large sparkle dots, marble streaks or glossy centre bands. The raised rim carries the visible wet gloss and soft liquid folds.`,
  },
]

function promptFor(model, finish) {
  const sourceFile = `${RUN}-${model.id}-${finish.shellFile}-source.png`
  const guideFile = `${RUN}-${model.id}-${finish.shellFile}-exact-gel-path.png`
  const geometryFile = `${RUN}-${model.id}-black-geometry.png`
  const guide = model.guide[finish.shellFile]
  const geometryMap = finish.id === 'black'
    ? ''
    : `\nIMAGE 5 = the accepted same-model Black result from this corrected run (${geometryFile}); use it for geometry only, never colour or material.`
  const geometryLock = finish.id === 'black'
    ? ''
    : `\n\nSAME-MODEL CROSS-FINISH LOCK: copy IMAGE 5's exact normalized gel footprint, camera-side boundary, outer fit and raised bead path onto IMAGE 1. IMAGE 1 remains authoritative for hardware, shell colour, exact silhouette, scale and framing. Change only the gel material from Black to ${finish.label}; never copy black pixels, black tint or black texture.`

  return `Generate exactly ONE image now.

ATTACHMENT MAP:
IMAGE 1 = exact bare ${finish.shell} ${model.name} source (${sourceFile}).
IMAGE 2 = IMAGE 1 with the exact closed red gel-placement mask (${guideFile}).
IMAGE 3 = camera-free raised-rim detail crop (${STYLE_REFERENCE.file}); style only, never geometry.
IMAGE 4 = camera-free ${finish.label} material detail crop (${finish.materialFile}); material only, never geometry.${geometryMap}

Add ${finish.label} gel to IMAGE 1.

ABSOLUTE PRODUCT LOCK: IMAGE 1 alone is authoritative for the phone and silicone shell. Preserve pixel-for-pixel the exact ${model.name} identity, complete original rounded-square camera island, both original diagonal camera lenses, flash, microphone and sensors, buttons, silhouette, body and shell proportions, width/height ratio, colour, texture, shadows, phone scale, position, framing, complete bottom edge and all four corners. Keep the whole phone fully visible, straight-on and uncropped. Never zoom, crop, reframe, rotate, shorten, widen, rescale, redraw, redesign, smooth over, fuse, substitute hardware, add a third lens or convert it into a Pro model. IMAGE 2 is the same phone and controls gel geometry only. IMAGE 3 and IMAGE 4 are camera-free crops and have zero authority over phone or gel geometry. No reference may replace IMAGE 1's phone.${geometryLock}

EXACT RED MASK - HIGHEST PRIORITY: IMAGE 2 is a coordinate-registered overlay of IMAGE 1, not a loose inspiration. The translucent red interior is the complete intended gel footprint. Replace that entire tinted region with one continuous gel slab. Put the centre of the OUTERMOST raised gel bead directly on the closed red outline, with no visible inward or outward drift. Remove every red pixel from the final image. Do not merely place gel somewhere inside the mask, inset from it, approximate it, reinterpret it or redraw it around the camera.

ORGANIC CAMERA-TO-OUTER ARCH - EXACT, NOT APPROXIMATE: on IMAGE 2's source-pixel grid, the long lower shoulder begins its upward sweep at approximately x=${guide.shoulderX}, y=${guide.shoulderY}. From that point, copy the red line's continuously changing curvature: it immediately sweeps UP AND RIGHT, leans progressively outward as it rises, rounds over as one broad convex dome near the top, then flows directly DOWN the ultra-close right outer edge. The entire shoulder-to-right-edge route is one uninterrupted organic curve. IMAGE 2's exact red silhouette overrides every generic numeric clearance rule.

EXTRA-LARGE ROUNDING RADII: the lower shoulder must start turning early and remain broad and gradual across roughly 120 source pixels before rising. The upper lobe must use one wide, soft crown whose curvature is distributed across the full top-right width. Preserve smooth tangent continuity throughout: no local kink, sudden tightening, near-vertical middle segment, narrow arch, pinched neck or abrupt curvature spike. When uncertain, make both the shoulder transition and top crown rounder, wider and softer while staying directly on IMAGE 2's red line.

ABSOLUTELY NOT SQUARE: there must be NO straight vertical inner wall above the shoulder, NO horizontal top edge, NO flat-topped cap, NO 90-degree turn, NO quarter-circle corner pair, and NO rounded rectangle, pill, box or squared-off top-right panel. Do not construct the upper-right gel area from straight segments joined by rounded corners. Even with the gel material removed, its outline alone must match IMAGE 2's asymmetric rising sweep and single rounded crown.

FORBIDDEN CAMERA MOAT: do not trace, echo, offset or run parallel to the rounded-square camera island. Do not create a rounded-square gel cutout, four-sided loop or tight moat around it. Do not add a gel edge above or to the left of the camera island. Do not curve inward toward the lower-right camera lens. Never trace individual lenses or hardware, make keyholes/notches/pinches, put gel between hardware, or move any part of the red camera-side path closer to the hardware. The camera island remains outside the gel footprint while gel fills the complete top-right region.

ONE CONTINUOUS ORGANIC GEL SLAB: cover every part of IMAGE 2's red-tinted area. Fill the complete rounded top-right lobe, continue through the curved shoulder beneath the camera, then cover the entire lower back. No detached gel piece, bare-shell island, missing patch, uncoated band or separate top-right patch.

ULTRA-CLOSE OUTER FIT: along the complete left edge below the camera shoulder, complete bottom edge, complete right edge and top-right segment, follow IMAGE 2's red outline exactly. It is intentionally placed at the inner silicone wall, leaving only one unbroken shell-colour hairline and a tiny contact shadow. Never shrink or centre the slab, widen the outer gap, overlap the wall, or move the outer line inward to imitate the much wider camera gap.

GEL/SHELL SEPARATION: gel and silicone must remain visibly separate materials. Keep the raised gel bead fully inside the flat back panel with one unbroken shell-colour hairline and tiny natural contact shadow. Never blend gel into silicone, recolour the shell as gel, erase the shell reveal, create a double rim or mould gel as part of the case.

RAISED RIM STYLE: copy IMAGE 3's thick, puffy, raised, glossy wet perimeter bead with restrained organic waves. Keep bead thickness and height consistent around the outer perimeter and camera-side boundary. The broad centre is calmer and flatter. IMAGE 3 is a local detail only: never copy its phone, camera or overall footprint. No thin hard edge, inflated corner blob or style change near the camera.

${finish.material}

FINAL OVERLAY QA BEFORE OUTPUT: mentally overlay the result on IMAGE 2. The outermost gel bead must cover the red outline all the way around; the camera shoulder must begin turning early, stay broad, and flow continuously up-and-right into one extra-wide rounded crown before descending the outer-right edge; no tight shoulder, narrow arch, flat top, straight inner wall, rounded rectangle or camera moat; exact ${model.name} hardware and proportions; full uncropped shell; one continuous organic slab; gel and shell never fused; exact ${finish.label} material; no red guide, visible logo, brand mark, text, icon or symbol. If the bead would not cover IMAGE 2's red line, correct it before output. Output one photorealistic ultra-high-resolution straight-on full back-view product image only.`
}

const conversationIndex = process.argv.indexOf('--conversation-url')
const conversationUrl = conversationIndex >= 0 ? process.argv[conversationIndex + 1] : ''
await mkdir(REFERENCE_DIR, { recursive: true })

await sharp(STYLE_REFERENCE.source)
  .extract(STYLE_REFERENCE.extract)
  .png()
  .toFile(path.join(REFERENCE_DIR, STYLE_REFERENCE.file))
for (const finish of FINISHES) {
  await sharp(finish.materialSource)
    .extract(finish.materialExtract)
    .png()
    .toFile(path.join(REFERENCE_DIR, finish.materialFile))
}
for (const model of MODELS) {
  for (const shellFile of ['black', 'white']) {
    await copyFile(
      `public/assets/cases/case-without-gel/${model.id}-${shellFile}.png`,
      path.join(REFERENCE_DIR, `${RUN}-${model.id}-${shellFile}-source.png`),
    )
    await copyFile(
      `public/assets/cases/gpt-references/gpt-${model.id}-${shellFile}-standard-exact-gel-path.png`,
      path.join(REFERENCE_DIR, `${RUN}-${model.id}-${shellFile}-exact-gel-path.png`),
    )
  }
}

const prompts = MODELS.flatMap((model) => FINISHES.map((finish) => ({
  modelId: model.id,
  finish: finish.id,
  imageVersion: model.imageVersion,
  promptText: promptFor(model, finish),
  referenceImages: [
    `${RUN}-${model.id}-${finish.shellFile}-source.png`,
    `${RUN}-${model.id}-${finish.shellFile}-exact-gel-path.png`,
    STYLE_REFERENCE.file,
    finish.materialFile,
    ...(finish.id === 'black' ? [] : [`${RUN}-${model.id}-black-geometry.png`]),
  ],
  generator: 'ChatGPT',
  conversationUrl,
})))

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  campaign: CAMPAIGN,
  promptRevision: RUN,
  conversationUrl,
  prompts,
}, null, 2)}\n`)
console.log(`Wrote ${prompts.length} prompts to ${OUTPUT_PATH}`)