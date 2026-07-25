import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const OUTPUT_DIR = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const MANIFEST_PATH = 'reference/case-history/iphone-black-white-glitter-shape-trials.json'
const SOURCE_PATH = 'public/assets/cases/case-without-gel/iphone-air-white.png'
const GLITTER_PATH = 'public/assets/cases/case-history/iphone-air/glitter/v2.png'
const CORRECTED_GLITTER_PATH = 'reference/case-history/generated/black-white-glitter-shape-trials/candidates/iphone-air-glitter-v1.png'
const GUIDE_NAME = 'trial-iphone-air-extra-camera-clearance-guide.png'

await mkdir(OUTPUT_DIR, { recursive: true })

const metadata = await sharp(SOURCE_PATH).metadata()
const width = metadata.width
const height = metadata.height
const left = Math.round(width * 0.055)
const right = Math.round(width * 0.945)
const top = Math.round(height * 0.215)
const bottom = Math.round(height * 0.973)
const radius = Math.round(width * 0.075)
const strokeWidth = Math.max(6, Math.round(width * 0.008))
const pathData = [
  `M ${left + radius} ${top}`,
  `L ${right - radius} ${top}`,
  `C ${right - Math.round(radius * 0.35)} ${top} ${right} ${top + Math.round(radius * 0.35)} ${right} ${top + radius}`,
  `L ${right} ${bottom - radius}`,
  `C ${right} ${bottom - Math.round(radius * 0.35)} ${right - Math.round(radius * 0.35)} ${bottom} ${right - radius} ${bottom}`,
  `L ${left + radius} ${bottom}`,
  `C ${left + Math.round(radius * 0.35)} ${bottom} ${left} ${bottom - Math.round(radius * 0.35)} ${left} ${bottom - radius}`,
  `L ${left} ${top + radius}`,
  `C ${left} ${top + Math.round(radius * 0.35)} ${left + Math.round(radius * 0.35)} ${top} ${left + radius} ${top}`,
  'Z',
].join(' ')
const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${pathData}" fill="rgba(255,55,70,0.09)" stroke="#ff3746" stroke-width="${strokeWidth}" stroke-linejoin="round" />
</svg>`)
const guidePath = path.join(OUTPUT_DIR, GUIDE_NAME)
await sharp(SOURCE_PATH).composite([{ input: overlay }]).png().toFile(guidePath)

let whiteGeometrySource = GLITTER_PATH
try {
  await access(CORRECTED_GLITTER_PATH)
  whiteGeometrySource = CORRECTED_GLITTER_PATH
} catch {
  // The first campaign build happens before the corrected Glitter candidate exists.
}

const copies = [
  [SOURCE_PATH, 'trial-iphone-air-glitter-source.png'],
  [GLITTER_PATH, 'trial-iphone-air-glitter-current-style.png'],
  [guidePath, 'trial-iphone-air-black-glitter-shape-guide.png'],
  [guidePath, 'trial-iphone-air-white-glitter-shape-guide.png'],
  [whiteGeometrySource, 'trial-iphone-air-accepted-glitter-geometry.png'],
  [path.join(OUTPUT_DIR, 'trial-iphone-air-white-camera-lock.png'), 'trial-iphone-air-glitter-camera-lock.png'],
  ['reference/case-history/references/gpt-sparse-glitter-rim-detail.png', 'trial-iphone-air-glitter-rim-detail.png'],
  ['reference/case-history/references/gpt-sparse-glitter-material-detail.png', 'trial-iphone-air-glitter-material-detail.png'],
]
await Promise.all(copies.map(([source, name]) => copyFile(source, path.join(OUTPUT_DIR, name))))

const promptText = `Generate exactly ONE NEW full-canvas iPhone Air Glitter Gel product image now from the SIX attachments.

ATTACHMENT AUTHORITY:
IMAGE 1 alone controls the exact complete bare OFF-WHITE iPhone Air, silicone shell, wide horizontal camera plateau, hardware, scale, framing, buttons, shadows and pure-white background.
IMAGE 2 is the latest accepted same-model Glitter v2 result. It controls ONLY the existing Glitter material, raised-bead style, left/bottom/right outer fit and overall rounded-rectangle character. Its too-close top edge has no authority.
IMAGE 3 is the mandatory revised closed red Gel guide. It alone controls the complete new footprint and deliberately increases the bare-shell clearance below the camera plateau.
IMAGE 4 locks the exact same-model camera hardware.
IMAGE 5 controls the thick puffy glossy wet raised rim only.
IMAGE 6 controls the very sparse Glitter material only.

