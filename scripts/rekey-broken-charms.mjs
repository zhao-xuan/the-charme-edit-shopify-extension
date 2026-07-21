// Re-key broken charm cutouts from clean raw crops.
//
// The original extraction (extract-each-piece.mjs) shattered translucent stones
// (amber), over-keyed light pieces, and left stray fragments/shadows on a set of
// charms. This script rebuilds a clean transparent cutout for each flagged id
// from its raw crop, using auto background detection + connected-component
// cleanup + small-hole fill. It writes the cutout to public/assets/charms/ref/
// (and reference/3-charms-each-piece/ when that intermediate exists) and updates
// pxW/pxH + widthMm/heightMm in src/data/catalog.json, preserving each charm's
// real long-side millimetre size so on-case scale is unchanged.
//
// Usage: node scripts/rekey-broken-charms.mjs [--dry]
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const REF = path.join(ROOT, 'public/assets/charms/ref')
const PIECE = path.join(ROOT, 'reference/3-charms-each-piece')
const CATALOG = path.join(ROOT, 'src/data/catalog.json')
const DRY = process.argv.includes('--dry')

// --- tuning ---------------------------------------------------------------
const BORDER = 6 // px strip used to sample background colour
const SOFT_LO = 24 // colour-distance below this = fully background
const SOFT_HI = 64 // colour-distance above this = fully foreground
const BIN_T = 42 // binary threshold for component analysis
const KEEP_FRAC = 0.1 // secondary parts must be >= 10% of the largest to survive
const KEEP_CENTRAL = 0.12 // ...and their centroid must sit within the central 76%
const CLOSE_R = 2 // morphological close radius — bridges internal dark gaps (holes/bands)
const HOLE_MAX_FRAC = 0.06 // fill enclosed holes smaller than 6% of piece area
const OUT_MAX = 700 // cap longest output side

// The flagged charms. `src` is the clean raw crop to re-key.
const EX = 'reference/2-charms-extracted'
const F155 = 'f1551077-9a1d-4e7c-bf0a-000000000abc'
const F155B = 'f1552077-9a1d-4e7c-bf0a-000000000abc'
const F155C = 'f1553077-9a1d-4e7c-bf0a-000000000abc'
const TARGETS = [
  [`${F155}-01`, `${EX}/${F155}-01.png`],
  [`${F155}-02`, `${EX}/${F155}-02.png`],
  [`${F155}-03`, `${EX}/${F155}-03.png`],
  [`${F155}-05`, `${EX}/${F155}-05.png`],
  [`${F155}-06`, `${EX}/${F155}-06.png`],
  [`${F155}-07`, `${EX}/${F155}-07.png`],
  [`${F155}-08`, `${EX}/${F155}-08.png`],
  [`${F155B}-01`, `${EX}/${F155B}-01.png`],
  [`${F155B}-02`, `${EX}/${F155B}-02.png`],
  [`${F155B}-03`, `${EX}/${F155B}-03.png`],
  [`${F155B}-04`, `${EX}/${F155B}-04.png`],
  [`${F155B}-05`, `${EX}/${F155B}-05.png`],
  [`${F155B}-06`, `${EX}/${F155B}-06.png`],
  [`${F155C}-04`, `${EX}/${F155C}-04.png`],
  [`${F155C}-05`, `${EX}/${F155C}-05.png`],
  [`${F155C}-09`, `${EX}/${F155C}-09.png`],
]

// Natural stones/shells are solid objects. Their dark textures sit on a dark
// case background, so per-pixel colour keying swiss-cheeses them. For these we
// key by silhouette instead: close gaps, keep the outline, fill ALL interior
// holes, and take alpha from the filled shape (original texture stays opaque).
const SOLID = new Set([
  `${F155B}-01`, `${F155B}-02`, `${F155B}-03`, `${F155B}-04`, `${F155B}-05`, `${F155B}-06`, `${F155C}-09`,
])

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y)
  return a[a.length >> 1]
}

function detectBg(data, w, h) {
  const rs = [], gs = [], bs = []
  const sample = (x, y) => {
    const i = (y * w + x) * 4
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2])
  }
  for (let x = 0; x < w; x++) {
    for (let t = 0; t < BORDER; t++) { sample(x, t); sample(x, h - 1 - t) }
  }
  for (let y = 0; y < h; y++) {
    for (let t = 0; t < BORDER; t++) { sample(t, y); sample(w - 1 - t, y) }
  }
  return [median(rs), median(gs), median(bs)]
}

