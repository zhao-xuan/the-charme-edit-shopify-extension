/**
 * extract-reference-charms.mjs
 * -------------------------------------------------------------------------
 * Node/sharp port of src/lib/segment.js — runs the SAME boundary-detection +
 * cut-out the admin "Auto-extract" tab does, but over the real reference photos
 * (reference/charms-real-image) at full resolution, and writes each detected
 * charm as a permanent transparent PNG to reference/extracted-charms/ plus a
 * JSON manifest with each piece's real size (mm).
 *
 * This regenerates — as durable files — the charms previously cut in the
 * browser, so they live in the repo and can't be lost to a cache clear.
 *
 * Run:  node scripts/extract-reference-charms.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'reference', 'charms-real-image')
const OUT = join(ROOT, 'reference', 'extracted-charms')

// The reference photos are gold charms laid on a white iPhone 16 Pro Max case.
// Case outer ≈ 81.6 × 167.0 mm (used as the px→mm ruler).
const PRODUCT_LONG_MM = 167.0
const WORK_LONG = 1600 // downscale long side for processing (matches admin maxDim)
const PIECE_TOL = 58
const MIN_PIECE_MM = 5
const MAX_PIECE_MM = 55

const sq = (n) => n * n
const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

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

function otsu(hist, total) {
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = 0, bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * sq(mB - mF)
    if (between > best) { best = between; bestT = t }
  }
  return bestT
}

function fillHoles(mask, W, H) {
  const n = W * H
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const seed = (p) => { if (!outside[p] && !mask[p]) { outside[p] = 1; stack[sp++] = p } }
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
  const out = new Uint8Array(n)
  for (let p = 0; p < n; p++) out[p] = mask[p] || !outside[p] ? 1 : 0
  return out
}

function detectProduct(data, W, H) {
  const n = W * H
  const hist = new Uint32Array(256)
  for (let p = 0; p < n; p++) hist[lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) | 0]++
  const thr = otsu(hist, n)
  const bright = new Uint8Array(n)
  const dark = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) > thr) bright[p] = 1
    else dark[p] = 1
  }
  const spansFrame = (b) => b.minx <= 1 && b.maxx >= W - 2 && b.miny <= 1 && b.maxy >= H - 2
  const minArea = n * 0.02
  let best = null
  for (const mask of [bright, dark]) {
    const { labels, comps } = components(mask, W, H, minArea)
    for (const c of comps) {
      if (spansFrame(c.bbox)) continue
      if (!best || c.area > best.comp.area) best = { comp: c, labels }
    }
  }
  if (!best) return null
  const compMask = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (best.labels[p] === best.comp.label) compMask[p] = 1
  return { mask: fillHoles(compMask, W, H), bbox: best.comp.bbox }
}

function dominantColor(data, W, onProduct, box) {
  const BIN = 24
  const bins = new Map()
  for (let y = box.miny; y <= box.maxy; y++) for (let x = box.minx; x <= box.maxx; x++) {
    const p = y * W + x
    if (!onProduct(p)) continue
    const o = p * 4
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (sat > 0.5) continue
    const key = ((r / BIN) | 0) * 10000 + ((g / BIN) | 0) * 100 + ((b / BIN) | 0)
    const e = bins.get(key)
    if (e) { e.r += r; e.g += g; e.b += b; e.n++ } else bins.set(key, { r, g, b, n: 1 })
  }
  let best = null
  for (const e of bins.values()) if (!best || e.n > best.n) best = e
  if (!best) return { r: 240, g: 240, b: 240 }
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
}

function dilate(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (m[p]) { out[p] = 1; continue }
      if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) || (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) out[p] = 1
    }
    m = out
  }
  return m
}

function componentStats(data, W, labels, comp) {
  const { minx, miny, maxx, maxy } = comp.bbox
  let r = 0, g = 0, b = 0, sl = 0, sl2 = 0, n = 0
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const p = y * W + x
    if (labels[p] !== comp.label) continue
    const o = p * 4
    r += data[o]; g += data[o + 1]; b += data[o + 2]
    const l = lumOf(data[o], data[o + 1], data[o + 2])
    sl += l; sl2 += l * l; n++
  }
  if (!n) return { r: 0, g: 0, b: 0, lumStd: 0 }
  const ml = sl / n
  return { r: r / n, g: g / n, b: b / n, lumStd: Math.sqrt(Math.max(0, sl2 / n - ml * ml)) }
}

async function cutComponent(data, W, H, labels, comp, file) {
  const { minx, miny, w, h } = comp.bbox
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sp = (miny + y) * W + (minx + x)
    const dp = (y * w + x) * 4
    if (labels[sp] === comp.label) {
      const so = sp * 4
      out[dp] = data[so]; out[dp + 1] = data[so + 1]; out[dp + 2] = data[so + 2]; out[dp + 3] = 255
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file)
}

function tierFromMm(longMm) {
  if (longMm >= 23) return { tier: 'grande', type: 1, price: 3 }
  if (longMm <= 11.5) return { tier: 'mini', type: 3, price: 2 }
  return { tier: 'midi', type: 2, price: 2 }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const files = (await readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f)).sort()
const manifest = []
let total = 0

for (const file of files) {
  const base = file.replace(/\.jpe?g$/i, '')
  const img = sharp(join(SRC, file)).rotate()
  const meta = await img.metadata()
  const scale = WORK_LONG / Math.max(meta.width, meta.height)
  const W = Math.round(meta.width * scale)
  const H = Math.round(meta.height * scale)
  const { data } = await img.resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const prod = detectProduct(data, W, H)
  const box = prod ? prod.bbox : { minx: 0, miny: 0, maxx: W - 1, maxy: H - 1, w: W, h: H }
  const onProduct = prod ? (p) => prod.mask[p] === 1 : () => true
  const mmPerPx = PRODUCT_LONG_MM / Math.max(box.w, box.h)

  const body = dominantColor(data, W, onProduct, box)
  const tol2 = PIECE_TOL * PIECE_TOL
  const raw = new Uint8Array(W * H)
  for (let y = box.miny; y <= box.maxy; y++) for (let x = box.minx; x <= box.maxx; x++) {
    const p = y * W + x
    if (!onProduct(p)) continue
    const o = p * 4
    if (sq(data[o] - body.r) + sq(data[o + 1] - body.g) + sq(data[o + 2] - body.b) <= tol2) continue
    raw[p] = 1
  }
  const grouped = dilate(raw, W, H, 2)
  const minArea = Math.max(8, Math.round(sq(MIN_PIECE_MM / mmPerPx) * 0.55))
  const { labels, comps } = components(grouped, W, H, minArea)

  let idx = 0
  for (const c of comps.sort((a, b) => b.area - a.area)) {
    const wMm = +(c.bbox.w * mmPerPx).toFixed(1)
    const hMm = +(c.bbox.h * mmPerPx).toFixed(1)
    const longMm = Math.max(wMm, hMm)
    if (longMm < MIN_PIECE_MM || longMm > MAX_PIECE_MM) continue
    const st = componentStats(data, W, labels, c)
    const lum = (st.r + st.g + st.b) / 3
    const mx = Math.max(st.r, st.g, st.b), mn = Math.min(st.r, st.g, st.b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (lum < 70 && sat < 0.18) continue
    if (longMm > 13 && st.lumStd < 14 && sat < 0.22) continue
    // reject thin slivers / edge lines: a real charm fills a fair share of its
    // bounding box, a stray diagonal line barely fills it.
    const fillRatio = c.area / (c.bbox.w * c.bbox.h)
    if (fillRatio < 0.16) continue
    idx++
    const id = `${slug(base)}-${idx}`
    const outFile = join(OUT, `${id}.png`)
    await cutComponent(data, W, H, labels, c, outFile)
    manifest.push({ id, src: `${id}.png`, fromPhoto: file, widthMm: wMm, heightMm: hMm, ...tierFromMm(longMm), pxW: c.bbox.w, pxH: c.bbox.h })
    total++
  }
  console.log(`${file}: ${idx} charms (ruler ${mmPerPx.toFixed(4)} mm/px)`) // eslint-disable-line
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), productLongMm: PRODUCT_LONG_MM, count: total, charms: manifest }, null, 2) + '\n')
console.log(`\nWrote ${total} charm cut-outs + manifest.json to reference/extracted-charms/`) // eslint-disable-line
