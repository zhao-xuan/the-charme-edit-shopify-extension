// Best-effort faithful re-key of the 5 cream/white ceramic charms (plumeria,
// two cherubs, Ionic column, clasp). They sit on a white seamless with very low
// contrast, so we locate each in its sheet by template match, crop the raw
// region, and key it as a solid silhouette with low thresholds.
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
  { id: 'e7e403b5-ce76-47e7-808b-f552fdf2b7e9-11', sheet: 'E7E403B5-CE76-47E7-808B-F552FDF2B7E9.png' },
  { id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-11', sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png' },
  { id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-20', sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png' },
  // 52e483c2-...-31 ("Natural Pin") intentionally omitted: its degraded cutout
  // can't be located reliably in the sheet, so it's hidden in catalog.json.
  { id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-32', sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png' },
]
const OPTS = { binT: 15, softLo: 7, softHi: 34 }

const dW = (r, g, b) => { const a = 255 - r, c = 255 - g, d = 255 - b; return Math.sqrt(a * a + c * c + d * d) }
async function inkMap(input, F) {
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  const w = Math.floor(W / F), h = Math.floor(H / F), ink = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0
    for (let dy = 0; dy < F; dy++) for (let dx = 0; dx < F; dx++) { const sx = x * F + dx, sy = y * F + dy; if (sx < W && sy < H) { const i = (sy * W + sx) * ch; s += dW(data[i], data[i + 1], data[i + 2]); n++ } }
    ink[y * w + x] = s / n
  }
  return { ink, w, h, W, H }
}
function trimInk(t) {
  let a = t.w, b = t.h, c = -1, d = -1
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) if (t.ink[y * t.w + x] > 12) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y }
  if (c < 0) { a = 0; b = 0; c = t.w - 1; d = t.h - 1 }
  const tw = c - a + 1, th = d - b + 1, ink = new Float32Array(tw * th)
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) ink[y * tw + x] = t.ink[(y + b) * t.w + (x + a)]
  return { ink, w: tw, h: th }
}
function match(S, Tt, F) {
  const { ink: s, w: SW, h: SH } = S, { ink: tk, w: TW, h: TH } = Tt
  let ws = 0; for (const v of tk) ws += v
  let best = Infinity, bx = 0, by = 0
  for (let oy = 0; oy + TH <= SH; oy++) for (let ox = 0; ox + TW <= SW; ox++) {
    let acc = 0
    for (let y = 0; y < TH; y++) { const sr = (oy + y) * SW + ox, tr = y * TW; for (let x = 0; x < TW; x++) { const t = tk[tr + x]; acc += t * Math.abs(s[sr + x] - t) } if (acc >= best * ws) { acc = Infinity; break } }
    if (acc < best * ws) { best = acc / ws; bx = ox; by = oy }
  }
  return { x: bx * F, y: by * F, w: TW * F, h: TH * F, score: best }
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, CATALOG), 'utf8'))
  const byId = new Map(catalog.charms.map((c) => [c.id, c]))
  const F = 4
  for (const t of TARGETS) {
    const sp = path.join(ROOT, SHEETS, t.sheet)
    const S = await inkMap(sp, F)
    const tmpl = trimInk(await inkMap(path.join(ROOT, PIECE, t.id + '.png'), F))
    const m = match(S, tmpl, F)
    const pad = 16, L = Math.max(0, m.x - pad), Tp = Math.max(0, m.y - pad)
    const cw = Math.min(S.W - L, m.w + pad * 2), chh = Math.min(S.H - Tp, m.h + pad * 2)
    const cropRel = `${CROPS}/${t.id}.png`
    await sharp(sp).extract({ left: L, top: Tp, width: cw, height: chh }).png().toFile(path.join(ROOT, cropRel))
    const { buf, pxW, pxH } = await rekey(t.id, cropRel, true, OPTS)
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
    console.log(`${t.id.slice(0, 4)}-${t.id.slice(-2)}  match@(${m.x},${m.y}) ${m.w}x${m.h} s=${m.score.toFixed(1)} -> ${pxW}x${pxH}`)
  }
  fs.writeFileSync(path.join(ROOT, CATALOG), JSON.stringify(catalog, null, 2) + '\n')
  console.log('done')
}
main()
