/**
 * extract-each-piece.mjs
 * -------------------------------------------------------------------------
 * Cuts every individual piece out of the charm-collage photos in
 * reference/2-charms-extracted (grids of charms / stones / shells shot on a
 * plain white seamless) and writes each as its own cropped, transparent PNG to
 * reference/3-charms-each-piece/.
 *
 * EDGE-AWARE MATTING (a Photoshop "magnetic lasso" in spirit) — built to kill
 * the two stubborn defects: leftover grey shadow blocks (阴影/灰色色块) and
 * hollow pieces whose see-through interior stayed opaque white (中空 not
 * transparent).
 *
 *   A. Edge map. A Sobel gradient G is computed on luminance. Strong G = a real
 *      object boundary (the "magnetic" edge the cut snaps to); flat seamless and
 *      soft shadow have G≈0.
 *
 *   B. Background + shadow removal (two guarded floods from the border):
 *        · pass 1 floods ONLY near-pure-white seamless. It is blocked by the
 *          soft shadow ring around every piece, so a white piece sitting in its
 *          own shadow is NOT eaten.
 *        · pass 2 also flows through "shadow-like" pixels (neutral, FLAT, and
 *          strictly DARKER than the seamless). We then add to the background
 *          only those shadow pixels — never bright white-piece pixels — so the
 *          grey halo of any size/shape is removed while the piece is preserved.
 *
 *   C. Hollow detection via relief. A pixel is "flat-bg" if it is background-
 *      coloured AND has no relief (G below a flatness threshold). The solid
 *      piece = foreground minus flat-bg. We fill every enclosed hole, then carve
 *      back out only the holes that are LARGE and FLAT and background-coloured —
 *      i.e. genuine see-through holes (letter counters, ring loops, the outline
 *      0, ∞, open hearts). A white pearl / acrylic flower keeps its body because
 *      its relief (G) means it is not "flat-bg", so it never becomes a hole.
 *
 *   D. Soft, decontaminated edges. Every boundary (outer rim AND inner hole rim)
 *      gets a colour-distance alpha ramp and has the white background tint un-
 *      mixed out, so no white/grey fringe remains.
 *
 * Run:  node scripts/extract-each-piece.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'reference', '2-charms-extracted')
const OUT = join(ROOT, 'reference', '3-charms-each-piece')

// --- tuning -------------------------------------------------------------
const BG_NEAR = 14         // ≤ this colour-distance from seamless = pure background
const SHADOW_MAX = 210     // generous neutral cap (shadow darkness is gated by luminance)
const SHADOW_LGAP = 6      // shadow must be at least this much DARKER than seamless
const SHADOW_LMIN = 135    // …but not darker than this (protects dark/grey pieces)
const SHADOW_SAT = 0.16    // shadow is near-neutral
const G_FLAT = 8           // Sobel magnitude ≤ this = "flat" (no relief)
const G_SHADOW = 14        // shadow flood tolerates this much gentle penumbra gradient
const CONTACT_GROW = 14    // max px the bg may creep into the neutral contact-shadow rim
const CONTACT_GMAX = 12    // …but only across FLAT pixels — it snaps to the piece's edge relief
const CONTACT_SAT = 0.20   // contact-shadow rim is near-neutral (gold/colour is above this)
const CONTACT_LMIN = 85    // …and not darker than this
const HOLE_NEAR = 26       // a see-through hole is within this colour-distance of bg
const HOLE_SAT = 0.14      // …and near-neutral
const HOLE_MIN_FRAC = 0.012// carve a hole only if ≥ this share of its piece's area
const HOLE_MIN_PX = 45     // …and at least this many px
const BAND_R = 2           // boundary band width for soft alpha + decontamination
const EDGE_T0 = 20         // colour-distance ↦ alpha 0 below this (kills white rim)
const EDGE_T1 = 80         // colour-distance ↦ alpha 1 above this
const PAD = 10             // px of transparent padding around each crop
const MIN_AREA_FRAC = 0.00018 // blob must cover at least this fraction of image
const MIN_SIDE = 16        // …and be at least this many px on its short side
const MIN_FILL = 0.10      // …and fill at least this share of its bounding box

const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const satOf = (r, g, b) => { const mx = Math.max(r, g, b); return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

/** 4-connected flood of `passable` pixels from every border pixel. */
function floodFromBorder(passable, W, H) {
  const n = W * H
  const filled = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const seed = (p) => { if (!filled[p] && passable[p]) { filled[p] = 1; stack[sp++] = p } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (sp > 0) {
    const p = stack[--sp]
    const x = p % W, y = (p / W) | 0
    if (x > 0) seed(p - 1)
    if (x < W - 1) seed(p + 1)
    if (y > 0) seed(p - W)
    if (y < H - 1) seed(p + W)
  }
  return filled
}

/** Fill background holes fully enclosed by foreground. */
function fillHoles(mask, W, H) {
  const inv = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) inv[p] = mask[p] ? 0 : 1
  const outside = floodFromBorder(inv, W, H)
  const out = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) out[p] = mask[p] || !outside[p] ? 1 : 0
  return out
}

