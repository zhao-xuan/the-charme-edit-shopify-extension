/**
 * detect-case-rect.mjs — robust phone-case rectangle per reference photo.
 *
 * The case is found from per-column / per-row PROFILES (median over the middle
 * band of the other axis), which smooth out charm noise. A line (column or row)
 * belongs to the case when it is clearly WARMER than the desk (white/cream case:
 * r-b rises) OR clearly DARKER than the desk (black case: luminance drops). The
 * case span on each axis is the outermost run of case-lines. Desk reference is
 * sampled from the extreme 4% on both ends of each axis.
 *
 * Hand overrides for photos the profiles cannot separate (e.g. a neutral-white
 * tray on a neutral-white desk) live in reference/case-rects.overrides.json as
 * { "<photoBase>": { "minx":..,"miny":..,"maxx":..,"maxy":.. } } in DET_H space.
 *
 * Exports detectCaseRect(realPath, base?).
 */
import sharp from 'sharp'
import { readFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const DET_H = 1800
const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }
const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] }

let overrides = null
async function loadOverrides() {
  if (overrides) return overrides
  const f = join(REF, 'case-rects.overrides.json')
  overrides = (await exists(f)) ? JSON.parse(await readFile(f, 'utf8')) : {}
  return overrides
}

// outermost run of true values in `isCase`, tolerating small gaps
function span(isCase, minRun) {
  const n = isCase.length
  let lo = -1, hi = -1
  for (let i = 0; i < n; i++) {
    if (isCase[i]) {
      // confirm a run of minRun within a small window
      let cnt = 0
      for (let k = 0; k < minRun * 2 && i + k < n; k++) if (isCase[i + k]) cnt++
      if (cnt >= minRun) { lo = i; break }
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    if (isCase[i]) {
      let cnt = 0
      for (let k = 0; k < minRun * 2 && i - k >= 0; k++) if (isCase[i - k]) cnt++
      if (cnt >= minRun) { hi = i; break }
    }
  }
  return [lo, hi]
}

export async function detectCaseRect(realPath, base) {
  const ov = await loadOverrides()
  const { data, info } = await sharp(realPath).rotate().resize({ height: DET_H })
    .raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  if (base && ov[base]) return { W, H, box: ov[base], source: 'override' }

  const warmthAt = (o) => data[o] - data[o + 2]
  const lumAt = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]

  // ---- column profiles (over middle band of rows) ----
  const cy0 = (H * 0.30) | 0, cy1 = (H * 0.70) | 0
  const colW = new Array(W), colL = new Array(W)
  for (let x = 0; x < W; x++) {
    const wa = [], la = []
    for (let y = cy0; y < cy1; y += 3) { const o = (y * W + x) * C; wa.push(warmthAt(o)); la.push(lumAt(o)) }
    colW[x] = med(wa); colL[x] = med(la)
  }
  // ---- row profiles (over middle band of cols) ----
  const cx0 = (W * 0.30) | 0, cx1 = (W * 0.70) | 0
  const rowW = new Array(H), rowL = new Array(H)
  for (let y = 0; y < H; y++) {
    const wa = [], la = []
    for (let x = cx0; x < cx1; x += 3) { const o = (y * W + x) * C; wa.push(warmthAt(o)); la.push(lumAt(o)) }
    rowW[y] = med(wa); rowL[y] = med(la)
  }

  const edge = (arr, frac) => {
    const k = Math.max(2, (arr.length * frac) | 0)
    return med([...arr.slice(0, k), ...arr.slice(arr.length - k)])
  }
  const deskCW = edge(colW, 0.04), deskCL = edge(colL, 0.04)
  const deskRW = edge(rowW, 0.04), deskRL = edge(rowL, 0.04)
  const WM = 7, LM = 48 // margins: warmer-than-desk / darker-than-desk

  const colCase = colW.map((w, i) => (w - deskCW > WM) || (deskCL - colL[i] > LM))
  const rowCase = rowW.map((w, i) => (w - deskRW > WM) || (deskRL - rowL[i] > LM))
  const [minx, maxx] = span(colCase, Math.max(6, (W * 0.02) | 0))
  const [miny, maxy] = span(rowCase, Math.max(6, (H * 0.02) | 0))

  let box = null
  if (minx >= 0 && maxx > minx && miny >= 0 && maxy > miny) {
    const w = maxx - minx, h = maxy - miny
    // sanity: plausible phone-case footprint
    if (w > W * 0.3 && w < W * 0.95 && h > H * 0.4) box = { minx, miny, maxx, maxy }
  }
  // median luminance inside the box (identifies a dark/black case, where the
  // profile detection is strong and trustworthy regardless of width)
  let boxLum = null
  if (box) {
    const la = []
    for (let y = box.miny; y < box.maxy; y += 6) for (let x = box.minx; x < box.maxx; x += 6) la.push(lumAt((y * W + x) * C))
    boxLum = med(la)
  }
  return {
    W,
    H,
    box,
    boxLum,
    source: 'profile',
  }
}
