/**
 * track-and-measure-pieces.mjs
 * -------------------------------------------------------------------------
 * Tracks every charm/piece that sits on the iPhone 16 Pro Max case in the real
 * product photos (reference/1-charms-real-image) and produces two deliverables:
 *
 *   5-pieces-bordered/      one annotated copy of each real photo with every
 *                           detected piece outlined in RED and tagged with its
 *                           global id (P001, P002 …). Duplicate pieces that were
 *                           already tagged in an earlier photo are skipped.
 *
 *   6-bounding-box-with-size/   one crop per unique piece showing its bounding
 *                           box and the real-world size (mm), computed by using
 *                           the detected case as a ruler.
 *
 * The case acts as the ruler: an iPhone 16 Pro Max silicone case OUTER is
 * ~81.6 x 167.0 mm, so once the case bounding box is found we know mm-per-pixel
 * and can convert any piece's pixel box to millimetres.
 *
 * A sidecar manifest (reference/pieces-tracking.json) records, per piece: id,
 * source photo, pixel box, % of case, real width/height/long-side in mm, tier,
 * the best-matching 3-charms-each-piece cut-out (best-effort link), and — for
 * skipped repeats — which earlier id it duplicates.
 *
 * Run:  node scripts/track-and-measure-pieces.mjs
 *       node scripts/track-and-measure-pieces.mjs --debug   (also dumps overlays)
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'reference', '1-charms-real-image')
const PIECES = join(ROOT, 'reference', '3-charms-each-piece')
const OUT_BORDER = join(ROOT, 'reference', '5-pieces-bordered')
const OUT_SIZE = join(ROOT, 'reference', '6-bounding-box-with-size')
const MANIFEST = join(ROOT, 'reference', 'pieces-tracking.json')
const DEBUG_DIR = '/tmp/track-debug'
const DEBUG = process.argv.includes('--debug')

// iPhone 16 Pro Max: bare 77.6 x 163.0 mm. A silicone case adds ~2mm wall per
// side, so the case OUTER (what the photo shows) ≈ 81.6 x 167.0 mm.
const CASE_W_MM = 81.6
const CASE_H_MM = 167.0
const CASE_ASPECT = CASE_H_MM / CASE_W_MM // ≈ 2.047

const TARGET_H = 1800 // working resolution (photos are 6240 tall)

// ---- small helpers ------------------------------------------------------
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const v = mx / 255
  const s = mx === 0 ? 0 : (mx - mn) / mx
  return { s, v, warm: r - b }
}
const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

function median(arr) { if (!arr.length) return 0; arr.sort((a, b) => a - b); return arr[arr.length >> 1] }

function dilate(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (m[p]) { out[p] = 1; continue }
      if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) ||
          (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) out[p] = 1
    }
    m = out
  }
  return m
}
function erode(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!m[p]) continue
      if (x > 0 && !m[p - 1]) continue
      if (x < W - 1 && !m[p + 1]) continue
      if (y > 0 && !m[p - W]) continue
      if (y < H - 1 && !m[p + W]) continue
      out[p] = 1
    }
    m = out
  }
  return m
}

// 8-connected components; returns {labels, comps:[{label,minx..,area}]}
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
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!labels[q] && mask[q]) { labels[q] = cur; stack[sp++] = q }
      }
    }
    comps.push({ label: cur, minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1, area })
  }
  return { labels, comps: comps.filter((c) => c.area >= minArea) }
}

// flood the background inward from the 4 borders through `passable` pixels
function floodFromBorder(passable, W, H) {
  const n = W * H
  const out = new Uint8Array(n)
  const st = new Int32Array(n)
  let sp = 0
  for (let x = 0; x < W; x++) {
    for (const p of [x, (H - 1) * W + x]) if (passable[p] && !out[p]) { out[p] = 1; st[sp++] = p }
  }
  for (let y = 0; y < H; y++) {
    for (const p of [y * W, y * W + W - 1]) if (passable[p] && !out[p]) { out[p] = 1; st[sp++] = p }
  }
  while (sp > 0) {
    const p = st[--sp], x = p % W, y = (p / W) | 0
    if (x > 0 && passable[p - 1] && !out[p - 1]) { out[p - 1] = 1; st[sp++] = p - 1 }
    if (x < W - 1 && passable[p + 1] && !out[p + 1]) { out[p + 1] = 1; st[sp++] = p + 1 }
    if (y > 0 && passable[p - W] && !out[p - W]) { out[p - W] = 1; st[sp++] = p - W }
    if (y < H - 1 && passable[p + W] && !out[p + W]) { out[p + W] = 1; st[sp++] = p + W }
  }
  return out
}

function fillHoles(mask, W, H) {
  const outside = floodFromBorder(Uint8Array.from(mask, (v) => (v ? 0 : 1)), W, H)
  const filled = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) filled[p] = (mask[p] || !outside[p]) ? 1 : 0
  return filled
}

// ---- case detection -----------------------------------------------------
// The white case nearly fills the frame; the desk is a slightly BRIGHTER frame
// around it (desk ≈ case + ~5 lum) and charms are much darker. So the case
// boundary is a small, consistent step-DOWN from the desk level. We find the
// left/right case sides by walking inward on every middle row until the desk
// level first drops, and take the median — robust to the faint white-on-white
// edge and to charms (which lie inside, past the case edge). The case WIDTH is
// the ruler (81.6 mm); top/bottom are found the same way but may be cropped.
function detectCase(data, W, H) {
  const at = (p) => p * 4
  const n = W * H
  const lum = new Float32Array(n)
  for (let p = 0; p < n; p++) { const o = at(p); lum[p] = lumOf(data[o], data[o + 1], data[o + 2]) }
  const L = (x, y) => lum[y * W + x]

  // desk colour (corners) for later camera-cut-out rejection
  const dr = [], dg = [], db = []
  for (let x = 0; x < W; x += 2) for (const y of [1, 2, H - 3, H - 2]) { const o = at(y * W + x); dr.push(data[o]); dg.push(data[o + 1]); db.push(data[o + 2]) }
  for (let y = 0; y < H; y += 2) for (const x of [1, 2, W - 3, W - 2]) { const o = at(y * W + x); dr.push(data[o]); dg.push(data[o + 1]); db.push(data[o + 2]) }
  const deskCol = { r: median(dr.slice()), g: median(dg.slice()), b: median(db.slice()) }
  const deskLum = lumOf(deskCol.r, deskCol.g, deskCol.b)

  // a white-desk studio shot is bright; carbon-fibre / fabric (no case) is dark
  if (deskLum < 120) return { plausible: false, deskCol, reason: `desk too dark (${deskLum | 0})` }

  const DROP = 4, CONFIRM = 4
  const med = (a) => { if (!a.length) return -1; a.sort((x, y) => x - y); return a[a.length >> 1] }
  const lvl = (vals) => median(vals.slice())

  // left & right sides over the middle band of rows
  const lefts = [], rights = []
  for (let y = Math.round(H * 0.22); y < Math.round(H * 0.78); y += 2) {
    const dL = lvl([L(1, y), L(3, y), L(5, y), L(7, y)])
    let lx = -1
    for (let x = 8; x < W * 0.5; x++) {
      if (L(x, y) < dL - DROP) { let ok = true; for (let k = 1; k <= CONFIRM; k++) if (L(x + k, y) >= dL - DROP) { ok = false; break } if (ok) { lx = x; break } }
    }
    if (lx > 0) lefts.push(lx)
    const dR = lvl([L(W - 2, y), L(W - 4, y), L(W - 6, y), L(W - 8, y)])
    let rx = -1
    for (let x = W - 9; x > W * 0.5; x--) {
      if (L(x, y) < dR - DROP) { let ok = true; for (let k = 1; k <= CONFIRM; k++) if (L(x - k, y) >= dR - DROP) { ok = false; break } if (ok) { rx = x; break } }
    }
    if (rx > 0) rights.push(rx)
  }
  if (lefts.length < 10 || rights.length < 10) return { plausible: false, deskCol, reason: 'too few side transitions' }
  // robust median + spread check (texture/no-case ⇒ scattered)
  const stdev = (a, m) => Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length)
  const minx = med(lefts.slice()), maxx = med(rights.slice())
  const lstd = stdev(lefts, minx), rstd = stdev(rights, maxx)
  const w = maxx - minx + 1
  if (w < W * 0.3 || w > W * 0.95) return { plausible: false, deskCol, reason: `width ${(w / W * 100) | 0}% implausible` }
  if (lstd > w * 0.18 || rstd > w * 0.18) return { plausible: false, deskCol, reason: `sides scattered (lstd=${lstd | 0} rstd=${rstd | 0})` }

  // top & bottom over the middle band of columns (may be cropped → fallback)
  const tops = [], bots = []
  for (let x = Math.round(W * 0.3); x < Math.round(W * 0.7); x += 2) {
    const dT = lvl([L(x, 1), L(x, 3), L(x, 5), L(x, 7)])
    let ty = -1
    for (let y = 8; y < H * 0.4; y++) { if (L(x, y) < dT - DROP) { let ok = true; for (let k = 1; k <= CONFIRM; k++) if (L(x, y + k) >= dT - DROP) { ok = false; break } if (ok) { ty = y; break } } }
    if (ty > 0) tops.push(ty)
    const dB = lvl([L(x, H - 2), L(x, H - 4), L(x, H - 6), L(x, H - 8)])
    let by = -1
    for (let y = H - 9; y > H * 0.6; y--) { if (L(x, y) < dB - DROP) { let ok = true; for (let k = 1; k <= CONFIRM; k++) if (L(x, y - k) >= dB - DROP) { ok = false; break } if (ok) { by = y; break } } }
    if (by > 0) bots.push(by)
  }
  const topFramed = tops.length > (W * 0.4 / 2) * 0.5
  const botFramed = bots.length > (W * 0.4 / 2) * 0.5
  const miny = topFramed ? med(tops.slice()) : 0
  const maxy = botFramed ? med(bots.slice()) : H - 1
  const box = { minx, miny, maxx, maxy, w, h: maxy - miny + 1 }
  return { plausible: true, box, deskCol, topFramed, botFramed, lstd, rstd }
}

// ---- piece segmentation on the case ------------------------------------
function detectPieces(data, W, H, cbox, deskCol) {
  const at = (p) => p * 4
  const insX = Math.round(cbox.w * 0.045), insY = Math.round(cbox.h * 0.025)
  const x0 = Math.max(1, cbox.minx + insX), x1 = Math.min(W - 2, cbox.maxx - insX)
  const y0 = Math.max(1, cbox.miny + insY), y1 = Math.min(H - 2, cbox.maxy - insY)

  // case material colour = median of bright, near-neutral pixels inside the box
  const rs = [], gs = [], bs = []
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const o = at(y * W + x)
    const { s, v } = hsv(data[o], data[o + 1], data[o + 2])
    if (v > 0.5 && s < 0.16) { rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]) }
  }
  const caseCol = { r: median(rs) || 220, g: median(gs) || 215, b: median(bs) || 210 }
  const caseL = lumOf(caseCol.r, caseCol.g, caseCol.b)

  // per-pixel luminance + Sobel relief
  const n = W * H
  const lum = new Float32Array(n)
  for (let p = 0; p < n; p++) { const o = at(p); lum[p] = lumOf(data[o], data[o + 1], data[o + 2]) }
  const G = new Float32Array(n)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = y * W + x
    const gx = -lum[p - W - 1] - 2 * lum[p - 1] - lum[p + W - 1] + lum[p - W + 1] + 2 * lum[p + 1] + lum[p + W + 1]
    const gy = -lum[p - W - 1] - 2 * lum[p - W] - lum[p - W + 1] + lum[p + W - 1] + 2 * lum[p + W] + lum[p + W + 1]
    G[p] = Math.hypot(gx, gy) / 4
  }

  const COL_T = 24        // colour distance from case material
  const SAT_T = 0.18      // colourful piece
  const DARK_T = caseL - 44 // clearly darker than case (metal / dark stone)
  const BRIGHT_T = caseL + 30 // strong specular highlight on a glossy/clear piece
  const EDGE_T = 14       // relief: boundary of a pale piece
  const DESK_NEAR = 26

  const raw = new Uint8Array(n)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = y * W + x, o = at(p)
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const { s } = hsv(r, g, b)
    const L = lum[p]
    const colD = Math.hypot(r - caseCol.r, g - caseCol.g, b - caseCol.b)
    const deskD = Math.hypot(r - deskCol.r, g - deskCol.g, b - deskCol.b)
    if (deskD < DESK_NEAR && s < 0.14 && G[p] < 8) continue // gap to desk
    // contact / cast shadow: near-neutral, darker than case, smooth → ignore
    if (s < 0.18 && L < caseL && L > caseL - 52 && colD < 40 && G[p] < 13) continue
    if (colD > COL_T || s > SAT_T || L < DARK_T || L > BRIGHT_T || G[p] > EDGE_T) raw[p] = 1
  }

  const caseArea = cbox.w * cbox.h

  // close speckle within a charm
  let mc = erode(dilate(raw, W, H, 1), W, H, 1)      // closing(1)

  // OPEN to cut thin shadow/relief bridges between neighbouring charms
  let m = dilate(erode(mc, W, H, 3), W, H, 3)        // opening(3)

  const minAreaPx = Math.round((cbox.w * 0.02) * (cbox.w * 0.02))
  const { labels, comps } = components(m, W, H, Math.max(80, minAreaPx))

  // per-component filled coverage (so hollow charms keep their bbox)
  const filledArea = new Map()
  for (const c of comps) {
    const bw = c.w, bh = c.h
    const sub = new Uint8Array(bw * bh)
    for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) if (labels[y * W + x] === c.label) sub[(y - c.miny) * bw + (x - c.minx)] = 1
    const f = fillHoles(sub, bw, bh)
    let a = 0; for (let i = 0; i < f.length; i++) a += f[i]
    filledArea.set(c.label, a)
  }

  // smooth, case-coloured interior over a component's central region (used to
  // tell the camera cut-out — a case-coloured frame/arc — from a real charm).
  const interiorIsCase = (c) => {
    const ax0 = c.minx + (c.w >> 2), ax1 = c.maxx - (c.w >> 2), ay0 = c.miny + (c.h >> 2), ay1 = c.maxy - (c.h >> 2)
    let sr = 0, sg = 0, sb = 0, k = 0
    for (let y = ay0; y <= ay1; y += 2) for (let x = ax0; x <= ax1; x += 2) { const o = at(y * W + x); sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; k++ }
    if (!k) return false
    sr /= k; sg /= k; sb /= k
    let dev = 0
    for (let y = ay0; y <= ay1; y += 2) for (let x = ax0; x <= ax1; x += 2) { const o = at(y * W + x); dev += Math.abs(data[o] - sr) + Math.abs(data[o + 1] - sg) + Math.abs(data[o + 2] - sb) }
    dev /= (k * 3)
    return dev < 24 && Math.hypot(sr - caseCol.r, sg - caseCol.g, sb - caseCol.b) < 46
  }

  const pieces = comps.filter((c) => {
    const fill = (filledArea.get(c.label) || c.area) / (c.w * c.h)
    const areaFrac = (c.w * c.h) / caseArea
    const squ = c.w / c.h
    const aspect = Math.max(c.w, c.h) / Math.min(c.w, c.h)
    const inTop = (c.miny - cbox.miny) < cbox.h * 0.5
    const nearL = c.minx < cbox.minx + cbox.w * 0.07
    const nearR = c.maxx > cbox.maxx - cbox.w * 0.07
    const nearT = c.miny < cbox.miny + cbox.h * 0.04
    const nearB = c.maxy > cbox.maxy - cbox.h * 0.04
    if ((nearL || nearR || nearT || nearB) && aspect > 3.2) return false // case lip/edge
    if (aspect > 7) return false       // stray edge streak
    // camera cut-out: large, upper, ~square frame whose interior is bare case
    if (areaFrac > 0.05 && squ > 0.55 && squ < 1.9 && inTop && fill < 0.52 && interiorIsCase(c)) return false
    if (areaFrac > 0.34) return false
    if (fill < 0.3) return false
    if (Math.min(c.w, c.h) < 9) return false
    return true
  })
  return { pieces, caseCol, mask: m, labels }
}

// ---- piece signature (foreground colour layout) for dedup + catalog link ---
const SIG_G = 8 // 8x8 colour grid
function pieceSig(data, W, labels, c) {
  const sum = new Float64Array(SIG_G * SIG_G * 3), cnt = new Float64Array(SIG_G * SIG_G)
  for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) {
    if (labels[y * W + x] !== c.label) continue
    const gx = Math.min(SIG_G - 1, ((x - c.minx) * SIG_G / c.w) | 0)
    const gy = Math.min(SIG_G - 1, ((y - c.miny) * SIG_G / c.h) | 0)
    const i = gy * SIG_G + gx, o = (y * W + x) * 4
    sum[i * 3] += data[o]; sum[i * 3 + 1] += data[o + 1]; sum[i * 3 + 2] += data[o + 2]; cnt[i]++
  }
  const sig = new Float32Array(SIG_G * SIG_G * 3)
  for (let i = 0; i < SIG_G * SIG_G; i++) {
    if (cnt[i]) { sig[i * 3] = sum[i * 3] / cnt[i]; sig[i * 3 + 1] = sum[i * 3 + 1] / cnt[i]; sig[i * 3 + 2] = sum[i * 3 + 2] / cnt[i] }
    else { sig[i * 3] = sig[i * 3 + 1] = sig[i * 3 + 2] = -1 }
  }
  return sig
}
function sigDist(a, b) {
  let s = 0, n = 0
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] < 0 || b[i] < 0) continue
    s += (a[i] - b[i]) ** 2 + (a[i + 1] - b[i + 1]) ** 2 + (a[i + 2] - b[i + 2]) ** 2; n++
  }
  return n ? Math.sqrt(s / n) : 1e9
}
async function catalogSig(path) {
  const { data, info } = await sharp(path).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  const sum = new Float64Array(SIG_G * SIG_G * 3), cnt = new Float64Array(SIG_G * SIG_G)
  let minx = w, miny = h, maxx = 0, maxy = 0, any = false
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (data[(y * w + x) * 4 + 3] > 128) { any = true; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y } }
  if (!any) return null
  const bw = maxx - minx + 1, bh = maxy - miny + 1
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const o = (y * w + x) * 4
    if (data[o + 3] <= 128) continue
    const gx = Math.min(SIG_G - 1, ((x - minx) * SIG_G / bw) | 0)
    const gy = Math.min(SIG_G - 1, ((y - miny) * SIG_G / bh) | 0)
    const i = gy * SIG_G + gx
    sum[i * 3] += data[o]; sum[i * 3 + 1] += data[o + 1]; sum[i * 3 + 2] += data[o + 2]; cnt[i]++
  }
  const sig = new Float32Array(SIG_G * SIG_G * 3)
  for (let i = 0; i < SIG_G * SIG_G; i++) {
    if (cnt[i]) { sig[i * 3] = sum[i * 3] / cnt[i]; sig[i * 3 + 1] = sum[i * 3 + 1] / cnt[i]; sig[i * 3 + 2] = sum[i * 3 + 2] / cnt[i] }
    else { sig[i * 3] = sig[i * 3 + 1] = sig[i * 3 + 2] = -1 }
  }
  return { sig, aspect: bw / bh }
}
const tierOf = (mmLong) => mmLong < 12 ? 'XS' : mmLong < 20 ? 'S' : mmLong < 30 ? 'M' : mmLong < 42 ? 'L' : 'XL'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---- main ---------------------------------------------------------------
const files = (await readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f)).sort()
if (DEBUG) await mkdir(DEBUG_DIR, { recursive: true })
for (const d of [OUT_BORDER, OUT_SIZE]) { await rm(d, { recursive: true, force: true }); await mkdir(d, { recursive: true }) }

// catalogue signatures (best-effort link target) ----------------------------
let catalog = []
try {
  const cfiles = (await readdir(PIECES)).filter((f) => /\.png$/i.test(f)).sort()
  for (const cf of cfiles) { const s = await catalogSig(join(PIECES, cf)); if (s) catalog.push({ file: cf, ...s }) }
  console.log(`catalogue: ${catalog.length} cut-outs loaded for linking`)
} catch { console.log('catalogue: 3-charms-each-piece not found — skipping link') }

const DUP_T = 22 // signature distance under which two pieces count as the same
const kept = []  // { id, sig, aspect, mmLong } across all photos for dedup
const manifestPieces = []
const manifestSkipped = []
const manifestPhotos = []
let idN = 0

for (const file of files) {
  const img = sharp(join(SRC, file)).rotate()
  const meta = await img.metadata()
  const scale = TARGET_H / meta.height
  const W = Math.round(meta.width * scale)
  const H = TARGET_H
  const { data } = await img.resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const cas = detectCase(data, W, H)
  if (!cas || !cas.plausible) {
    console.log(`${file}: no plausible case (${cas ? cas.reason : 'n/a'}) — skipped`)
    manifestPhotos.push({ photo: file, cased: false, reason: cas ? cas.reason : 'n/a' })
    continue
  }

  const det = detectPieces(data, W, H, cas.box, cas.deskCol)
  const labels = det.labels
  const mmPerPx = CASE_W_MM / cas.box.w
  const rowT = cas.box.h * 0.04
  const pieces = det.pieces.slice().sort((a, b) => (Math.round(a.miny / rowT) - Math.round(b.miny / rowT)) || (a.minx - b.minx))

  const drawn = [] // { id, box, mmW, mmH }
  for (const c of pieces) {
    const sig = pieceSig(data, W, labels, c)
    const aspect = c.w / c.h
    const mmW = +(c.w * mmPerPx).toFixed(1)
    const mmH = +(c.h * mmPerPx).toFixed(1)
    const mmLong = Math.max(mmW, mmH)

    // dedup against everything tagged so far
    let dup = null
    for (const k of kept) {
      if (sigDist(k.sig, sig) > DUP_T) continue
      const ar = aspect / k.aspect
      if (ar < 0.75 || ar > 1.33) continue
      const sr = mmLong / k.mmLong
      if (sr < 0.78 || sr > 1.28) continue
      dup = k; break
    }
    if (dup) { manifestSkipped.push({ photo: file, duplicateOf: dup.id, pixelBox: { x: c.minx, y: c.miny, w: c.w, h: c.h } }); continue }

    const id = 'P' + String(++idN).padStart(3, '0')
    kept.push({ id, sig, aspect, mmLong })

    // best-effort catalogue link
    let nearest = null
    for (const cat of catalog) { const d = sigDist(cat.sig, sig); if (!nearest || d < nearest.score) nearest = { file: cat.file, score: +d.toFixed(1) } }

    manifestPieces.push({
      id, photo: file,
      pixelBox: { x: c.minx, y: c.miny, w: c.w, h: c.h },
      pctOfCaseW: +(c.w / cas.box.w * 100).toFixed(1),
      pctOfCaseH: +(c.h / cas.box.h * 100).toFixed(1),
      mmW, mmH, mmLong: +mmLong.toFixed(1), tier: tierOf(mmLong),
      nearestCutout: nearest,
    })
    drawn.push({ id, box: c, mmW, mmH })
  }

  // ---- render 5-pieces-bordered: full photo, red box + id per piece --------
  const labelParts = []
  for (const d of drawn) {
    const b = d.box
    labelParts.push(`<rect x="${b.minx}" y="${b.miny}" width="${b.w}" height="${b.h}" fill="none" stroke="#ff1d1d" stroke-width="3"/>`)
    const ty = b.miny > 24 ? b.miny - 6 : b.maxy + 22
    labelParts.push(`<text x="${b.minx}" y="${ty}" font-family="sans-serif" font-size="26" font-weight="bold" fill="#ff1d1d" stroke="#ffffff" stroke-width="4" paint-order="stroke">${d.id}</text>`)
  }
  const borderSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labelParts.join('')}</svg>`)
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: borderSvg, top: 0, left: 0 }])
    .jpeg({ quality: 82 }).toFile(join(OUT_BORDER, file.replace(/\.jpe?g$/i, '') + '.jpg'))

  // ---- render 6-bounding-box-with-size: one crop per piece -----------------
  const capH = 40
  for (const d of drawn) {
    const b = d.box
    const pad = Math.round(Math.max(b.w, b.h) * 0.14) + 10
    const cx = Math.max(0, b.minx - pad), cy = Math.max(0, b.miny - pad)
    const cex = Math.min(W, b.maxx + pad), cey = Math.min(H, b.maxy + pad)
    const cw = cex - cx, ch = cey - cy
    const crop = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer()
    const rx = b.minx - cx, ry = b.miny - cy
    const cap = `${d.id}   ${d.mmW} × ${d.mmH} mm`
    const ov = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch + capH}">` +
      `<rect x="0" y="${ch}" width="${cw}" height="${capH}" fill="#111111"/>` +
      `<rect x="${rx}" y="${ry}" width="${b.w}" height="${b.h}" fill="none" stroke="#ff1d1d" stroke-width="3"/>` +
      `<text x="8" y="${ch + 27}" font-family="sans-serif" font-size="22" font-weight="bold" fill="#ffffff">${esc(cap)}</text>` +
      `</svg>`)
    await sharp({ create: { width: cw, height: ch + capH, channels: 3, background: '#ffffff' } })
      .composite([{ input: crop, top: 0, left: 0 }, { input: ov, top: 0, left: 0 }])
      .jpeg({ quality: 88 }).toFile(join(OUT_SIZE, `${d.id}.jpg`))
  }

  manifestPhotos.push({ photo: file, cased: true, caseBoxPx: cas.box, mmPerPx: +mmPerPx.toFixed(4), topFramed: cas.topFramed, botFramed: cas.botFramed, taggedPieces: drawn.length, skippedDuplicates: pieces.length - drawn.length })
  console.log(`${file}: ${drawn.length} pieces tagged (${pieces.length - drawn.length} dup) mm/px=${mmPerPx.toFixed(4)}`)

  if (DEBUG) {
    const dbg = Buffer.from(data)
    const px = (x, y, r, g, bl) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; dbg[o] = r; dbg[o + 1] = g; dbg[o + 2] = bl }
    for (let p = 0; p < W * H; p++) if (det.mask[p]) { const o = p * 4; dbg[o] = Math.min(255, dbg[o] * 0.5 + 128); dbg[o + 1] = dbg[o + 1] * 0.5; dbg[o + 2] = dbg[o + 2] * 0.5 }
    const rect = (bx, r, g, bl, t = 1) => { for (let k = 0; k < t; k++) { for (let x = bx.minx; x <= bx.maxx; x++) { px(x, bx.miny + k, r, g, bl); px(x, bx.maxy - k, r, g, bl) } for (let y = bx.miny; y <= bx.maxy; y++) { px(bx.minx + k, y, r, g, bl); px(bx.maxx - k, y, r, g, bl) } } }
    rect(cas.box, 0, 200, 255, 2)
    for (const d of drawn) rect(d.box, 0, 255, 0, 2)
    await sharp(dbg, { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 72 }).toFile(join(DEBUG_DIR, `dbg-${file.replace(/\.jpe?g$/i, '')}.jpg`))
  }
}

await writeFile(MANIFEST, JSON.stringify({
  generatedAt: new Date().toISOString(),
  caseSizeMm: { w: CASE_W_MM, h: CASE_H_MM },
  note: 'Pieces detected directly on the case in 1-charms-real-image. ids are sequential; nearestCutout is a best-effort appearance link to 3-charms-each-piece (lower score = closer).',
  totalPieces: manifestPieces.length,
  totalSkippedDuplicates: manifestSkipped.length,
  photos: manifestPhotos,
  pieces: manifestPieces,
  skipped: manifestSkipped,
}, null, 2))

console.log(`\ndone — ${manifestPieces.length} unique pieces, ${manifestSkipped.length} duplicates skipped`)
console.log(`  ${OUT_BORDER}`)
console.log(`  ${OUT_SIZE}`)
console.log(`  ${MANIFEST}` + (DEBUG ? `\n  overlays in ${DEBUG_DIR}` : ''))