// morphological erode/dilate (3x3) — an open() severs thin bridges + kills sparkle
function erode(mask, w, h) {
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (!mask[p]) continue
    let keep = 1
    for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) { keep = 0; break }
    }
    o[p] = keep
  }
  return o
}
function dilate(mask, w, h) {
  const o = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x
    if (mask[p]) { o[p] = 1; continue }
    let any = 0
    for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { any = 1; break }
    }
    o[p] = any
  }
  return o
}
const dilateN = (m, w, h, n) => { for (let i = 0; i < n; i++) m = dilate(m, w, h); return m }
const erodeN = (m, w, h, n) => { for (let i = 0; i < n; i++) m = erode(m, w, h); return m }

// 4-connected component labelling over a boolean mask.
function label(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1)
  const areas = []
  let next = 0
  const stack = []
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] !== -1) continue
    const id = next++
    let area = 0
    stack.push(s); lab[s] = id
    while (stack.length) {
      const p = stack.pop(); area++
      const x = p % w, y = (p / w) | 0
      if (x > 0 && mask[p - 1] && lab[p - 1] === -1) { lab[p - 1] = id; stack.push(p - 1) }
      if (x < w - 1 && mask[p + 1] && lab[p + 1] === -1) { lab[p + 1] = id; stack.push(p + 1) }
      if (y > 0 && mask[p - w] && lab[p - w] === -1) { lab[p - w] = id; stack.push(p - w) }
      if (y < h - 1 && mask[p + w] && lab[p + w] === -1) { lab[p + w] = id; stack.push(p + w) }
    }
    areas.push(area)
  }
  return { lab, areas, count: next }
}