function components(mask, W, H, minArea) {
  const n = W * H
  const labels = new Int32Array(n)
  const stack = new Int32Array(n)
  const comps = []
  let cur = 0
  for (let s = 0; s < n; s++) {
    if (labels[s] || !mask[s]) continue
    cur++
    let sp = 0
    stack[sp++] = s
    labels[s] = cur
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp > 0) {
      const p = stack[--sp]
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
        if (!labels[q] && mask[q]) { labels[q] = cur; stack[sp++] = q }
      }
    }
    comps.push({ label: cur, bbox: { minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1 }, area })
  }
  return { labels, comps: comps.filter((c) => c.area >= minArea) }
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const files = (await readdir(SRC)).filter((f) => /\.png$/i.test(f)).sort()
const manifest = []
let total = 0

for (const file of files) {
  const base = file.replace(/\.png$/i, '')
  const { data, info } = await sharp(join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const n = W * H

  // --- background colour = median of the 1px border ----------------------
  const rs = [], gs = [], bbs = []
  const sample = (y, x) => { const o = (y * W + x) * 4; rs.push(data[o]); gs.push(data[o + 1]); bbs.push(data[o + 2]) }
  for (let x = 0; x < W; x += 2) { sample(0, x); sample(H - 1, x) }
  for (let y = 0; y < H; y += 2) { sample(y, 0); sample(y, W - 1) }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] }
  const bg = { r: med(rs), g: med(gs), b: med(bbs) }
  const bgL = lumOf(bg.r, bg.g, bg.b)

  // --- per-pixel luminance, colour-distance, saturation ------------------
  const lum = new Float32Array(n)
  const dist = new Float32Array(n)
  const sat = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const o = p * 4, r = data[o], g = data[o + 1], b = data[o + 2]
    lum[p] = lumOf(r, g, b)
    dist[p] = Math.hypot(r - bg.r, g - bg.g, b - bg.b)
    sat[p] = satOf(r, g, b)
  }

  // --- A. Sobel edge map on luminance ------------------------------------
  const G = new Float32Array(n)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x
    const gx = -lum[p - W - 1] - 2 * lum[p - 1] - lum[p + W - 1] + lum[p - W + 1] + 2 * lum[p + 1] + lum[p + W + 1]
    const gy = -lum[p - W - 1] - 2 * lum[p - W] - lum[p - W + 1] + lum[p + W - 1] + 2 * lum[p + W] + lum[p + W + 1]
    G[p] = Math.hypot(gx, gy) / 4
  }

  // --- B. background + shadow removal (two guarded floods) ---------------
  const pureBg = new Uint8Array(n)
  const shadowLike = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (dist[p] <= BG_NEAR) pureBg[p] = 1
    if (sat[p] <= SHADOW_SAT && dist[p] <= SHADOW_MAX && G[p] <= G_SHADOW &&
        bgL - lum[p] >= SHADOW_LGAP && lum[p] >= SHADOW_LMIN) shadowLike[p] = 1
  }
  const passable2 = new Uint8Array(n)
  for (let p = 0; p < n; p++) passable2[p] = (pureBg[p] || shadowLike[p]) ? 1 : 0
  const floodPure = floodFromBorder(pureBg, W, H)
  const floodAll = floodFromBorder(passable2, W, H)
  const trueBg = new Uint8Array(n)
  // pure background only via pure path (never tunnel into a white piece);
  // shadow halo added wherever the wider flood reached a shadow pixel.
  for (let p = 0; p < n; p++) trueBg[p] = (floodPure[p] || (floodAll[p] && shadowLike[p])) ? 1 : 0

  // close the thin contact-shadow rim the flood can't reach (it is walled off by
  // the steep edge gradient): the bg creeps inward across FLAT, neutral, darker-
  // than-seamless pixels and snaps to the piece's edge relief. Gold/colour
  // (saturated) and white pieces (not darker than bg) and any pixel with relief
  // (a real piece surface) stop the creep, so only flat grey shadow is absorbed.
  let frontier = []
  for (let p = 0; p < n; p++) if (trueBg[p]) frontier.push(p)
  for (let pass = 0; pass < CONTACT_GROW; pass++) {
    const next = []
    for (const p of frontier) {
      const x = p % W, y = (p / W) | 0
      const nbr = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]
      for (const q of nbr) {
        if (q < 0 || trueBg[q]) continue
        if (G[q] <= CONTACT_GMAX && sat[q] <= CONTACT_SAT &&
            bgL - lum[q] >= SHADOW_LGAP && lum[q] >= CONTACT_LMIN) {
          trueBg[q] = 1; next.push(q)
        }
      }
    }
    if (!next.length) break
    frontier = next
  }

  // --- C. solid piece silhouette + hollow detection ----------------------
  const flatBg = new Uint8Array(n)   // background-coloured AND no relief
  for (let p = 0; p < n; p++) if (dist[p] <= HOLE_NEAR && sat[p] <= HOLE_SAT && G[p] <= G_FLAT) flatBg[p] = 1
  const solidFg = new Uint8Array(n)  // a piece pixel with real substance/relief
  for (let p = 0; p < n; p++) solidFg[p] = (!trueBg[p] && !flatBg[p]) ? 1 : 0
  const solidFilled = fillHoles(solidFg, W, H)

  const minArea = Math.max(200, Math.round(n * MIN_AREA_FRAC))
  const { labels, comps } = components(solidFilled, W, H, minArea)

  let idx = 0
  for (const c of comps.sort((a, b) => (a.bbox.miny - b.bbox.miny) || (a.bbox.minx - b.bbox.minx))) {
    if (Math.min(c.bbox.w, c.bbox.h) < MIN_SIDE) continue
    if (c.area / (c.bbox.w * c.bbox.h) < MIN_FILL) continue

    const minx = Math.max(0, c.bbox.minx - PAD)
    const miny = Math.max(0, c.bbox.miny - PAD)
    const maxx = Math.min(W - 1, c.bbox.maxx + PAD)
    const maxy = Math.min(H - 1, c.bbox.maxy + PAD)
    const w = maxx - minx + 1, h = maxy - miny + 1

    // local filled silhouette of THIS piece
    const solid = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (labels[(miny + y) * W + (minx + x)] === c.label) solid[y * w + x] = 1
    }

    // candidate holes = filled-in pixels (solid here, but not real substance)
    const holeCand = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const gx = minx + (i % w), gy = miny + ((i / w) | 0)
      if (solid[i] && !solidFg[gy * W + gx]) holeCand[i] = 1
    }
    // label hole candidates locally; carve only large, flat, bg-coloured ones
    const hLab = new Int32Array(w * h)
    const stack = new Int32Array(w * h)
    let cl = 0
    for (let s = 0; s < w * h; s++) {
      if (hLab[s] || !holeCand[s]) continue
      cl++
      let sp = 0; stack[sp++] = s; hLab[s] = cl
      const cells = []
      let sumDist = 0
      while (sp > 0) {
        const p = stack[--sp]; cells.push(p)
        const gx = minx + (p % w), gy = miny + ((p / w) | 0)
        sumDist += dist[gy * W + gx]
        const px = p % w, py = (p / w) | 0
        if (px > 0 && !hLab[p - 1] && holeCand[p - 1]) { hLab[p - 1] = cl; stack[sp++] = p - 1 }
        if (px < w - 1 && !hLab[p + 1] && holeCand[p + 1]) { hLab[p + 1] = cl; stack[sp++] = p + 1 }
        if (py > 0 && !hLab[p - w] && holeCand[p - w]) { hLab[p - w] = cl; stack[sp++] = p - w }
        if (py < h - 1 && !hLab[p + w] && holeCand[p + w]) { hLab[p + w] = cl; stack[sp++] = p + w }
      }
      const area = cells.length
      const meanDist = sumDist / area
      const carve = area >= Math.max(HOLE_MIN_PX, HOLE_MIN_FRAC * c.area) && meanDist <= HOLE_NEAR
      if (carve) for (const p of cells) solid[p] = 0 // open the hole → transparent
    }

    // --- D. soft, decontaminated alpha over every boundary ---------------
    const isBoundary = (x, y) => {
      for (let dy = -BAND_R; dy <= BAND_R; dy++) for (let dx = -BAND_R; dx <= BAND_R; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true
        if (!solid[ny * w + nx]) return true
      }
      return false
    }
    const out = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sp = (miny + y) * W + (minx + x)
      const so = sp * 4
      const dp = (y * w + x) * 4
      let r = data[so], g = data[so + 1], b = data[so + 2], a = 0
      if (solid[y * w + x]) {
        if (isBoundary(x, y)) {
          a = Math.max(0, Math.min(1, (dist[sp] - EDGE_T0) / (EDGE_T1 - EDGE_T0)))
          if (a > 0 && a < 1) {
            r = Math.max(0, Math.min(255, (r - (1 - a) * bg.r) / a))
            g = Math.max(0, Math.min(255, (g - (1 - a) * bg.g) / a))
            b = Math.max(0, Math.min(255, (b - (1 - a) * bg.b) / a))
          }
        } else {
          a = 1
        }
      }
      out[dp] = r; out[dp + 1] = g; out[dp + 2] = b; out[dp + 3] = Math.round(a * 255)
    }

    idx++
    const id = `${slug(base)}-${String(idx).padStart(2, '0')}`
    const outFile = join(OUT, `${id}.png`)
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outFile)
    manifest.push({ id, src: `${id}.png`, fromPhoto: file, pxW: w, pxH: h })
    total++
  }
  console.log(`${file}: ${idx} pieces`) // eslint-disable-line no-console
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: total, pieces: manifest }, null, 2) + '\n')
console.log(`\nWrote ${total} piece cut-outs + manifest.json to reference/3-charms-each-piece/`) // eslint-disable-line no-console
