// Montage the customizer charms (one representative tile per distinct name,
// but keep every charm id listed) so we can visually match them to Shopify
// charm variants. Output: reference/_match/customizer-montage-*.jpg
import { readFileSync, mkdirSync, existsSync } from 'fs'
import sharp from 'sharp'

const ROOT = 'reference/_match'
mkdirSync(ROOT, { recursive: true })

const cat = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = Array.isArray(cat) ? cat : cat.charms || Object.values(cat)

// One representative per distinct name, sorted by category then name so similar
// charms sit together. Also record how many ids share the name.
const byName = new Map()
for (const c of charms) {
  const k = c.name
  if (!byName.has(k)) byName.set(k, { name: k, category: c.category, price: c.price, src: c.src, count: 0 })
  byName.get(k).count++
}
const cells = [...byName.values()].sort(
  (a, b) => (a.category + a.name).localeCompare(b.category + b.name),
)
console.log('distinct customizer charm names:', cells.length)

const CELL = 200
const COLS = 8
const ROWS = 6
const PER = COLS * ROWS

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

async function tile(cell) {
  const local = 'public' + cell.src
  if (!existsSync(local)) return null
  const img = await sharp(local)
    .resize(CELL, CELL - 30, { fit: 'contain', background: '#fff' })
    .flatten({ background: '#fff' })
    .toBuffer()
    .catch(() => null)
  if (!img) return null
  const label = `${esc(cell.name.slice(0, 24))}`
  const sub = `${cell.category} £${cell.price} ×${cell.count}`
  const svg = Buffer.from(
    `<svg width="${CELL}" height="${CELL}"><rect width="${CELL}" height="${CELL}" fill="#f2f7fa"/><text x="4" y="${CELL - 18}" font-size="10" fill="#222">${label}</text><text x="4" y="${CELL - 6}" font-size="9" fill="#666">${esc(sub)}</text></svg>`,
  )
  return sharp(svg).composite([{ input: img, top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer()
}

const pages = Math.ceil(cells.length / PER)
for (let pg = 0; pg < pages; pg++) {
  const slice = cells.slice(pg * PER, pg * PER + PER)
  const tiles = []
  for (const c of slice) {
    const t = await tile(c)
    if (t) tiles.push(t)
  }
  const composites = tiles.map((buf, i) => ({
    input: buf,
    top: Math.floor(i / COLS) * CELL,
    left: (i % COLS) * CELL,
  }))
  await sharp({ create: { width: COLS * CELL, height: ROWS * CELL, channels: 3, background: '#fff' } })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toFile(`${ROOT}/customizer-montage-${pg + 1}.jpg`)
  console.log(`page ${pg + 1}/${pages}: ${tiles.length} tiles`)
}
console.log('done')
