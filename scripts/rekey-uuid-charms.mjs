// Re-key the recoverable (colour-bearing) UUID collage charms: the yellow
// flower and the two agate stones. Each existing cutout is matched back into its
// source sheet (to recover the full, un-bitten piece), the raw region is cropped
// out, then run through the shared robust keyer. The white/translucent pieces
// (cloud, dog, rabbit, pin, vial) are NOT handled here — they vanish on the
// white seamless and are regenerated separately.
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { rekey } from './rekey-broken-charms.mjs'

const ROOT = process.cwd()
const SHEETS = 'reference/2-charms-extracted'
const PIECE = 'reference/3-charms-each-piece'
const CROPS = 'reference/_uuid-crops'
const REF = 'public/assets/charms/ref'
const CATALOG = 'src/data/catalog.json'
fs.mkdirSync(path.join(ROOT, CROPS), { recursive: true })

const TARGETS = [
  { id: 'e7e403b5-ce76-47e7-808b-f552fdf2b7e9-15', sheet: 'E7E403B5-CE76-47E7-808B-F552FDF2B7E9.png', solid: false },
  { id: 'e540ac60-3ca6-447f-833a-9234eec3b235-09', sheet: 'E540AC60-3CA6-447F-833A-9234EEC3B235.png', solid: true },
  { id: 'e540ac60-3ca6-447f-833a-9234eec3b235-10', sheet: 'E540AC60-3CA6-447F-833A-9234EEC3B235.png', solid: true },
]

const distWhite = (r, g, b) => { const dr = 255 - r, dg = 255 - g, db = 255 - b; return Math.sqrt(dr * dr + dg * dg + db * db) }

// ink map (colour distance from white) at 1/F resolution
async function inkMap(input, F) {
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  const w = Math.max(1, Math.floor(W / F)), h = Math.max(1, Math.floor(H / F))
  const ink = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0
    for (let dy = 0; dy < F; dy++) for (let dx = 0; dx < F; dx++) {
      const sx = x * F + dx, sy = y * F + dy
      if (sx < W && sy < H) { const i = (sy * W + sx) * ch; s += distWhite(data[i], data[i + 1], data[i + 2]); n++ }
    }
    ink[y * w + x] = s / n
  }
  return { ink, w, h, W, H }
}

// trim a template ink map to its content bounding box
function trimInk(t) {
  let minx = t.w, miny = t.h, maxx = -1, maxy = -1
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
    if (t.ink[y * t.w + x] > 18) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
  }
  if (maxx < 0) { minx = 0; miny = 0; maxx = t.w - 1; maxy = t.h - 1 }
  const tw = maxx - minx + 1, th = maxy - miny + 1
  const ink = new Float32Array(tw * th)
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) ink[y * tw + x] = t.ink[(y + miny) * t.w + (x + minx)]
  return { ink, w: tw, h: th, minx, miny }
}

// slide template over sheet, weighted-L1 on ink; return best full-res bbox
function match(sheet, tmpl, F) {
  const { ink: S, w: SW, h: SH } = sheet
  const { ink: T, w: TW, h: TH } = tmpl
  let wsum = 0
  for (let i = 0; i < T.length; i++) wsum += T[i]
  let best = Infinity, bx = 0, by = 0
  for (let oy = 0; oy + TH <= SH; oy++) {
    for (let ox = 0; ox + TW <= SW; ox++) {
      let acc = 0
      for (let y = 0; y < TH; y++) {
        const srow = (oy + y) * SW + ox, trow = y * TW
        for (let x = 0; x < TW; x++) {
          const t = T[trow + x]
          acc += t * Math.abs(S[srow + x] - t)
        }
        if (acc >= best * wsum) { acc = Infinity; break }
      }
      if (acc < best * wsum) { best = acc / wsum; bx = ox; by = oy }
    }
  }
  return { x: bx * F, y: by * F, w: TW * F, h: TH * F, score: best }
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, CATALOG), 'utf8'))
  const byId = new Map(catalog.charms.map((c) => [c.id, c]))
  const F = 4
  for (const t of TARGETS) {
    const sheetPath = path.join(ROOT, SHEETS, t.sheet)
    const cutoutPath = path.join(ROOT, PIECE, t.id + '.png')
    const sheet = await inkMap(sheetPath, F)
    const tmpl0 = await inkMap(cutoutPath, F)
    const tmpl = trimInk(tmpl0)
    const m = match(sheet, tmpl, F)
    // crop raw region from the sheet with margin
    const pad = 14
    const L = Math.max(0, m.x - pad), Tp = Math.max(0, m.y - pad)
    const cw = Math.min(sheet.W - L, m.w + pad * 2), chh = Math.min(sheet.H - Tp, m.h + pad * 2)
    const cropRel = `${CROPS}/${t.id}.png`
    await sharp(sheetPath).extract({ left: L, top: Tp, width: cw, height: chh }).png().toFile(path.join(ROOT, cropRel))
    // re-key
    const { buf, pxW, pxH } = await rekey(t.id, cropRel, t.solid)
    fs.writeFileSync(path.join(ROOT, REF, t.id + '.png'), buf)
    const pf = path.join(ROOT, PIECE, t.id + '.png')
    if (fs.existsSync(pf)) fs.writeFileSync(pf, buf)
    const c = byId.get(t.id)
    if (c) {
      const longMm = Math.max(c.widthMm, c.heightMm)
      if (pxW >= pxH) { c.widthMm = +longMm.toFixed(1); c.heightMm = +(longMm * pxH / pxW).toFixed(1) }
      else { c.heightMm = +longMm.toFixed(1); c.widthMm = +(longMm * pxW / pxH).toFixed(1) }
      c.pxW = pxW; c.pxH = pxH
    }
    console.log(`${t.id.slice(0, 4)}-${t.id.slice(-2)}  match@(${m.x},${m.y}) ${m.w}x${m.h} score=${m.score.toFixed(1)} -> ${pxW}x${pxH}`)
  }
  fs.writeFileSync(path.join(ROOT, CATALOG), JSON.stringify(catalog, null, 2) + '\n')
  console.log('done — 3 colored UUID charms re-keyed + catalog updated')
}
main()