export async function rekey(id, srcRel, solid = false, opts = {}) {
  const src = path.join(ROOT, srcRel)
  const binT = opts.binT ?? BIN_T
  const softLo = opts.softLo ?? SOFT_LO
  const softHi = opts.softHi ?? SOFT_HI
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height, N = w * h
  const bg = detectBg(data, w, h)

  // colour distance to background + soft alpha
  const dist = new Float32Array(N)
  const fg = new Uint8Array(N)
  for (let p = 0; p < N; p++) {
    const i = p * 4
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2]
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    dist[p] = d
    if (d >= binT) fg[p] = 1
  }

  // morphological close (bridge internal dark gaps so a piece stays whole) then
  // open (drop sparkle/thin bridges) before component analysis
  const closeR = opts.closeR ?? (solid ? 4 : CLOSE_R)
  const fgClosed = erodeN(dilateN(fg, w, h, closeR), w, h, closeR)
  const fgOpen = dilate(erode(fgClosed, w, h), w, h)

  // Keep the largest component. Keep sizeable secondary parts too, but only if
  // their centroid is reasonably central — stray bits of a neighbouring charm
  // caught in the crop corner get dropped.
  const { lab, areas, count } = label(fgOpen, w, h)
  const sx = new Float64Array(count), sy = new Float64Array(count)
  for (let p = 0; p < N; p++) { const c = lab[p]; if (c >= 0) { sx[c] += p % w; sy[c] += (p / w) | 0 } }
  let maxA = 0, argmax = -1
  for (let c = 0; c < count; c++) if (areas[c] > maxA) { maxA = areas[c]; argmax = c }
  const keep = new Uint8Array(count)
  for (let c = 0; c < count; c++) {
    if (c === argmax) { keep[c] = 1; continue }
    if (areas[c] < maxA * KEEP_FRAC) continue
    const cxf = (sx[c] / areas[c]) / w, cyf = (sy[c] / areas[c]) / h
    if (cxf >= KEEP_CENTRAL && cxf <= 1 - KEEP_CENTRAL && cyf >= KEEP_CENTRAL && cyf <= 1 - KEEP_CENTRAL) keep[c] = 1
  }
  const kept = new Uint8Array(N)
  let pieceArea = 0
  for (let p = 0; p < N; p++) if (fgOpen[p] && keep[lab[p]]) { kept[p] = 1; pieceArea++ }

  // fill small enclosed holes (translucent gaps) — holes are background pixels
  // not reachable from the image border through non-kept pixels.
  const bgReach = new Uint8Array(N)
  const st = []
  const pushIf = (p) => { if (!kept[p] && !bgReach[p]) { bgReach[p] = 1; st.push(p) } }
  for (let x = 0; x < w; x++) { pushIf(x); pushIf((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { pushIf(y * w); pushIf(y * w + w - 1) }
  while (st.length) {
    const p = st.pop(); const x = p % w, y = (p / w) | 0
    if (x > 0) pushIf(p - 1); if (x < w - 1) pushIf(p + 1)
    if (y > 0) pushIf(p - w); if (y < h - 1) pushIf(p + w)
  }
  // enclosed holes = not kept, not reachable from border -> label & fill
  const holeMask = new Uint8Array(N)
  for (let p = 0; p < N; p++) if (!kept[p] && !bgReach[p]) holeMask[p] = 1
  const holes = label(holeMask, w, h)
  const holeCap = solid ? Infinity : pieceArea * (opts.holeMaxFrac ?? HOLE_MAX_FRAC)
  const fillHole = new Uint8Array(holes.count)
  for (let c = 0; c < holes.count; c++) if (holes.areas[c] <= holeCap) fillHole[c] = 1
  for (let p = 0; p < N; p++) if (holeMask[p] && fillHole[holes.lab[p]]) kept[p] = 1

  // build final RGBA
  const alpha = new Uint8Array(N)
  if (solid) {
    // silhouette alpha: opaque inside kept, 3x3 box-blur for a soft edge
    const hard = new Uint8Array(N)
    for (let p = 0; p < N; p++) hard[p] = kept[p] ? 255 : 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) { s += hard[ny * w + nx]; n++ }
      }
      alpha[y * w + x] = Math.round(s / n)
    }
  } else {
    for (let p = 0; p < N; p++) {
      if (!kept[p]) continue
      const d = dist[p]
      let a = d >= softHi ? 255 : d <= softLo ? 0 : Math.round(((d - softLo) / (softHi - softLo)) * 255)
      if (dist[p] < binT && a < 8) a = 255 // forced-fill holes opaque
      alpha[p] = a
    }
  }
  const out = Buffer.alloc(N * 4)
  let minx = w, miny = h, maxx = -1, maxy = -1
  for (let p = 0; p < N; p++) {
    const i = p * 4
    out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = alpha[p]
    if (alpha[p] > 12) {
      const x = p % w, y = (p / w) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) throw new Error('empty result for ' + id)

  // trim with 2px transparent margin
  const pad = 2
  minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad)
  maxx = Math.min(w - 1, maxx + pad); maxy = Math.min(h - 1, maxy + pad)
  const cw = maxx - minx + 1, chh = maxy - miny + 1

  let img = sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minx, top: miny, width: cw, height: chh })
  // gentle alpha feather to smooth edges
  const trimmed = await img.png().toBuffer()
  let final = sharp(trimmed)
  const meta = await final.metadata()
  let outW = meta.width, outH = meta.height
  if (Math.max(outW, outH) > OUT_MAX) {
    const s = OUT_MAX / Math.max(outW, outH)
    outW = Math.round(outW * s); outH = Math.round(outH * s)
    final = sharp(await final.resize(outW, outH).png().toBuffer())
  }
  const buf = await final.png().toBuffer()
  const fm = await sharp(buf).metadata()
  return { buf, pxW: fm.width, pxH: fm.height, bg }
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
  const byId = new Map(catalog.charms.map((c) => [c.id, c]))
  const rows = []
  for (const [id, srcRel] of TARGETS) {
    try {
      const { buf, pxW, pxH, bg } = await rekey(id, srcRel, SOLID.has(id))
      const c = byId.get(id)
      let longMm = c ? Math.max(c.widthMm, c.heightMm) : Math.max(pxW, pxH) * 0.108
      let widthMm, heightMm
      if (pxW >= pxH) { widthMm = longMm; heightMm = +(longMm * pxH / pxW).toFixed(1) }
      else { heightMm = longMm; widthMm = +(longMm * pxW / pxH).toFixed(1) }
      if (!DRY) {
        fs.writeFileSync(path.join(REF, id + '.png'), buf)
        const pf = path.join(PIECE, id + '.png')
        if (fs.existsSync(pf)) fs.writeFileSync(pf, buf)
        if (c) { c.pxW = pxW; c.pxH = pxH; c.widthMm = +widthMm.toFixed(1); c.heightMm = +heightMm.toFixed(1) }
      }
      rows.push(`${id.slice(-2)}  ${pxW}x${pxH}  ${widthMm.toFixed(1)}x${heightMm.toFixed(1)}mm  bg[${bg.map(Math.round)}]`)
    } catch (e) {
      rows.push(`${id}  ERR ${e.message}`)
    }
  }
  if (!DRY) fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n')
  console.log(rows.join('\n'))
  console.log(DRY ? '\n(dry run — nothing written)' : `\nupdated ${TARGETS.length} cutouts + catalog.json`)
}

// only run the f155 batch when executed directly (this module is also imported)
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main()
