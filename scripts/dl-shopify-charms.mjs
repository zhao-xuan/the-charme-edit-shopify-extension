// Download every Shopify add-on charm variant image and montage them (labelled
// with variant id + price + title) so we can visually match each customizer
// charm to a Shopify variant. Output: reference/_match/shopify-montage-*.jpg
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import sharp from 'sharp'

const ROOT = 'reference/_match'
const IMG = `${ROOT}/shopify`
mkdirSync(IMG, { recursive: true })

const products = JSON.parse(readFileSync('reference/shopify-charms.json', 'utf8'))

// Flatten to one entry per variant, choosing the variant image or the product's
// first image as a fallback.
const cells = []
for (const p of products) {
  for (const v of p.variants) {
    const src = v.img || p.images[0] || null
    if (!src) continue
    cells.push({ id: v.id, price: v.price, product: p.title, vtitle: v.title, src })
  }
}
console.log('variants to fetch:', cells.length)

async function dl(url, dest) {
  if (existsSync(dest)) return
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await pipeline(res.body, createWriteStream(dest))
}

const CELL = 200
const COLS = 8
const ROWS = 6
const PER = COLS * ROWS

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

async function tile(cell) {
  const dest = `${IMG}/${cell.id}.jpg`
  try {
    await dl(cell.src.split('?')[0], dest)
  } catch (e) {
    return null
  }
  const img = await sharp(dest)
    .resize(CELL, CELL - 34, { fit: 'contain', background: '#fff' })
    .toBuffer()
    .catch(() => null)
  if (!img) return null
  const label = `£${cell.price} ${esc((cell.product + ' / ' + cell.vtitle).slice(0, 22))}`
  const svg = Buffer.from(
    `<svg width="${CELL}" height="${CELL}"><rect width="${CELL}" height="${CELL}" fill="#faf7f2"/><text x="4" y="${CELL - 20}" font-size="10" fill="#333">${esc(String(cell.id))}</text><text x="4" y="${CELL - 8}" font-size="9" fill="#666">${label}</text></svg>`,
  )
  return sharp(svg)
    .composite([{ input: img, top: 0, left: 0 }])
    .jpeg({ quality: 78 })
    .toBuffer()
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
  await sharp({
    create: { width: COLS * CELL, height: ROWS * CELL, channels: 3, background: '#fff' },
  })
    .composite(composites)
    .jpeg({ quality: 78 })
    .toFile(`${ROOT}/shopify-montage-${pg + 1}.jpg`)
  console.log(`page ${pg + 1}/${pages}: ${tiles.length} tiles`)
}
console.log('done')
