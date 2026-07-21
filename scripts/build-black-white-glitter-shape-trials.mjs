import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const OUTPUT_DIR = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const MANIFEST_PATH = 'reference/case-history/iphone-black-white-glitter-shape-trials.json'
const keepouts = JSON.parse(await readFile('src/data/camera-keepouts.json', 'utf8'))

const MODELS = [
  {
    id: 'iphone-11',
    name: 'iPhone 11',
    hardware: 'exactly TWO large lenses stacked VERTICALLY in the original rounded-square camera island, with the original flash and microphone',
    style: {
      black: 'public/assets/cases/case-with-gel/integrated-iphone-11-black.png',
      white: 'public/assets/cases/case-with-gel/integrated-iphone-11-white.png',
    },
    glitter: 'public/assets/cases/case-history/iphone-11/glitter/v4.png',
  },
  {
    id: 'iphone-14-pro',
    name: 'iPhone 14 Pro',
    hardware: 'exactly THREE large lenses in the original triangular arrangement, with the original flash, microphone and LiDAR sensor',
    style: {
      black: 'public/assets/cases/case-history/iphone-14-pro/black/v2.png',
      white: 'public/assets/cases/case-history/iphone-14-pro/white/v2.png',
    },
    glitter: 'public/assets/cases/case-history/iphone-14-pro/glitter/v3.png',
  },
]

