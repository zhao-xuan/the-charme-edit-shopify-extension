/**
 * extract-missing-pieces.mjs
 * -------------------------------------------------------------------------
 * Cuts the catalogue's MISSING charm arts straight out of the real case photos
 * (1-charms-real-image) at their tracked boxes, runs the same enclosure-flood
 * matte as extract-precise-pieces.mjs, and registers each as a new catalogue
 * charm. Writes:
 *   reference/2-charms-extracted/<UUID>.png        (one-piece source crop)
 *   reference/3-charms-each-piece/<UUID>-01.png     (transparent cutout)
 *   public/assets/charms/ref/<UUID>-01.png          (catalogue art)
 * and appends rows to src/data/catalog.json + 3-charms-each-piece/manifest.json,
 * and repoints those P-ids in reference/piece-identities.json at the new art.
 *
 * Run: node scripts/extract-missing-pieces.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWork } from './_deskew.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const ASSETS = join(ROOT, 'public', 'assets', 'charms', 'ref')
const PRODUCT_W = 80.6, DET_H = 1800, PAD = 0.13

// one UUID for the whole missing-art set; arts get -01, -02, …
const SET = 'f1553077-9a1d-4e7c-bf0a-000000000abc'

// photo base -> [{ pid, name, category }]. category: gold/silver/colourful/unique.
const TARGETS = {
  '362_2327': [
    { pid: 'P231', name: 'Colourful Gem', category: 'colourful' },
    { pid: 'P234', name: 'Colourful Gem', category: 'colourful' },
  ],
  '359_2327': [
    { pid: 'P187', name: 'Natural Ceramic', category: 'unique' },
    { pid: 'P185', name: 'Colourful Heart', category: 'colourful' },
    { pid: 'P192', name: 'Colourful Heart', category: 'colourful' },
  ],
  '363_2327': [
    { pid: 'P252', name: 'Natural Star', category: 'unique' },
    { pid: 'P248', name: 'Natural Moon', category: 'unique' },
    { pid: 'P249', name: 'Natural Moon', category: 'unique' },
    { pid: 'P251', name: 'Natural Moon', category: 'unique' },
    { pid: 'P253', name: 'Natural Moon', category: 'unique' },
  ],
}

const dist = (r, g, b, br, bg, bb) => Math.hypot(r - br, g - bg, b - bb)
async function caseColorOf(data, W, H, C) {
  const hist = new Map()
  for (let p = 0; p < W * H; p++) {
    const i = p * C
    const key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4)
    let e = hist.get(key); if (!e) { e = [0, 0, 0, 0]; hist.set(key, e) }
    e[0] += data[i]; e[1] += data[i + 1]; e[2] += data[i + 2]; e[3]++
  }
  let best = null
  for (const e of hist.values()) if (!best || e[3] > best[3]) best = e
  return [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3])]
}
async function caseColor(realPath, box, S) {
  const { data, info } = await sharp(realPath).rotate()
    .extract({ left: Math.round(box.minx * S), top: Math.round(box.miny * S), width: Math.round(box.w * S), height: Math.round(box.h * S) })
    .resize({ width: 150 }).raw().toBuffer({ resolveWithObject: true })
  return caseColorOf(data, info.width, info.height, info.channels)
}
async function removeBg(buf, caseBg, T) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height, [br, bg, bb] = caseBg
  const near = (i) => dist(data[i], data[i + 1], data[i + 2], br, bg, bb) <= T
  const mask = new Uint8Array(w * h), q = []; let head = 0
  const seed = (idx) => { if (!mask[idx] && near(idx * 4)) { mask[idx] = 1; q.push(idx) } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (head < q.length) {
    const idx = q[head++], x = idx % w, y = (idx / w) | 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const n = ny * w + nx
      if (!mask[n] && near(n * 4)) { mask[n] = 1; q.push(n) }
    }
  }
  const R = Math.max(1, Math.round(Math.min(w, h) * 0.012))
  let cur = mask
  for (let pass = 0; pass < R; pass++) {
    const next = cur.slice()
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const idx = y * w + x; if (cur[idx]) continue
      if ((x > 0 && cur[idx - 1]) || (x < w - 1 && cur[idx + 1]) || (y > 0 && cur[idx - w]) || (y < h - 1 && cur[idx + w])) next[idx] = 1
    }
    cur = next
  }
  let kept = 0
  for (let p = 0; p < w * h; p++) { if (cur[p]) data[p * 4 + 3] = 0; else kept++ }
  return { buf: await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer(), keptFrac: kept / (w * h) }
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const caseRects = JSON.parse(await readFile(join(REF, 'case-rects.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(REF, '3-charms-each-piece', 'manifest.json'), 'utf8'))
  const ids = JSON.parse(await readFile(join(REF, 'piece-identities.json'), 'utf8'))
  const byPhotoPid = new Map(tracking.pieces.map((p) => [p.photo + p.id, p]))
  await mkdir(ASSETS, { recursive: true })
  let n = 0
  const added = []
  for (const [bk, list] of Object.entries(TARGETS)) {
    const photo = Object.keys(ids.photos).find((p) => p.includes('_' + bk + '.'))
    const base = photo.replace(/\.(jpe?g|png)$/i, '')
    const cr = caseRects[base]
    const box = { minx: cr.minx, miny: cr.miny, maxx: cr.maxx, maxy: cr.maxy, w: cr.maxx - cr.minx, h: cr.maxy - cr.miny }
    let realPath = join(REF, '1-charms-real-image', photo)
    try { await access(realPath, constants.F_OK) } catch { realPath = realPath.replace(/\.jpg$/i, '.png') }
    const full = await sharp(realPath).rotate().metadata()
    const S = full.height / DET_H
    const caseBg = await caseColor(realPath, box, S)
    const lum = 0.299 * caseBg[0] + 0.587 * caseBg[1] + 0.114 * caseBg[2]
    const T = lum < 70 ? 95 : 90
    const work = await makeWork(realPath, cr.tilt || 0)
    for (const tgt of list) {
      const p = byPhotoPid.get(photo + tgt.pid)
      const cw0 = p.pixelBox.w * (1 + 2 * PAD), ch0 = p.pixelBox.h * (1 + 2 * PAD)
      const cen = work.map((p.pixelBox.x + p.pixelBox.w / 2) * S, (p.pixelBox.y + p.pixelBox.h / 2) * S)
      let cw = Math.round(cw0 * S), ch = Math.round(ch0 * S)
      let left = Math.max(0, Math.round(cen[0] - cw / 2)), top = Math.max(0, Math.round(cen[1] - ch / 2))
      cw = Math.min(work.W - left, cw); ch = Math.min(work.H - top, ch)
      const crop = await sharp(work.buf).extract({ left, top, width: cw, height: ch }).resize({ width: Math.min(cw, 560) }).png().toBuffer()
      const cut = await removeBg(crop, caseBg, T)
      const trimmed = await sharp(cut.buf).trim({ threshold: 1 }).toBuffer()
      const meta = await sharp(trimmed).metadata()
      n++
      const id = `${SET}-${String(n).padStart(2, '0')}`
      await writeFile(join(REF, '2-charms-extracted', `${id}.png`), crop)
      await writeFile(join(REF, '3-charms-each-piece', `${id}.png`), trimmed)
      await writeFile(join(ASSETS, `${id}.png`), trimmed)
      manifest.pieces.push({ id, src: `${id}.png`, fromPhoto: `${base}.jpg`, pid: tgt.pid, pxW: meta.width, pxH: meta.height })
      catalog.charms.push({
        id, name: tgt.name, collection: 'Reference', category: tgt.category, major: tgt.category === 'unique' ? 'natural' : tgt.category,
        tier: 'midi', type: 2, price: 3, src: `/assets/charms/ref/${id}.png`, pxW: meta.width, pxH: meta.height,
        widthMm: +p.mmW.toFixed(1), heightMm: +p.mmH.toFixed(1), minScale: 0.8, maxScale: 1.5,
      })
      ids.photos[photo][tgt.pid] = `id:${id}`
      added.push(`${bk} ${tgt.pid} -> ${tgt.name} (${id.slice(-2)}) kept=${(cut.keptFrac * 100).toFixed(0)}% ${meta.width}x${meta.height}`)
    }
  }
  manifest.count = manifest.pieces.length
  await writeFile(join(REF, '3-charms-each-piece', 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(ROOT, 'src', 'data', 'catalog.json'), JSON.stringify(catalog, null, 2))
  await writeFile(join(REF, 'piece-identities.json'), JSON.stringify(ids, null, 2))
  console.log(added.join('\n'))
  console.log(`\nadded ${n} arts; catalog now ${catalog.charms.length}`)
}
main()
