// Montage only the customizer charms that the auto-matcher left unmatched, at a
// larger tile size for clearer visual identification.
import { readFileSync, existsSync } from 'fs'
import sharp from 'sharp'

const draft = JSON.parse(readFileSync('reference/charm-map-draft.json', 'utf8'))
const cat = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = Array.isArray(cat) ? cat : cat.charms || Object.values(cat)

const repSrc = new Map()
for (const c of charms) if (!repSrc.has(c.name)) repSrc.set(c.name, { src: c.src, price: c.price, cat: c.category })

const names = Object.keys(draft).filter((n) => !draft[n].match)
console.log('unmatched:', names.length)

const CELL = 260
const COLS = 6
const ROWS = Math.ceil(names.length / COLS)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const tiles = []
for (const name of names) {
  const r = repSrc.get(name)
  const local = 'public' + r.src
  if (!existsSync(local)) { tiles.push(null); continue }
  const img = await sharp(local).resize(CELL, CELL - 30, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).toBuffer().catch(() => null)
  if (!img) { tiles.push(null); continue }
  const svg = Buffer.from(`<svg width="${CELL}" height="${CELL}"><rect width="${CELL}" height="${CELL}" fill="#fbf3f3"/><text x="5" y="${CELL - 16}" font-size="13" fill="#111">${esc(name)}</text><text x="5" y="${CELL - 3}" font-size="10" fill="#777">${r.cat} £${r.price}</text></svg>`)
  tiles.push(await sharp(svg).composite([{ input: img, top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer())
}

const composites = tiles.map((buf, i) => buf ? ({ input: buf, top: Math.floor(i / COLS) * CELL, left: (i % COLS) * CELL }) : null).filter(Boolean)
await sharp({ create: { width: COLS * CELL, height: ROWS * CELL, channels: 3, background: '#fff' } })
  .composite(composites).jpeg({ quality: 82 }).toFile('reference/_match/unmatched-montage.jpg')
console.log('saved reference/_match/unmatched-montage.jpg')
