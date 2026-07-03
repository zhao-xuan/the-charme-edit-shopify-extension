/**
 * Build the poured-gel overlay assets for phone cases.
 *
 * Source: reference/gels-source/<rep>-<white|black>.png — GPT-generated gel-only
 * renders, background already keyed to transparency (see the gel-generation
 * session). Each "rep" (representative) shape covers a group of models that share
 * a camera layout + footprint (all iPhone aspect ratios are ~0.50):
 *
 *   17       → iPhone 17 + every 11/12/13/14/15/16 variant (top-left camera island)
 *   17pro    → iPhone 17 Pro            (wide top camera bar)
 *   17promax → iPhone 17 Pro Max        (wide top camera bar)
 *   air      → iPhone Air               (wide top camera bar)
 *   8        → iPhone 7, 8              (small single top-left camera, 4.7")
 *   8plus    → iPhone 7 Plus, 8 Plus    (dual top-left camera, 5.5")
 *   xs       → iPhone X, XS, XS Max     (vertical dual top-left camera)
 *
 * Each gel is trimmed to its content and re-framed onto a standard case-aspect
 * canvas (900×1806 ≈ 0.498) so it overlays the real Apple case photo (which fills
 * its frame edge-to-edge) in register: the camera scoop lands on the real camera,
 * the gel body sits on the back. `rect` = [x,y,w,h] as fractions of the frame the
 * gel is stretched to fill — top-left-camera gels sit near the top; wide-bar gels
 * start below the camera bar.
 *
 * Output: public/assets/cases/gel-<rep>-<white|black>.png (14 files). The model→rep
 * map lives in src/data/products.js (GEL_REP); ProductStage overlays the gel for
 * the chosen gel colour on top of the case photo.
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'reference/gels-source')
const OUT = join(ROOT, 'public/assets/cases')

const FW = 900
const FH = 1806

// [x, y, w, h] fractions of the frame the trimmed gel is stretched to fill.
const RECT = {
  '17': [0.035, 0.02, 0.93, 0.95],
  '8': [0.035, 0.02, 0.93, 0.955],
  '8plus': [0.035, 0.02, 0.93, 0.955],
  'xs': [0.02, 0.015, 0.96, 0.97],
  '17pro': [0.05, 0.145, 0.9, 0.83],
  '17promax': [0.05, 0.145, 0.9, 0.83],
  'air': [0.05, 0.125, 0.9, 0.855],
}

/**
 * Remove small isolated dark specks from a light (white) gel — leftover marks in
 * the GPT render that read as dirt on the pearlescent body. A dark pixel is only
 * inpainted when its surrounding window is overwhelmingly light, so the gel's own
 * dark glossy shading lines (which have dark neighbourhoods) are left untouched.
 */
/**
 * Fill tiny transparent holes / speck-intrusions in the gel (leftover keying
 * artifacts near the camera scoop that would show the case through). A
 * morphological CLOSE on the opaque mask (dilate → erode) seals holes/necks up
 * to ~2·R px while leaving the large camera opening and the gel silhouette
 * essentially unchanged; newly-filled pixels are inpainted from nearby gel.
 */
async function fillAlphaHoles(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: ch } = info
  const N = W * H
  const R = 3
  const O = new Uint8Array(N)
  for (let p = 0; p < N; p++) O[p] = data[p * ch + 3] >= 128 ? 1 : 0
  const box = (src, grow) => {
    const dst = new Uint8Array(N)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let hit = grow ? 0 : 1
      for (let dy = -R; dy <= R && hit === (grow ? 0 : 1); dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) { if (!grow) { hit = 0; break } continue }
        const v = src[ny * W + nx]
        if (grow && v) { hit = 1; break }
        if (!grow && !v) { hit = 0; break }
      }
      dst[y * W + x] = hit
    }
    return dst
  }
  const closed = box(box(O, true), false) // dilate then erode
  const out = Buffer.from(data)
  for (let p = 0; p < N; p++) {
    if (!closed[p] || O[p]) continue // only pixels the close newly filled
    const x = p % W, y = (p / W) | 0
    let sr = 0, sg = 0, sb = 0, n = 0
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const q = ny * W + nx; if (O[q]) { const j = q * ch; sr += data[j]; sg += data[j + 1]; sb += data[j + 2]; n++ }
    }
    const i = p * ch
    out[i + 3] = 255
    if (n) { out[i] = Math.round(sr / n); out[i + 1] = Math.round(sg / n); out[i + 2] = Math.round(sb / n) }
  }
  return sharp(out, { raw: { width: W, height: H, channels: ch } }).png().toBuffer()
}

async function build(rep, color) {
  const [rx, ry, rw, rh] = RECT[rep]
  let src = await sharp(join(SRC, `${rep}-${color}.png`)).trim({ threshold: 10 }).toBuffer()
  src = await fillAlphaHoles(src)
  const gel = await sharp(src)
    .resize({ width: Math.round(FW * rw), height: Math.round(FH * rh), fit: 'fill' })
    .toBuffer()
  const out = join(OUT, `gel-${rep}-${color}.png`)
  await sharp({ create: { width: FW, height: FH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: gel, left: Math.round(FW * rx), top: Math.round(FH * ry) }])
    .png({ palette: true, quality: 82, effort: 9, compressionLevel: 9, dither: 0.6 })
    .toFile(out)
  return out
}

const reps = Object.keys(RECT)
let n = 0
for (const rep of reps) {
  for (const color of ['white', 'black']) {
    await build(rep, color)
    n++
  }
}
console.log(`Built ${n} gel overlays → public/assets/cases/gel-*.png`)