ABSOLUTE PRODUCT LOCK: preserve IMAGE 1 exactly outside the new Gel area: the exact iPhone Air with its original wide horizontal raised camera plateau, exactly ONE large lens at left, original microphone near centre and original circular flash at right. Preserve every ring, reflection, spacing, button, corner, full edge, silhouette, proportion, scale, position and shadow. Keep the complete phone straight-on, centred, fully visible and uncropped. Copy IMAGE 4 hardware exactly. Never zoom, crop, reframe, resize, redraw, add a lens, change the plateau or add a logo.

IPHONE AIR EXTRA CAMERA CLEARANCE - HIGHEST PRIORITY: move ONLY the Gel's camera-facing top boundary farther down than IMAGE 2. Put the centre of the OUTERMOST raised bead directly on the complete top red line in IMAGE 3. Leave one clean continuous band of bare off-white silicone between the COMPLETE bottom edge of the wide camera plateau and the Gel bead, targeting 4%-6% of case width and never below 4%. Keep the band visually even across the plateau and preserve the broad rounded transitions at both upper corners. No moat, per-lens cut-out, notch, keyhole, pinch, second rim or detached patch.

GEOMETRY LOCK: cover every pixel of IMAGE 3's red-tinted interior with one continuous Gel slab and remove every red pixel. Keep IMAGE 2's ultra-close left, bottom and right fit unchanged: only a one-to-three-pixel shell-colour hairline, with Gel and silicone visibly separate. Do not shrink, centre or lower the whole slab; only the requested top camera clearance changes.

MATERIAL LOCK - NO OTHER CHANGE: reproduce IMAGE 2, IMAGE 5 and IMAGE 6's calm translucent milky pearl-white Glitter Gel, thick puffy glossy wet perimeter bead, soft contact shadow and large quiet centre areas. Retain only 3 to 8 isolated widely separated pin-point silver-white micro-glints. No grain, frost, sand, dense dots, flakes, sequins, crystals, rainbow colour, text, icon, watermark or material redesign.

FINAL QA BEFORE OUTPUT: exact uncropped iPhone Air and one-lens camera plateau; revised 4%-6% bare-shell camera band; all other footprint and material details unchanged; outermost bead covers the complete red line; no red guide or logo. Output one photorealistic ultra-high-resolution straight-on full back-view product image only.`

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
const airWhite = manifest.prompts.find((entry) => entry.modelId === 'iphone-air' && entry.finish === 'white')
if (whiteGeometrySource === CORRECTED_GLITTER_PATH && airWhite) {
  airWhite.promptText = airWhite.promptText
    .replace(
      'IMAGE 3 = the latest accepted same-model Glitter result (v2).',
      'IMAGE 3 = the newly corrected same-model Glitter candidate from this campaign.',
    )
    .replace(
      /IPHONE AIR EXTRA CAMERA CLEARANCE - HIGHEST PRIORITY OVERRIDE:[\s\S]*?No per-lens cut-out, moat, notch, keyhole, pinch, straight inner wall, detached patch or second rim\./,
      `IPHONE AIR CORRECTED-GLITTER SHAPE LOCK - HIGHEST PRIORITY: IMAGE 3 and IMAGE 4 encode the same newly corrected camera clearance. Copy IMAGE 3's complete rounded-rectangle Gel silhouette exactly, and put the centre of the OUTERMOST White Gel bead directly on IMAGE 4's complete closed red line. Preserve its clean continuous 4%-6% case-width band of bare off-white silicone below the COMPLETE wide camera plateau, including the broad rounded transitions at both upper corners. Do not move the top edge upward, shrink, centre, lower or redesign any other part of the Gel. No per-lens cut-out, moat, notch, keyhole, pinch, straight inner wall, detached patch or second rim.`,
    )
}
manifest.specialCases = {
  ...(manifest.specialCases || {}),
  iphoneAir: `Black, White and Glitter use the revised 4%-6% camera-clearance guide; Black and White geometry source is ${whiteGeometrySource === CORRECTED_GLITTER_PATH ? 'the corrected Glitter candidate' : 'accepted Glitter v2 until that candidate exists'}.`,
}
manifest.prompts = manifest.prompts.filter((entry) => !(entry.modelId === 'iphone-air' && entry.finish === 'glitter'))
manifest.prompts.push({
  modelId: 'iphone-air',
  finish: 'glitter',
  publish: false,
  generator: 'ChatGPT',
  promptText,
  referenceImages: [
    'trial-iphone-air-glitter-source.png',
    'trial-iphone-air-glitter-current-style.png',
    GUIDE_NAME,
    'trial-iphone-air-glitter-camera-lock.png',
    'trial-iphone-air-glitter-rim-detail.png',
    'trial-iphone-air-glitter-material-detail.png',
  ],
})
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Added iPhone Air Glitter clearance trial; guide top=${top}px (${(top / width * 100).toFixed(1)}% of case-width units)`)