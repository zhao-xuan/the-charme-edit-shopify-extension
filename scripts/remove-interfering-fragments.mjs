/**
 * remove-interfering-fragments.mjs
 * -------------------------------------------------------------------------
 * A few cut-outs from the shell+bow+star flat-lay keep a stray sliver of an
 * ADJACENT charm, joined to the main piece by a thin neck (a Voronoi-split
 * seam), so a plain largest-component test can't drop it (it's one blob).
 *
 * This breaks the thin neck with an erosion, keeps only the LARGEST resulting
 * blob (the real charm), dilates it back, and intersects with the original
 * alpha so the charm's true edge is preserved exactly — the stray fragment is
 * removed cleanly. Cleaned PNGs are written to reference/charms-cleaned/ and,
 * when --apply is passed, copied back over reference/extracted-charms/.
 *
 * Run:  node scripts/remove-interfering-fragments.mjs [--apply]
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'reference', 'extracted-charms')
const OUT = join(ROOT, 'reference', 'charms-cleaned')

// Charms with a stray adjacent-charm fragment to strip.
//  • `topCut`: the fragment sits across the top above a clear gap → erase every
//    row above this y (the bow: its loops all sit below the stray shell sliver).
//  • `erode`: the fragment joins by a thin neck → break it by erosion, keep the
//    largest blob, grow back (the star: a stray curl on its left).
const TARGETS = [
  { id: 'image-20260618161922-515-813-1-2', topCut: 38 }, // bow — stray shell sliver across the top
  { id: 'image-20260618161922-515-813-1-3', erode: 6 }, // star — stray curl at left
]

function erode(mask, W, H, r) {
  let m = mask
  for (let k = 0; k < r; k++) {
    const o = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!m[p]) continue
      if (x > 0 && !m[p - 1]) continue
      if (x < W - 1 && !m[p + 1]) continue
      if (y > 0 && !m[p - W]) continue
      if (y < H - 1 && !m[p + W]) continue
      o[p] = 1
    }
    m = o
  }
  return m
}
function dilate(mask, W, H, r) {
  let m = mask
  for (let k = 0; k < r; k++) {
    const o = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (m[p]) { o[p] = 1; continue }
      if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) || (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) o[p] = 1
    }
    m = o
  }
  return m
}
function largestComponent(mask, W, H) {
  const lab = new Int32Array(W * H), st = new Int32Array(W * H)
  let cur = 0, best = 0, bestN = 0
  for (let s = 0; s < W * H; s++) {
    if (lab[s] || !mask[s]) continue
    cur++; let sp = 0; st[sp++] = s; lab[s] = cur; let n = 0
    while (sp > 0) {
      const p = st[--sp]; n++
      const x = p % W, y = (p / W) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!lab[q] && mask[q]) { lab[q] = cur; st[sp++] = q }
      }
    }
    if (n > bestN) { bestN = n; best = cur }
  }
  const out = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (lab[p] === best) out[p] = 1
  return out
}

function trim(data, W, H, keep) {
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (keep[y * W + x]) {
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
  }
  const w = maxx - minx + 1, h = maxy - miny + 1
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sp = (miny + y) * W + (minx + x), dp = (y * w + x) * 4
    if (keep[sp]) { const so = sp * 4; out[dp] = data[so]; out[dp + 1] = data[so + 1]; out[dp + 2] = data[so + 2]; out[dp + 3] = data[so + 3] || 255 }
  }
  return { out, w, h }
}

const apply = process.argv.includes('--apply')
await mkdir(OUT, { recursive: true })

const manifestPath = join(SRC, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const newDims = {}

for (const t of TARGETS) {
  const file = join(SRC, `${t.id}.png`)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const alpha = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) alpha[p] = data[p * 4 + 3] >= 60 ? 1 : 0
  let keep
  if (t.topCut != null) {
    const cut = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) cut[p] = (((p / W) | 0) >= t.topCut && alpha[p]) ? 1 : 0
    keep = largestComponent(cut, W, H)
  } else {
    const core = largestComponent(erode(alpha, W, H, t.erode), W, H)
    const grown = dilate(core, W, H, t.erode + 2)
    keep = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) keep[p] = grown[p] && alpha[p] ? 1 : 0
  }
  const { out, w, h } = trim(data, W, H, keep)
  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(join(OUT, `${t.id}.png`), png)
  newDims[t.id] = { w, h }
  console.log(`${t.id}: ${W}x${H} → ${w}x${h} (fragment removed)`) // eslint-disable-line
  if (apply) await copyFile(join(OUT, `${t.id}.png`), file)
}

if (apply) {
  // refresh the manifest pixel sizes for the trimmed charms (mm recomputed by
  // scripts/recalibrate-charm-scale.mjs which reads pxW/pxH).
  for (const c of manifest.charms) {
    const d = newDims[c.id]
    if (d) { c.pxW = d.w; c.pxH = d.h }
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Applied to extracted-charms + updated manifest px sizes.') // eslint-disable-line
}
console.log(`\nWrote cleaned images to reference/charms-cleaned/${apply ? ' and applied' : ''}`) // eslint-disable-line
