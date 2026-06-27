/**
 * build-case-rects.mjs — accurate phone-case rectangle per reference photo, in
 * DET_H=1800 detection space, written to reference/case-rects.json.
 *
 * KEY IDEA: photos shot in the same capture SESSION (same ~30s bucket of the
 * filename timestamp) share one camera distance, so the case is the SAME pixel
 * size in every photo of that session — regardless of case colour. We calibrate
 * ONE width per session from the most reliable detections and apply it to every
 * photo in that session, centred on each photo's charm cluster.
 *
 * Per-photo raw detection:
 *  - BLACK case (dark): flood the bright desk from the border; the case is the
 *    largest non-desk component. Its bbox width is accurate (sharp edge).
 *  - LIGHT case: per-column WARMTH profile (cream silicone is warmer than the
 *    cool desk); width = span where warmth exceeds the desk warmth. Used only
 *    when it lands in a plausible range.
 *
 * Session width = median of confident detections in that session (black cases
 * preferred; else warmth). Height = width × case aspect (166/80.6) — the top /
 * bottom case edges are too soft / often cropped to detect directly. The box is
 * centred on the charm-cluster centre (the cluster sits centred on the case),
 * then nudged so the whole cluster stays inside, then clamped to the frame.
 *
 * Hand overrides in reference/case-rects.overrides.json (DET space) always win.
 *
 * Run: node scripts/build-case-rects.mjs   (writes json + _verify overlay)
 */
import sharp from 'sharp'
import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const DET_H = 1800
const PRODUCT_W = 80.6
const PRODUCT_H = 166
const ASPECT = PRODUCT_H / PRODUCT_W
const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }
const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] }

// Session key = 30-second bucket of the capture time in Image_YYYYMMDDHHMMSS_...
function sessionKey(base) {
  const m = base.match(/Image_(\d{8})(\d{2})(\d{2})(\d{2})_/)
  if (!m) return base
  const [, day, hh, mm, ss] = m
  const t = (+hh) * 3600 + (+mm) * 60 + (+ss)
  return day + '_' + Math.round(t / 30)
}