const FINISHES = {
  black: {
    label: 'Black',
    shell: 'BLACK',
    materialSource: 'reference/case-history/references/gpt-black-material.png',
    material: `Keep the current deep neutral jet-black Gel exactly: a broad calm near-matte black centre, the same opacity and tonal depth, and bright restrained white wet highlights concentrated on the thick raised glossy bead. Do not make it grey, translucent, Glitter-like, metallic or mirror-glossy across the centre.`,
  },
  white: {
    label: 'White',
    shell: 'OFF-WHITE',
    materialSource: 'reference/case-history/references/gpt-white-material.png',
    material: `Keep the current clean neutral-white Gel exactly, visibly distinct from the original off-white silicone shell. Preserve the same calm smooth centre, restrained soft sheen, stronger wet gloss on the thick raised bead, and fine light-grey contact shadow. Never make it cream, beige, ivory, yellow, transparent or Glitter-like.`,
  },
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

async function subjectBounds(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const alphaHasBackground = Array.from({ length: info.width * info.height }, (_, index) => data[index * 4 + 3])
    .some((alpha) => alpha <= 40)
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index++) {
    const offset = index * 4
    const alpha = data[offset + 3]
    const isSubject = alphaHasBackground
      ? alpha > 40
      : Math.min(data[offset], data[offset + 1], data[offset + 2]) < 246
    if (!isSubject) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`Could not detect subject bounds in ${filePath}`)
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

async function styleCrop(sourcePath, outputPath) {
  const metadata = await sharp(sourcePath).metadata()
  const bounds = await subjectBounds(sourcePath)
  const left = clamp(Math.round(bounds.left + bounds.width * 0.4), 0, metadata.width - 2)
  const top = clamp(Math.round(bounds.top + bounds.height * 0.5), 0, metadata.height - 2)
  const right = clamp(Math.round(bounds.left + bounds.width * 0.94), left + 1, metadata.width)
  const bottom = clamp(Math.round(bounds.top + bounds.height * 0.91), top + 1, metadata.height)
  await sharp(sourcePath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toFile(outputPath)
}

async function cameraCrop(sourcePath, modelId, outputPath) {
  const metadata = await sharp(sourcePath).metadata()
  const bounds = await subjectBounds(sourcePath)
  const keepout = keepouts[modelId]
  const pad = 0.045
  const left = clamp(Math.round(bounds.left + bounds.width * (keepout.x - pad)), 0, metadata.width - 2)
  const top = clamp(Math.round(bounds.top + bounds.height * (keepout.y - pad)), 0, metadata.height - 2)
  const right = clamp(Math.round(bounds.left + bounds.width * (keepout.x + keepout.w + pad)), left + 1, metadata.width)
  const bottom = clamp(Math.round(bounds.top + bounds.height * (keepout.y + keepout.h + pad)), top + 1, metadata.height)
  await sharp(sourcePath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toFile(outputPath)
}

async function remapGuide(guidePath, whiteSourcePath, targetSourcePath, outputPath) {
  const [guide, whiteSource] = await Promise.all([
    sharp(guidePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(whiteSourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  if (guide.info.width !== whiteSource.info.width || guide.info.height !== whiteSource.info.height) {
    throw new Error(`${guidePath} is not registered to ${whiteSourcePath}`)
  }
  const overlay = Buffer.alloc(guide.info.width * guide.info.height * 4)
  for (let index = 0; index < guide.info.width * guide.info.height; index++) {
    const offset = index * 4
    const difference = Math.max(
      Math.abs(guide.data[offset] - whiteSource.data[offset]),
      Math.abs(guide.data[offset + 1] - whiteSource.data[offset + 1]),
      Math.abs(guide.data[offset + 2] - whiteSource.data[offset + 2]),
    )
    if (difference < 4 || guide.data[offset] <= guide.data[offset + 1]) continue
    overlay[offset] = 255
    overlay[offset + 1] = 55
    overlay[offset + 2] = 70
    overlay[offset + 3] = clamp(difference * 3, 28, 230)
  }
  const [whiteBounds, targetBounds] = await Promise.all([
    subjectBounds(whiteSourcePath),
    subjectBounds(targetSourcePath),
  ])
  const remapped = await sharp(overlay, {
    raw: { width: guide.info.width, height: guide.info.height, channels: 4 },
  })
    .extract(whiteBounds)
    .resize(targetBounds.width, targetBounds.height, { fit: 'fill' })
    .png()
    .toBuffer()
  await sharp(targetSourcePath)
    .composite([{ input: remapped, left: targetBounds.left, top: targetBounds.top }])
    .png()
    .toFile(outputPath)
}

function promptFor(model, finish) {
  return `Generate exactly ONE NEW full-canvas ${model.name} ${finish.label} Gel product image now from the SIX attachments.

ATTACHMENT MAP AND AUTHORITY:
IMAGE 1 = the exact bare ${finish.shell} ${model.name} source. It alone controls the complete phone, silicone shell, hardware, scale, framing, buttons, shadows and pure-white background.
IMAGE 2 = a camera-free crop from the current accepted ${finish.label} result. It controls ONLY the existing ${finish.label} Gel visual style: colour, opacity, centre finish, raised-bead thickness and highlight language. Its cropped edges have no geometry authority.
IMAGE 3 = the accepted same-model Glitter result. It controls ONLY the exact normalized Gel footprint, especially the camera-side boundary, broad rising turn and ultra-close left/bottom/right outer fit. Never copy its white shell, Glitter particles, colour or material.
IMAGE 4 = IMAGE 1 with the same accepted Glitter footprint mapped into IMAGE 1 coordinates as a closed red guide. It controls the final Gel boundary coordinates.
IMAGE 5 = the exact same-model camera hardware crop from IMAGE 1. It locks lens count, arrangement, flash, microphone and sensors.
IMAGE 6 = the existing ${finish.label} material reference. It reinforces material only and has zero phone or geometry authority.

Add ${finish.label} Gel to IMAGE 1. Preserve the established ${finish.label} style without redesigning it; change only the Gel footprint.

ABSOLUTE PRODUCT LOCK: preserve IMAGE 1 pixel-for-pixel outside the new Gel area: exact ${model.name}, ${model.hardware}, shell colour and texture, buttons, silhouette, proportions, width/height ratio, phone scale, position, framing, complete bottom edge, all four corners and shadows. Copy IMAGE 5 hardware exactly. Keep the whole phone straight-on, centred, fully visible and uncropped. Never zoom, crop, reframe, rotate, resize, widen, shorten, redraw, smooth over, substitute hardware, change lens count, add a logo or alter the background.

STYLE LOCK - NO MATERIAL CHANGE: IMAGE 2 and IMAGE 6 jointly define the current ${finish.label} Gel appearance. Preserve that exact colour, opacity, broad-centre finish, rim height, rim thickness, wet highlights, restrained folds and contact-shadow language. Do not copy IMAGE 2's old footprint or old camera clearance. ${finish.material}

GLITTER-SHAPE TRANSFER - HIGHEST PRIORITY: copy IMAGE 3's complete Gel silhouette onto IMAGE 1 at the same normalized position within the shell. IMAGE 4 resolves that silhouette into IMAGE 1's coordinates. Fill the complete red-tinted interior with one continuous ${finish.label} Gel slab, put the centre of the OUTERMOST raised bead directly on the closed red line, and remove every red pixel. Never inset, shrink, lower, centre, simplify or approximate the footprint.

CAMERA-RIGHT SHAPE LOCK: reproduce IMAGE 3's camera-side route exactly. The Gel runs immediately beneath the complete camera island with only the same NARROW clean strip of bare shell, then begins its broad rising turn near the island's RIGHT edge and flows up-and-right into one wide soft crown before descending the outer-right edge. No large shelf below the camera, no wide corridor on its right, no late or distant turn. Do not trace the camera island, wrap individual lenses, form a moat, notch, keyhole, pinch, straight inner wall, flat top, rounded rectangle, pill or detached patch. The camera hardware stays entirely outside the Gel.

ULTRA-CLOSE OUTER FIT - NON-NEGOTIABLE: along the complete LEFT edge below the camera shoulder, complete BOTTOM edge, complete RIGHT edge and top-right outer segment, expand the Gel to the inner silicone wall exactly as in IMAGE 3. Leave only one continuous shell-colour hairline and a tiny contact shadow, targeting roughly 0.15%-0.30% of case width and never more than 0.35%. At this source scale the visible flat-shell reveal should read as approximately one to three pixels, not a normal border. Never shrink or centre the slab, widen that reveal, touch or overlap the silicone wall, erase the shell line, fuse Gel into silicone or create a double rim.

ONE CONTINUOUS ORGANIC SLAB: cover every part of IMAGE 4's red-tinted region. Keep one broad calm centre and one consistent thick puffy raised glossy perimeter bead. No bare-shell island, missing patch, uncoated band, detached top-right piece, thin hard cut edge, inflated corner blob or style change near the camera.

FINAL OVERLAY QA BEFORE OUTPUT: exact source phone and hardware; current ${finish.label} material unchanged; accepted same-model Glitter footprint transferred exactly; camera-right turn begins early and stays broad; outermost bead covers IMAGE 4's red line all the way around; left/bottom/right shell reveal is only one hairline; full uncropped shell; no Glitter, red guide, logo, text, icon or symbol. Output one photorealistic ultra-high-resolution straight-on full back-view product image only.`
}

await mkdir(OUTPUT_DIR, { recursive: true })
for (const [finishId, finish] of Object.entries(FINISHES)) {
  await copyFile(finish.materialSource, path.join(OUTPUT_DIR, `trial-${finishId}-material.png`))
}

const prompts = []
for (const model of MODELS) {
  const whiteSource = `public/assets/cases/case-without-gel/${model.id}-white.png`
  const guideSource = `reference/case-history/references/gpt-${model.id}-closed-gel-path.png`
  const glitterName = `trial-${model.id}-accepted-glitter-geometry.png`
  await copyFile(model.glitter, path.join(OUTPUT_DIR, glitterName))
  for (const [finishId, finish] of Object.entries(FINISHES)) {
    const sourcePath = `public/assets/cases/case-without-gel/${model.id}-${finishId}.png`
    const sourceName = `trial-${model.id}-${finishId}-source.png`
    const styleName = `trial-${model.id}-${finishId}-current-style.png`
    const guideName = `trial-${model.id}-${finishId}-glitter-shape-guide.png`
    const cameraName = `trial-${model.id}-${finishId}-camera-lock.png`
    await Promise.all([
      copyFile(sourcePath, path.join(OUTPUT_DIR, sourceName)),
      styleCrop(model.style[finishId], path.join(OUTPUT_DIR, styleName)),
      cameraCrop(sourcePath, model.id, path.join(OUTPUT_DIR, cameraName)),
      finishId === 'white'
        ? copyFile(guideSource, path.join(OUTPUT_DIR, guideName))
        : remapGuide(guideSource, whiteSource, sourcePath, path.join(OUTPUT_DIR, guideName)),
    ])
    prompts.push({
      modelId: model.id,
      finish: finishId,
      publish: false,
      generator: 'ChatGPT',
      promptText: promptFor(model, finish),
      referenceImages: [
        sourceName,
        styleName,
        glitterName,
        guideName,
        cameraName,
        `trial-${finishId}-material.png`,
      ],
    })
  }
}

await writeFile(MANIFEST_PATH, `${JSON.stringify({
  schemaVersion: 1,
  campaign: 'iphone-black-white-glitter-shape-trials',
  candidateOnly: true,
  prompts,
}, null, 2)}\n`)
console.log(`Wrote ${prompts.length} unpublished trial prompts to ${MANIFEST_PATH}`)