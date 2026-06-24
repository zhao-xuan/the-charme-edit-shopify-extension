/**
 * process-gel.mjs
 * -------------------------------------------------------------------------
 * Bakes a "poured-gel glaze" onto every flat case PNG — the thick, wavy, glossy
 * resin layer the charms sit on (see the merchant's sample photo). This is the
 * SHELL ONLY: charms are still placed on top at render time, so nothing here
 * draws charms.
 *
 * Why procedural instead of an LLM: every phone is a different shape, but the
 * glaze is just a lit height-field clipped to the case silhouette. We generate
 * ONE fractal-noise relief, light it (diffuse + specular for the wet sheen) and
 * composite it over the real case photo with an `overlay` blend so the case's
 * own colour shows through — the SAME mask-to-alpha trick the old glitter
 * overlay used, but now it reads as a poured gel. Deterministic, instant, and
 * works on any silhouette (the camera cut-out is transparent, so the glaze
 * never bleeds onto the lenses).
 *
 * Input  : public/assets/cases/<model>-<finish>.png   (flat silicone renders)
 * Output : public/assets/cases-gel/<model>-<finish>.png
 *
 * Run with:
 *   node scripts/process-gel.mjs                 # all cases
 *   node scripts/process-gel.mjs iphone-15-pro   # only names containing this
 *
 * Tunables (env vars, all optional):
 *   GEL_LOBES   lobes across the width  (default black 7 / white 5)
 *   GEL_RELIEF  apparent thickness, px  (default black 120 / white 60)
 *   GEL_SMOOTH  lobe smoothing (×width) (default black 0.004 / white 0.008)
 *   GEL_SHINE   hotspot tightness       (default black 26 / white 16)
 *   GEL_OCT     fractal octaves         (default 3)
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const SRC_DIR = join(ROOT, 'public', 'assets', 'cases')
const OUT_DIR = join(ROOT, 'public', 'assets', 'cases-gel')
const KEEPOUTS = JSON.parse(
  await readFile(join(ROOT, 'src', 'data', 'camera-keepouts.json'), 'utf8'),
)

const OCTAVES = Number(process.env.GEL_OCT) || 3

// ---- seeded fractal value noise (no deps; deterministic per case) ----------
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10) // smootherstep
const lerp = (a, b, t) => a + (b - a) * t
const clampByte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v))

function hash2(x, y, seed) {
  let h = seed | 0
  h = Math.imul(h ^ (x | 0), 2654435761)
  h = Math.imul(h ^ (y | 0), 2246822519)
  h ^= h >>> 13
  h = Math.imul(h, 3266489917)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

function vnoise(x, y, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const u = fade(x - ix)
  const v = fade(y - iy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

function fbm(x, y, seed) {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < OCTAVES; o++) {
    sum += amp * vnoise(x * freq, y * freq, seed + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // 0..1
}

// Stable per-file seed so a model's glaze looks the same on every re-run.
function seedFor(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

// Separable box blur (two passes ≈ gaussian) → turns noise into big soft lobes.
function blur(src, W, H, r) {
  if (r < 1) return src
  const win = r * 2 + 1
  const tmp = new Float32Array(W * H)
  const dst = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const row = y * W
    let acc = 0
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(W - 1, Math.max(0, i))]
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / win
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(H - 1, Math.max(0, i)) * W + x]
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = acc / win
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
    }
  }
  return dst
}

// Signed distance to a rounded rectangle (negative inside) — used to carve the
// camera island out of the glaze with a soft feathered edge.
function sdRoundRect(px, py, cx, cy, hw, hh, rad) {
  const qx = Math.abs(px - cx) - (hw - rad)
  const qy = Math.abs(py - cy) - (hh - rad)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad
}

// ---- light setup (top, slightly left, toward viewer) -----------------------
function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}
const [LX, LY, LZ] = norm3(-0.35, -0.5, 0.79) // light direction
const [HX, HY, HZ] = norm3(LX, LY, LZ + 1) // half-vector (view = +Z)

async function processCase(file) {
  const srcPath = join(SRC_DIR, file)
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const seed = seedFor(basename(file))

  // Per-finish recipe. Black silicone renders are mid-grey, so darkening reads
  // as camo — black is a thin glossy CLEAR coat: fine wet ripples defined by
  // bright speculars, almost no darkening. White is a thick PUFFY gel: big soft
  // lobes with light valley shadows and gentle highlights. (Env vars override.)
  const isBlack = /-black\.png$/i.test(file)
  const lobes = Number(process.env.GEL_LOBES) || (isBlack ? 7 : 4)
  const relief = Number(process.env.GEL_RELIEF) || (isBlack ? 120 : 70)
  const smooth = Number(process.env.GEL_SMOOTH) || (isBlack ? 0.004 : 0.011)
  const shine = Number(process.env.GEL_SHINE) || (isBlack ? 26 : 12)
  const shadeStrength = isBlack ? 0.6 : 0.55 // valley darkening amount
  const shadowFloor = isBlack ? 0.7 : 0.8 // lightest-allowed valley (× base)
  const specStrength = isBlack ? 1.0 : 0.5 // tight wet hotspots (added white)
  const sheenStrength = isBlack ? 0.0 : 0.05 // broad wet sheen (added white)

  // 1) fractal-noise height field, blurred into smooth poured-gel lobes.
  const fscale = lobes / W
  let height = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      height[y * W + x] = fbm(x * fscale, y * fscale, seed)
    }
  }
  height = blur(height, W, H, Math.max(2, Math.round(W * smooth)))

  // 2) camera-island keep-out (rounded rect from the measured fractions).
  const modelId = file.replace(/\.png$/i, '').replace(/-(white|black)$/i, '')
  const ko = KEEPOUTS[modelId]
  let cam = null
  if (ko) {
    const pad = 0.012 * W
    const x0 = ko.x * W - pad
    const y0 = ko.y * H - pad
    const w0 = ko.w * W + pad * 2
    const h0 = ko.h * H + pad * 2
    cam = {
      cx: x0 + w0 / 2,
      cy: y0 + h0 / 2,
      hw: w0 / 2,
      hh: h0 / 2,
      rad: Math.min(w0, h0) * 0.28,
      feather: Math.max(2, 0.01 * W),
    }
  }

  // 3) light the relief and composite it straight onto the real case pixels:
  //    multiply to darken valleys (floored so it never goes muddy), add white
  //    for the wet speculars. Masked to the case alpha; camera island untouched.
  const step = 2 // px finite-difference span
  const out = Buffer.from(data) // start from the original render (RGBA copy)
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - step)
    const yp = Math.min(H - 1, y + step)
    for (let x = 0; x < W; x++) {
      const idx = y * W + x
      const k = idx * 4
      if (data[k + 3] === 0) continue // transparent corner / cut-out → no glaze

      let effect = 1 // gel strength, feathered to 0 across the camera edge
      if (cam) {
        const d = sdRoundRect(x, y, cam.cx, cam.cy, cam.hw, cam.hh, cam.rad)
        if (d < 0) continue // inside the camera island → keep it clean
        if (d < cam.feather) effect = d / cam.feather
      }

      const xm = Math.max(0, x - step)
      const xp = Math.min(W - 1, x + step)
      // surface normal from the height gradient (relief = apparent thickness px)
      const slopeX = ((height[y * W + xp] - height[y * W + xm]) / (2 * step)) * relief
      const slopeY = ((height[yp * W + x] - height[ym * W + x]) / (2 * step)) * relief
      const inv = 1 / Math.hypot(slopeX, slopeY, 1)
      const Nx = -slopeX * inv
      const Ny = -slopeY * inv
      const Nz = inv

      const diff = Nx * LX + Ny * LY + Nz * LZ // Lambert
      let nh = Nx * HX + Ny * HY + Nz * HZ
      if (nh < 0) nh = 0

      // multiply factor: 1 on lobe tops/flat, down to shadowFloor in valleys
      let shade = 1 + Math.min(0, diff - LZ) * shadeStrength
      if (shade < shadowFloor) shade = shadowFloor
      shade = 1 + (shade - 1) * effect
      // additive white speculars: tight wet hotspot + broad sheen
      const add = (Math.pow(nh, shine) * specStrength + nh * nh * sheenStrength) * 255 * effect

      out[k] = clampByte(data[k] * shade + add)
      out[k + 1] = clampByte(data[k + 1] * shade + add)
      out[k + 2] = clampByte(data[k + 2] * shade + add)
      // alpha (k+3) carried over from the copy
    }
  }

  // 4) encode the glazed case. Palette quantisation keeps the wavy speculars
  //    sharp while cutting the PNG to a web-friendly size.
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer()
  await writeFile(join(OUT_DIR, file), png)
  return png.length
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const filter = process.argv.slice(2)
  const files = (await readdir(SRC_DIR))
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .filter((f) => filter.length === 0 || filter.some((q) => f.includes(q)))
    .sort()

  if (!files.length) {
    console.log('No matching case PNGs found.')
    return
  }
  console.log(`Glazing ${files.length} case(s) → public/assets/cases-gel/`)
  for (const f of files) {
    const bytes = await processCase(f)
    console.log(`  ${f}  (${Math.round(bytes / 1024)} kb)`)
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