async function rawDetect(file) {
  const { data, info } = await sharp(file).rotate().resize({ height: DET_H }).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const lum = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  const warm = (o) => data[o] - data[o + 2]

  const cz = []
  for (let y = (H * 0.08) | 0; y < (H * 0.16) | 0; y += 2) for (let x = (W * 0.4) | 0; x < (W * 0.6) | 0; x += 2) cz.push(lum((y * W + x) * C))
  const caseLumMid = median(cz)

  // BLACK-case detection: flood the bright desk from the border; case = largest
  // non-desk connected component.
  let blackBox = null
  {
    const bright = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) if (lum(p * C) > 110) bright[p] = 1
    const outm = new Uint8Array(W * H); const q = []; let h = 0
    const seed = (p) => { if (!outm[p] && bright[p]) { outm[p] = 1; q.push(p) } }
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
    while (h < q.length) { const p = q[h++]; const x = p % W, y = (p / W) | 0; if (x > 0) seed(p - 1); if (x < W - 1) seed(p + 1); if (y > 0) seed(p - W); if (y < H - 1) seed(p + W) }
    const seen = new Uint8Array(W * H); let best = null; const st = []
    for (let s = 0; s < W * H; s++) {
      if (outm[s] || seen[s]) continue
      st.length = 0; st.push(s); seen[s] = 1; let mnx = W, mny = H, mxx = 0, mxy = 0, a = 0
      while (st.length) {
        const p = st.pop(); const x = p % W, y = (p / W) | 0
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; a++
        if (x > 0 && !outm[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st.push(p - 1) }
        if (x < W - 1 && !outm[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st.push(p + 1) }
        if (y > 0 && !outm[p - W] && !seen[p - W]) { seen[p - W] = 1; st.push(p - W) }
        if (y < H - 1 && !outm[p + W] && !seen[p + W]) { seen[p + W] = 1; st.push(p + W) }
      }
      if (!best || a > best.a) best = { minx: mnx, miny: mny, maxx: mxx, maxy: mxy, a }
    }
    if (best && best.a > W * H * 0.12) blackBox = best
  }

  // LIGHT-case warmth profile
  let warmBox = null
  {
    const cy0 = (H * 0.30) | 0, cy1 = (H * 0.70) | 0
    const colW = new Array(W)
    for (let x = 0; x < W; x++) { const a = []; for (let y = cy0; y < cy1; y += 3) a.push(warm((y * W + x) * C)); colW[x] = median(a) }
    const k = (W * 0.04) | 0
    const deskW = median([...colW.slice(0, k), ...colW.slice(W - k)])
    const isCase = colW.map((w) => w - deskW > 8)
    const run = (W * 0.02) | 0
    let lo = -1, hi = -1
    for (let i = 0; i < W; i++) { let c = 0; for (let j = 0; j < run * 2 && i + j < W; j++) if (isCase[i + j]) c++; if (c >= run) { lo = i; break } }
    for (let i = W - 1; i >= 0; i--) { let c = 0; for (let j = 0; j < run * 2 && i - j >= 0; j++) if (isCase[i - j]) c++; if (c >= run) { hi = i; break } }
    if (lo >= 0 && hi > lo) warmBox = { minx: lo, maxx: hi }
  }

  const isBlack = caseLumMid < 95
  return { W, H, caseLumMid, isBlack, blackBox, warmBox }
}

function clusterOf(pieces) {
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
  for (const p of pieces) {
    mnx = Math.min(mnx, p.pixelBox.x); mxx = Math.max(mxx, p.pixelBox.x + p.pixelBox.w)
    mny = Math.min(mny, p.pixelBox.y); mxy = Math.max(mxy, p.pixelBox.y + p.pixelBox.h)
  }
  return { mnx, mxx, mny, mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny }
}

// Reliable case-tilt detection (degrees from vertical). Searches for the strong
// case↔desk gradient edge in a NARROW band around the known case-rect left/right
// edges (so interior charms are never mistaken for the edge), fits each edge by
// the Theil–Sen median slope, and only TRUSTS the result when the two edges
// independently agree (their angle differs by < 1.6°). Returns 0 when unreliable
// or below a small threshold, so straight cases are never falsely rotated.
async function detectTilt(file, rect, isBlack) {
  const { data, info } = await sharp(file).rotate().resize({ height: DET_H }).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const lum = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  const warm = (o) => data[o] - data[o + 2]
  const sig = (o) => (isBlack ? -lum(o) : warm(o)) // case scores HIGHER than desk
  const band = 50
  const ptsL = [], ptsR = []
  const y0 = Math.max(4, (rect.miny + H * 0.06) | 0), y1 = Math.min(H - 5, (rect.maxy - H * 0.06) | 0)
  for (let y = y0; y < y1; y += 3) {
    let bgL = -1e9, bxL = -1
    for (let x = Math.max(6, rect.minx - band); x < rect.minx + band && x < W - 6; x++) {
      const g = sig((y * W + x + 4) * C) - sig((y * W + x - 4) * C)
      if (g > bgL) { bgL = g; bxL = x }
    }
    let bgR = -1e9, bxR = -1
    for (let x = Math.max(6, rect.maxx - band); x < rect.maxx + band && x < W - 6; x++) {
      const g = sig((y * W + x - 4) * C) - sig((y * W + x + 4) * C)
      if (g > bgR) { bgR = g; bxR = x }
    }
    if (bgL > 10) ptsL.push([y, bxL])
    if (bgR > 10) ptsR.push([y, bxR])
  }
  const ts = (pts) => {
    const s = []
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dy = pts[j][0] - pts[i][0]; if (Math.abs(dy) < 60) continue
      s.push((pts[j][1] - pts[i][1]) / dy)
    }
    return s.length ? median(s) : null
  }
  const sL = ts(ptsL), sR = ts(ptsR)
  if (sL == null || sR == null) return 0
  const aL = Math.atan(sL) * 180 / Math.PI, aR = Math.atan(sR) * 180 / Math.PI
  if (Math.abs(aL - aR) > 1.6) return 0 // edges disagree → untrustworthy
  const tilt = (aL + aR) / 2
  return Math.abs(tilt) >= 0.8 ? +tilt.toFixed(2) : 0
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const ovPath = join(REF, 'case-rects.overrides.json')
  const overrides = (await exists(ovPath)) ? JSON.parse(await readFile(ovPath, 'utf8')) : {}
  const byPhoto = new Map()
  for (const p of tracking.pieces) { if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, []); byPhoto.get(p.photo).push(p) }
  const files = (await readdir(join(REF, '1-charms-real-image'))).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()

  const recs = []
  for (const file of files) {
    const base = file.replace(/\.(jpe?g|png)$/i, '')
    const pieces = byPhoto.get(base + '.jpg') || byPhoto.get(base + '.png')
    if (!pieces || !pieces.length) continue
    const det = await rawDetect(join(REF, '1-charms-real-image', file))
    const cl = clusterOf(pieces)
    recs.push({ base, file, ...det, cl, session: sessionKey(base) })
  }

  const bySession = {}
  for (const r of recs) (bySession[r.session] ||= []).push(r)
  const sessionWidth = {}
  for (const [s, list] of Object.entries(bySession)) {
    const blackW = list.filter((r) => r.isBlack && r.blackBox).map((r) => r.blackBox.maxx - r.blackBox.minx)
    const warmW = list.filter((r) => r.warmBox).map((r) => r.warmBox.maxx - r.warmBox.minx)
      .filter((w) => w > recs[0].W * 0.45 && w < recs[0].W * 0.82)
    sessionWidth[s] = blackW.length ? median(blackW) : (warmW.length ? median(warmW) : null)
  }
  const globalW = median(Object.values(sessionWidth).filter(Boolean))

  const out = {}
  for (const r of recs) {
    if (overrides[r.base]) {
      const ov = overrides[r.base]
      const tilt = ov.tilt != null ? ov.tilt : await detectTilt(join(REF, '1-charms-real-image', r.file), ov, r.isBlack)
      out[r.base] = { ...ov, tilt, W: r.W, H: r.H, source: 'override' }
      continue
    }
    let caseW, caseCx, source
    if (r.isBlack && r.blackBox) {
      caseW = r.blackBox.maxx - r.blackBox.minx
      caseCx = (r.blackBox.minx + r.blackBox.maxx) / 2
      source = 'black'
    } else {
      caseW = sessionWidth[r.session] || globalW
      caseCx = r.cl.cx
      source = sessionWidth[r.session] ? 'session' : 'global'
    }
    const caseH = caseW * ASPECT
    const halfH = caseH / 2, halfW = caseW / 2
    let caseCy = r.cl.cy
    if (r.cl.mny < caseCy - halfH + 6) caseCy = r.cl.mny + halfH - 6
    if (r.cl.mxy > caseCy + halfH - 6) caseCy = r.cl.mxy - halfH + 6
    const rect = {
      minx: Math.round(caseCx - halfW), maxx: Math.round(caseCx + halfW),
      miny: Math.round(caseCy - halfH), maxy: Math.round(caseCy + halfH),
    }
    // tilt (deg from vertical); overrides may pin it explicitly
    const tilt = overrides[r.base] && overrides[r.base].tilt != null
      ? overrides[r.base].tilt
      : await detectTilt(join(REF, '1-charms-real-image', r.file), rect, r.isBlack)
    out[r.base] = { ...rect, tilt, W: r.W, H: r.H, source }
  }

  await mkdir(REF, { recursive: true })
  await writeFile(join(REF, 'case-rects.json'), JSON.stringify(out, null, 2))
  for (const r of recs) { const c = out[r.base]; console.log(r.base.slice(-12), c.source.padEnd(8), `x ${c.minx}-${c.maxx} (w${c.maxx - c.minx})  tilt ${c.tilt || 0}°  sess ${r.session}`) } // eslint-disable-line
  console.log('\nsession widths:', JSON.stringify(sessionWidth), 'global', globalW) // eslint-disable-line

  await mkdir(join(REF, '_verify'), { recursive: true })
  const tiles = []
  for (const r of recs) {
    const c = out[r.base]
    const dispH = 560, ds = dispH / r.H, dispW = Math.round(r.W * ds)
    const rx = (c.minx * ds) | 0, ry = (c.miny * ds) | 0, rw = ((c.maxx - c.minx) * ds) | 0, rh = ((c.maxy - c.miny) * ds) | 0
    const cx = ((c.minx + c.maxx) / 2 * ds) | 0
    const col = c.source === 'override' ? '#ffaa00' : c.source === 'black' ? '#00dd00' : c.source === 'session' ? '#33aaff' : '#ff4444'
    const svg = Buffer.from(`<svg width="${dispW}" height="${dispH}"><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${col}" stroke-width="3"/><line x1="${cx}" y1="0" x2="${cx}" y2="${dispH}" stroke="${col}" stroke-width="1"/></svg>`)
    tiles.push(await sharp(join(REF, '1-charms-real-image', r.file)).rotate().resize({ height: dispH }).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer())
  }
  const cols = 6, pad = 6
  let cw = 0, chh = 0
  for (const t of tiles) { const m = await sharp(t).metadata(); cw = Math.max(cw, m.width); chh = Math.max(chh, m.height) }
  const rows = Math.ceil(tiles.length / cols)
  const comp = tiles.map((t, i) => ({ input: t, left: pad + (i % cols) * (cw + pad), top: pad + ((i / cols) | 0) * (chh + pad) }))
  await sharp({ create: { width: cols * cw + (cols + 1) * pad, height: rows * chh + (rows + 1) * pad, channels: 4, background: '#222' } })
    .composite(comp).png().toFile(join(REF, '_verify', '_ALL_caserects.png'))
  console.log('wrote reference/case-rects.json + reference/_verify/_ALL_caserects.png') // eslint-disable-line
}

main()
