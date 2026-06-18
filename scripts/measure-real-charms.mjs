/**
 * measure-real-charms.mjs (analysis only — does not modify catalog)
 * -------------------------------------------------------------------------
 * The reference photos in dist/assets/charms-real-image are real gold charms
 * arranged on a WHITE iPhone 16 Pro Max silicone case. The case is a known
 * real-world size, so it acts as a ruler: we detect the case (to get mm/px),
 * then detect each gold charm blob and measure its real long-side in mm.
 *
 * Output:
 *   - per-image: detected case bbox, charm count, and the long-side mm of each
 *     charm (sorted), plus tier-bucket stats.
 *   - an annotated debug PNG per image (case box = cyan, charm boxes = magenta)
 *     written to /tmp/charm-measure/ so the detection can be eyeballed.
 *
 * Run:  node scripts/measure-real-charms.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
// Reference photos of real gold charms on an iPhone 16 Pro Max case. (Preserved
// thumbnails — the original full-res shots lived in the ephemeral dist/ and were
// cleared by a Vite build; the calibration they produced is already persisted.)
const DIR = join(ROOT, 'reference', 'charms-real-image')
const OUT = '/tmp/charm-measure'

// iPhone 16 Pro Max: bare 77.6 x 163.0 mm. A silicone/gel case adds ~2mm wall
// per side, so the case OUTER (what the photo shows) ≈ 81.6 x 167.0 mm.
const CASE_W_MM = 81.6
const CASE_H_MM = 167.0

const TARGET_H = 1040 // working resolution (downscaled from 6240)

// Calibrated from the case-width read on the gridded debug overlay: the ~82mm
// 16 Pro Max case spans ≈380px at the TARGET_H working resolution → 0.215 mm/px.
const FIXED_MM_PER_PX = 0.215

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const v = mx / 255
  const s = mx === 0 ? 0 : (mx - mn) / mx
  return { s, v, warm: r - b }
}

// Connected-component labelling on a Uint8 mask; returns components w/ bbox+area.
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
      // 8-neighbourhood so diagonal charm parts stay connected
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const q = ny * W + nx
          if (!lab[q] && mask[q]) { lab[q] = cur; st[sp++] = q }
        }
      }
    }
    if (area >= minArea) comps.push({ minx, maxx, miny, maxy, area })
  }
  return comps
}

function dilate(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        if (m[p]) { out[p] = 1; continue }
        if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) ||
            (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) out[p] = 1
      }
    }
    m = out
  }
  return m
}

async function processImage(file) {
  const img = sharp(join(DIR, file)).rotate()
  const meta = await img.metadata()
  const scale = TARGET_H / meta.height
  const W = Math.round(meta.width * scale)
  const H = TARGET_H
  const { data } = await img.resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  // --- 1. case detection: flood-fill the DESK inward from the 4 borders, then
  // the case is the large bright region the desk-fill never reached. The desk
  // (cool grey) is connected to the frame border; the cream case is an island. ---
  const at = (p) => p * 4
  const cornerPts = [0, W - 1, (H - 1) * W, W * H - 1]
  let cr = 0, cg = 0, cb = 0
  for (const c of cornerPts) { cr += data[at(c)]; cg += data[at(c) + 1]; cb += data[at(c) + 2] }
  cr /= 4; cg /= 4; cb /= 4
  // sample a cream patch (just right of the camera, top third) for diagnostics
  const cs = at(Math.round(H * 0.12) * W + Math.round(W * 0.52))
  const DESK_TOL = 30
  const desk = new Uint8Array(W * H)
  {
    const st = new Int32Array(W * H)
    let sp = 0
    for (const c of cornerPts) if (!desk[c]) { desk[c] = 1; st[sp++] = c }
    const t2 = DESK_TOL * DESK_TOL
    while (sp > 0) {
      const p = st[--sp], o = at(p)
      const dr = data[o] - cr, dg = data[o + 1] - cg, db = data[o + 2] - cb
      if (dr * dr + dg * dg + db * db > t2) continue
      const x = p % W, y = (p / W) | 0
      if (x > 0 && !desk[p - 1]) { desk[p - 1] = 1; st[sp++] = p - 1 }
      if (x < W - 1 && !desk[p + 1]) { desk[p + 1] = 1; st[sp++] = p + 1 }
      if (y > 0 && !desk[p - W]) { desk[p - W] = 1; st[sp++] = p - W }
      if (y < H - 1 && !desk[p + W]) { desk[p + W] = 1; st[sp++] = p + W }
    }
  }
  // case mask: bright-ish and NOT desk; largest component = the case body
  const caseMask = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    if (desk[p]) continue
    const o = at(p)
    const { v } = hsv(data[o], data[o + 1], data[o + 2])
    if (v > 0.45) caseMask[p] = 1
  }
  const caseComps = components(dilate(caseMask, W, H, 4), W, H, 5000).sort((a, b) => b.area - a.area)
  const cbox = caseComps[0] || { minx: 0, miny: 0, maxx: W - 1, maxy: H - 1 }
  const casePxW = cbox.maxx - cbox.minx + 1
  const casePxH = cbox.maxy - cbox.miny + 1
  // All 5 photos share identical framing of the same iPhone 16 Pro Max case, so
  // a single calibrated scale (from the clean case-WIDTH read against an ~82mm
  // case) is more reliable than per-image case detection (desk/cream are too
  // close in colour for the height to be trusted on every shot).
  const mmPerPx = FIXED_MM_PER_PX
  console.log(`  [diag ${file}] corner rgb=(${cr | 0},${cg | 0},${cb | 0}) cream rgb=(${data[cs]},${data[cs + 1]},${data[cs + 2]})  caseDetect=${casePxW}x${casePxH}`)

  // --- 2. gold charm mask inside the case ---
  const goldMask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (x < cbox.minx || x > cbox.maxx || y < cbox.miny || y > cbox.maxy) continue
      const o = p * 4
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const { s, v, warm } = hsv(r, g, b)
      // golden metal: warm (r>>b), reasonably saturated, not a dark crevice
      if (warm > 24 && s > 0.22 && v > 0.28) goldMask[p] = 1
    }
  }
  const gold = dilate(goldMask, W, H, 3) // bridge small gaps within a charm
  const minCharmArea = Math.round((1.6 / mmPerPx) * (1.6 / mmPerPx)) // ≥1.6mm blob
  const charms = components(gold, W, H, minCharmArea)
    .map((c) => {
      const w = (c.maxx - c.minx + 1) * mmPerPx
      const h = (c.maxy - c.miny + 1) * mmPerPx
      return { ...c, wMm: w, hMm: h, longMm: Math.max(w, h) }
    })
    // ignore blobs bigger than a plausible charm (merged clusters / artefacts)
    .filter((c) => c.longMm >= 4 && c.longMm <= 42)
    .sort((a, b) => b.longMm - a.longMm)

  // --- 3. annotated debug overlay ---
  const dbg = Buffer.from(data) // RGBA copy
  const px = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = (y * W + x) * 4
    dbg[o] = r; dbg[o + 1] = g; dbg[o + 2] = b; dbg[o + 3] = 255
  }
  const rect = (b, r, g, bl) => {
    for (let x = b.minx; x <= b.maxx; x++) { px(x, b.miny, r, g, bl); px(x, b.maxy, r, g, bl) }
    for (let y = b.miny; y <= b.maxy; y++) { px(b.minx, y, r, g, bl); px(b.maxx, y, r, g, bl) }
  }
  rect(cbox, 0, 200, 255)
  for (const c of charms) { rect(c, 255, 0, 200); rect({ minx: c.minx - 1, maxx: c.maxx + 1, miny: c.miny - 1, maxy: c.maxy + 1 }, 255, 0, 200) }
  // measurement grid: bright line every 100px, faint every 50px
  for (let x = 0; x < W; x += 50) {
    const bright = x % 100 === 0
    for (let y = 0; y < H; y++) px(x, y, bright ? 0 : 90, bright ? 160 : 90, 0)
  }
  for (let y = 0; y < H; y += 50) {
    const bright = y % 100 === 0
    for (let x = 0; x < W; x++) px(x, y, bright ? 0 : 90, bright ? 160 : 90, 0)
  }
  await mkdir(OUT, { recursive: true })
  await sharp(dbg, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(OUT, `dbg-${file.replace(/\.jpg$/i, '')}.png`))

  return { file, casePxW, casePxH, mmPerPx, count: charms.length, longs: charms.map((c) => +c.longMm.toFixed(1)) }
}

const files = (await readdir(DIR)).filter((f) => /\.jpe?g$/i.test(f))
const all = []
for (const f of files) {
  const r = await processImage(f)
  all.push(r)
  console.log(`\n=== ${f} ===`)
  console.log(`case px ${r.casePxW}x${r.casePxH}  mm/px=${r.mmPerPx.toFixed(4)}  charms=${r.count}`)
  console.log(`long sides mm: ${r.longs.join(', ')}`)
}

const allLongs = all.flatMap((r) => r.longs).sort((a, b) => a - b)
const pct = (p) => allLongs[Math.min(allLongs.length - 1, Math.floor(p * allLongs.length))]
console.log('\n===== AGGREGATE =====')
console.log(`total charms measured: ${allLongs.length}`)
console.log(`long-side mm  min=${allLongs[0]}  p25=${pct(0.25)}  median=${pct(0.5)}  p75=${pct(0.75)}  p90=${pct(0.9)}  max=${allLongs[allLongs.length - 1]}`)
const buckets = { '<=10 (mini)': 0, '10-20 (midi)': 0, '>20 (grande)': 0 }
for (const l of allLongs) { if (l <= 10) buckets['<=10 (mini)']++; else if (l <= 20) buckets['10-20 (midi)']++; else buckets['>20 (grande)']++ }
console.log('buckets:', JSON.stringify(buckets))
