/**
 * detect-case-test.mjs — find the real phone-case rectangle in each reference
 * photo and overlay it, so the crop can be verified by eye.
 *
 * The case is segmented from the desk by a flood fill from the photo border
 * through "desk-like" pixels, where desk-like = cool (r-b small) AND bright. The
 * white silicone case is warm cream (r-b ~22), a black case is dark (low lum) —
 * either way it is NOT desk-like, so the flood stops at the case edge. The case
 * is the largest non-desk connected component; its bbox is the case rect.
 *
 * Run: node scripts/detect-case-test.mjs
 */
import sharp from 'sharp'
import { readFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const DET_H = 1800

const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }

export async function detectCaseRect(realPath) {
  const { data, info } = await sharp(realPath).rotate().resize({ height: DET_H })
    .raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const idx = (x, y) => (y * W + x) * C
  const warmth = (o) => data[o] - data[o + 2]
  const lum = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]

  // desk-like = cool AND bright (so it excludes a warm cream case AND a dark
  // case). Thresholds are deliberately generous; connectivity does the rest.
  const TW = 16   // warmth below this = cool (desk)
  const TLd = 95  // luminance above this = bright (desk)
  const deskLike = (o) => warmth(o) < TW && lum(o) > TLd

  const filled = new Uint8Array(W * H)
  const q = []
  let head = 0
  const seed = (x, y) => { const p = y * W + x; if (!filled[p] && deskLike(idx(x, y))) { filled[p] = 1; q.push(p) } }
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1) }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y) }
  while (head < q.length) {
    const p = q[head++]
    const x = p % W, y = (p / W) | 0
    if (x > 0 && !filled[p - 1] && deskLike(idx(x - 1, y))) { filled[p - 1] = 1; q.push(p - 1) }
    if (x < W - 1 && !filled[p + 1] && deskLike(idx(x + 1, y))) { filled[p + 1] = 1; q.push(p + 1) }
    if (y > 0 && !filled[p - W] && deskLike(idx(x, y - 1))) { filled[p - W] = 1; q.push(p - W) }
    if (y < H - 1 && !filled[p + W] && deskLike(idx(x, y + 1))) { filled[p + W] = 1; q.push(p + W) }
  }

  // largest connected component of NOT-filled = the case
  const seen = new Uint8Array(W * H)
  let best = null
  const st = []
  for (let start = 0; start < W * H; start++) {
    if (filled[start] || seen[start]) continue
    st.length = 0; st.push(start); seen[start] = 1
    let minx = W, miny = H, maxx = 0, maxy = 0, area = 0
    while (st.length) {
      const p = st.pop()
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      area++
      if (x > 0 && !filled[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st.push(p - 1) }
      if (x < W - 1 && !filled[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st.push(p + 1) }
      if (y > 0 && !filled[p - W] && !seen[p - W]) { seen[p - W] = 1; st.push(p - W) }
      if (y < H - 1 && !filled[p + W] && !seen[p + W]) { seen[p + W] = 1; st.push(p + W) }
    }
    if (!best || area > best.area) best = { minx, miny, maxx, maxy, area }
  }
  return { W, H, box: best }
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  await mkdir(join(REF, '_verify'), { recursive: true })
  const bases = ['Image_20260618161922_515_813', 'Image_20260618161927_520_813',
    'Image_20260619201028_363_2327', 'Image_20260619201015_355_2327', 'Image_20260619214426_371_2327']
  for (const base of bases) {
    let realPath = join(REF, '1-charms-real-image', base + '.jpg')
    if (!(await exists(realPath))) realPath = realPath.replace(/\.jpg$/, '.png')
    const { W, H, box } = await detectCaseRect(realPath)
    const meta = tracking.photos.find((p) => p.photo.startsWith(base))
    const old = meta?.caseBoxPx
    const dispH = 1200, ds = dispH / H, dispW = Math.round(W * ds)
    const r = (b, col) => b ? `<rect x="${(b.minx * ds) | 0}" y="${(b.miny * ds) | 0}" width="${((b.maxx - b.minx) * ds) | 0}" height="${((b.maxy - b.miny) * ds) | 0}" fill="none" stroke="${col}" stroke-width="3"/>` : ''
    const cx = box ? ((box.minx + box.maxx) / 2 * ds) | 0 : 0
    const svg = Buffer.from(`<svg width="${dispW}" height="${dispH}">${r(box, '#00dd00')}${old ? r({ minx: old.minx, miny: old.miny, maxx: old.maxx, maxy: old.maxy }, '#ff0000') : ''}<line x1="${cx}" y1="0" x2="${cx}" y2="${dispH}" stroke="#00dd00" stroke-width="1"/></svg>`)
    await sharp(realPath).rotate().resize({ height: dispH }).composite([{ input: svg, top: 0, left: 0 }]).png()
      .toFile(join(REF, '_verify', '_detect_' + base.slice(-10) + '.png'))
    console.log(base.slice(-10), 'NEW', box ? `${box.minx}-${box.maxx} x ${box.miny}-${box.maxy} (w${box.maxx - box.minx})` : 'none', '| OLD', old ? `${old.minx}-${old.maxx} (w${old.w})` : 'n/a') // eslint-disable-line
  }
}

main()
