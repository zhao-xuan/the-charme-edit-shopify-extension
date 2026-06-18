/**
 * measure-camera-keepouts.mjs
 * -------------------------------------------------------------------------
 * Every iPhone model's camera is laid out differently (single lens, vertical
 * dual, square dual, square triple Pro island, horizontal 17-series plateau).
 * Lumping them into a few generic shapes makes the charm keep-out wrong on many
 * models. Instead we MEASURE the real camera region straight from each model's
 * white case photo (dist/assets/cases/<id>-white.png) — the lenses are clearly
 * darker than the white silicone — and store a per-model keep-out rectangle as
 * fractions of the case footprint.
 *
 * Output:
 *   - src/data/camera-keepouts.json : { <id>: { x, y, w, h } }  (case fractions)
 *   - /tmp/cam-keepout/<id>.png      : debug overlay (red = measured keep-out)
 *
 * Run:  node scripts/measure-camera-keepouts.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CASES = join(ROOT, 'public', 'assets', 'cases')
const OUT_JSON = join(ROOT, 'src', 'data', 'camera-keepouts.json')
const OUT_DBG = '/tmp/cam-keepout'

// Camera lenses read darker than the white silicone; this brightness cut splits
// them. The case body (white) is ~235-255; lenses/island shadow ~140-210.
const DARK = 206
const SEARCH_FRAC = 0.46 // only look in the top portion (avoid the Apple logo)
const MARGIN_FRAC = 0.05 // grow the measured lens bbox to cover the raised rim

function components(mask, W, H, minArea) {
  const n = W * H
  const lab = new Int32Array(n)
  const st = new Int32Array(n)
  const comps = []
  let cur = 0
  for (let s = 0; s < n; s++) {
    if (lab[s] || !mask[s]) continue
    cur++
    let sp = 0
    st[sp++] = s
    lab[s] = cur
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp > 0) {
      const p = st[--sp]
      area++
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!lab[q] && mask[q]) { lab[q] = cur; st[sp++] = q }
      }
    }
    if (area >= minArea) comps.push({ minx, maxx, miny, maxy, area })
  }
  return comps
}

async function measure(id, file) {
  const { data, info } = await sharp(join(CASES, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const A = (p) => data[p * 4 + 3]

  // case footprint from alpha
  let cminx = W, cmaxx = 0, cminy = H, cmaxy = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (A(y * W + x) > 40) { if (x < cminx) cminx = x; if (x > cmaxx) cmaxx = x; if (y < cminy) cminy = y; if (y > cmaxy) cmaxy = y }
  }
  const cw = cmaxx - cminx + 1
  const ch = cmaxy - cminy + 1
  const searchBottom = cminy + ch * SEARCH_FRAC

  // dark (lens) mask in the top region
  const mask = new Uint8Array(W * H)
  for (let y = cminy; y <= searchBottom; y++) for (let x = cminx; x <= cmaxx; x++) {
    const p = y * W + x
    if (A(p) < 200) continue
    const b = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3
    if (b < DARK) mask[p] = 1
  }
  const minArea = Math.round(cw * ch * 0.0008)
  let comps = components(mask, W, H, minArea)
  // drop slivers hugging the case side edges (side buttons, not the camera)
  comps = comps.filter((c) => {
    const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1
    const touchesSide = c.minx <= cminx + cw * 0.02 || c.maxx >= cmaxx - cw * 0.02
    const thin = Math.min(w, h) < cw * 0.03
    return !(touchesSide && thin)
  })
  if (!comps.length) return null
  // union the lens-cluster components into one camera bbox
  let minx = W, maxx = 0, miny = H, maxy = 0
  for (const c of comps) { minx = Math.min(minx, c.minx); maxx = Math.max(maxx, c.maxx); miny = Math.min(miny, c.miny); maxy = Math.max(maxy, c.maxy) }
  // grow to cover the raised silicone rim, clamped to the case
  const mx = cw * MARGIN_FRAC, my = cw * MARGIN_FRAC
  minx = Math.max(cminx, minx - mx); maxx = Math.min(cmaxx, maxx + mx)
  miny = Math.max(cminy, miny - my); maxy = Math.min(cmaxy, maxy + my)

  const frac = {
    x: +((minx - cminx) / cw).toFixed(3),
    y: +((miny - cminy) / ch).toFixed(3),
    w: +((maxx - minx + 1) / cw).toFixed(3),
    h: +((maxy - miny + 1) / ch).toFixed(3),
  }

  // debug overlay: translucent red fill + solid border over the keep-out
  const dbg = Buffer.from(data)
  const ix0 = Math.round(minx), ix1 = Math.round(maxx), iy0 = Math.round(miny), iy1 = Math.round(maxy)
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
    const o = (y * W + x) * 4
    dbg[o] = Math.round(dbg[o] * 0.45 + 255 * 0.55)
    dbg[o + 1] = Math.round(dbg[o + 1] * 0.45)
    dbg[o + 2] = Math.round(dbg[o + 2] * 0.45)
    dbg[o + 3] = 255
  }
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) { const o = (y * W + x) * 4; dbg[o] = 220; dbg[o + 1] = 0; dbg[o + 2] = 0; dbg[o + 3] = 255 } }
  for (let t = 0; t < 6; t++) {
    for (let x = ix0; x <= ix1; x++) { put(x, iy0 + t); put(x, iy1 - t) }
    for (let y = iy0; y <= iy1; y++) { put(ix0 + t, y); put(ix1 - t, y) }
  }
  await mkdir(OUT_DBG, { recursive: true })
  await sharp(dbg, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(OUT_DBG, `${id}.png`))
  return frac
}

const files = (await readdir(CASES)).filter((f) => /-white\.png$/.test(f))
const out = {}
for (const f of files.sort()) {
  const id = f.replace(/-white\.png$/, '')
  const frac = await measure(id, f)
  if (frac) { out[id] = frac; console.log(`${id.padEnd(22)} x=${frac.x} y=${frac.y} w=${frac.w} h=${frac.h}`) }
  else console.log(`${id.padEnd(22)} (no camera detected)`)
}
await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n')
console.log(`\nWrote ${Object.keys(out).length} keep-outs to ${OUT_JSON}`)
