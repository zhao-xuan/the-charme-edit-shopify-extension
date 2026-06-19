/**
 * verify-charm-scale.mjs (analysis only)
 * -------------------------------------------------------------------------
 * All 5 reference photos are the SAME iPhone 16 Pro Max case at the same
 * framing, so the case should occupy the SAME pixel size in every photo and the
 * px->mm ruler should be identical. This re-detects the case in each photo (the
 * big bright rounded rectangle), reports its pixel size + implied mm/px, and
 * flags any photo whose ruler disagrees with the consensus — those photos'
 * charms are mis-sized.
 *
 * Run:  node scripts/verify-charm-scale.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIR = join(__dirname, '..', 'reference', 'charms-real-image')
const CASE_LONG_MM = 167.0 // iPhone 16 Pro Max case outer height
const WORK_LONG = 1600

const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

function otsu(hist, total) {
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = 0, bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue
    const wF = total - wB; if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; bestT = t }
  }
  return bestT
}

function components(mask, W, H, minArea) {
  const n = W * H, lab = new Int32Array(n), st = new Int32Array(n), comps = []
  let cur = 0
  for (let s = 0; s < n; s++) {
    if (lab[s] || !mask[s]) continue
    cur++; let sp = 0; st[sp++] = s; lab[s] = cur
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp > 0) {
      const p = st[--sp]; area++
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!lab[q] && mask[q]) { lab[q] = cur; st[sp++] = q }
      }
    }
    if (area >= minArea) comps.push({ minx, miny, maxx, maxy, area, w: maxx - minx + 1, h: maxy - miny + 1 })
  }
  return comps
}

async function caseBox(file) {
  const img = sharp(join(DIR, file)).rotate()
  const meta = await img.metadata()
  const scale = WORK_LONG / Math.max(meta.width, meta.height)
  const W = Math.round(meta.width * scale), H = Math.round(meta.height * scale)
  const { data } = await img.resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = W * H, hist = new Uint32Array(256)
  for (let p = 0; p < n; p++) hist[lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) | 0]++
  const thr = otsu(hist, n)
  const bright = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) > thr) bright[p] = 1
  const spans = (b) => b.minx <= 1 && b.maxx >= W - 2 && b.miny <= 1 && b.maxy >= H - 2
  // case = largest tonal island (bright OR dark) that doesn't span the frame
  const dark = new Uint8Array(n)
  for (let p = 0; p < n; p++) dark[p] = bright[p] ? 0 : 1
  const all = [...components(bright, W, H, n * 0.02), ...components(dark, W, H, n * 0.02)]
    .filter((c) => !spans(c)).sort((a, b) => b.area - a.area)
  const c = all[0]
  if (!c) return { W, H, caseW: 0, caseH: 0, longPx: 0, mmPerPx: 0 }
  return { W, H, caseW: c.w, caseH: c.h, longPx: Math.max(c.w, c.h), mmPerPx: CASE_LONG_MM / Math.max(c.w, c.h) }
}

const files = (await readdir(DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort()
const rows = []
for (const f of files) {
  const r = await caseBox(f)
  rows.push({ f, ...r })
  console.log(`${f}: work ${r.W}x${r.H}  casePx ${r.caseW}x${r.caseH}  longPx ${r.longPx}  mm/px ${r.mmPerPx.toFixed(4)}`) // eslint-disable-line
}
const med = rows.map((r) => r.longPx).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
console.log(`\nconsensus case longPx (median): ${med}  → mm/px ${(CASE_LONG_MM / med).toFixed(4)}`) // eslint-disable-line
for (const r of rows) {
  const dev = (r.longPx / med - 1) * 100
  if (Math.abs(dev) > 6) console.log(`  ⚠️ ${r.f} deviates ${dev.toFixed(0)}% — its charms are mis-scaled by ~${(med / r.longPx).toFixed(2)}x`) // eslint-disable-line
}
