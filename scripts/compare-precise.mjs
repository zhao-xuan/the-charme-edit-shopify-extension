/**
 * compare-precise.mjs — side-by-side of each real photo vs my extracted-piece
 * render. LEFT = real photo cropped to its caseBox, RIGHT = my black-case render
 * cropped to the case. Writes reference/_verify/_cmp_<base>.png + a montage.
 */
import sharp from 'sharp'
import { readFile, readdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWork } from './_deskew.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const VER = join(REF, '_verify')

const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }

async function caseCrop(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  // mask of dark (case) pixels at half resolution for speed
  const dark = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C
    if (Math.max(data[i], data[i + 1], data[i + 2]) < 90) dark[y * W + x] = 1
  }
  // largest connected component of dark pixels = the phone case (ignores the
  // app's dark UI text, which forms many small components)
  const seen = new Uint8Array(W * H)
  let best = null
  const st = []
  for (let s = 0; s < W * H; s++) {
    if (!dark[s] || seen[s]) continue
    st.length = 0; st.push(s); seen[s] = 1
    let minx = W, miny = H, maxx = 0, maxy = 0, area = 0
    while (st.length) {
      const p = st.pop()
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
      area++
      if (x > 0 && dark[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st.push(p - 1) }
      if (x < W - 1 && dark[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st.push(p + 1) }
      if (y > 0 && dark[p - W] && !seen[p - W]) { seen[p - W] = 1; st.push(p - W) }
      if (y < H - 1 && dark[p + W] && !seen[p + W]) { seen[p + W] = 1; st.push(p + W) }
    }
    if (!best || area > best.area) best = { minx, miny, maxx, maxy, area }
  }
  const b = best || { minx: 0, miny: 0, maxx: W - 1, maxy: H - 1 }
  const pad = 10
  const L = Math.max(0, b.minx - pad), T = Math.max(0, b.miny - pad)
  const cw = Math.min(W - L, b.maxx - b.minx + pad * 2), ch = Math.min(H - T, b.maxy - b.miny + pad * 2)
  return sharp(file).extract({ left: L, top: T, width: cw, height: ch }).resize({ height: 1100 }).png().toBuffer()
}

async function realCrop(base, b, tilt) {
  let p = join(REF, '1-charms-real-image', base + '.jpg')
  if (!(await exists(p))) p = join(REF, '1-charms-real-image', base + '.png')
  const im = await sharp(p).rotate().metadata()
  const S = im.height / 1800
  // straighten the photo (no-op when tilt≈0), then crop the axis-aligned case rect
  const work = await makeWork(p, tilt || 0)
  const cen = work.map(((b.minx + b.maxx) / 2) * S, ((b.miny + b.maxy) / 2) * S)
  const cw = b.w * S, ch = b.h * S
  let left = Math.round(cen[0] - cw / 2), top = Math.round(cen[1] - ch / 2)
  left = Math.max(0, left); top = Math.max(0, top)
  const width = Math.min(work.W - left, Math.round(cw)), height = Math.min(work.H - top, Math.round(ch))
  return sharp(work.buf).extract({ left, top, width, height }).resize({ height: 1100 }).png().toBuffer()
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const caseRects = JSON.parse(await readFile(join(REF, 'case-rects.json'), 'utf8'))
  // prefer the accurate case rect; fall back to caseBoxPx
  const metaByBase = new Map()
  for (const p of tracking.photos) {
    if (!p.caseBoxPx) continue
    const base = p.photo.replace(/\.(jpe?g|png)$/i, '')
    const cr = caseRects[base]
    const box = cr ? { minx: cr.minx, miny: cr.miny, maxx: cr.maxx, maxy: cr.maxy, w: cr.maxx - cr.minx, h: cr.maxy - cr.miny } : p.caseBoxPx
    metaByBase.set(base, { ...p, caseBoxPx: box, tilt: (cr && cr.tilt) || 0 })
  }
  const files = (await readdir(VER)).filter((f) => f.startsWith('_fp_') && f.endsWith('.png'))
  const tiles = []
  for (const f of files) {
    const base = f.replace(/^_fp_/, '').replace(/\.png$/, '')
    const meta = metaByBase.get(base)
    if (!meta) continue
    const real = await realCrop(base, meta.caseBoxPx, meta.tilt)
    const mine = await caseCrop(join(VER, f))
    const rM = await sharp(real).metadata(), mM = await sharp(mine).metadata()
    const gap = 24
    const cmp = await sharp({ create: { width: rM.width + gap + mM.width, height: 1100, channels: 4, background: '#ffffff' } })
      .composite([{ input: real, left: 0, top: 0 }, { input: mine, left: rM.width + gap, top: 0 }]).png().toBuffer()
    await sharp(cmp).toFile(join(VER, `_cmp_${base}.png`))
    tiles.push({ base, buf: await sharp(cmp).resize({ height: 420 }).png().toBuffer() })
    console.log(base) // eslint-disable-line
  }
  // montage 3 cols
  tiles.sort((a, b) => a.base.localeCompare(b.base))
  const cols = 3, pad = 10
  let cellW = 0, cellH = 0
  for (const t of tiles) { const m = await sharp(t.buf).metadata(); cellW = Math.max(cellW, m.width); cellH = Math.max(cellH, m.height) }
  const rows = Math.ceil(tiles.length / cols)
  const comp = []
  for (let i = 0; i < tiles.length; i++) comp.push({ input: tiles[i].buf, left: pad + (i % cols) * (cellW + pad), top: pad + Math.floor(i / cols) * (cellH + pad) })
  await sharp({ create: { width: cols * cellW + (cols + 1) * pad, height: rows * cellH + (rows + 1) * pad, channels: 4, background: '#333333' } })
    .composite(comp).png().toFile(join(VER, '_ALL_compare.png'))
  console.log('\nmontage: reference/_verify/_ALL_compare.png') // eslint-disable-line
}
main()
