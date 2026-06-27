/**
 * build-authored-layouts.mjs
 * -------------------------------------------------------------------------
 * Reproduces the REAL charm arrangement of every reference photo in
 * reference/1-charms-real-image/ as a seedable layout for the live customizer
 * (window.__charmeSeedLayout), so each photo can be re-created on a black
 * iPhone 16 Pro Max case and screenshotted.
 *
 * Positions come straight from the MEASURED data in reference/pieces-tracking.json
 * (pixelBox.x/y is the piece CENTRE in the photo's downscaled detection space).
 * For each piece:
 *   fracX = (pixelBox.x - caseBox.minx) / caseBox.w
 *   fracY = (pixelBox.y - caseBox.miny) / caseBox.h
 *   cxMm  = fracX * 80.6   cyMm = fracY * 166   (iPhone 16 Pro Max footprint)
 * Size is the measured mmW/mmH. Art is the piece's nearestCutout cut-out
 * (public/assets/charms/ref/<id>.png); pieces with no link fall back to the
 * closest catalogue charm (same category first) by long-edge size.
 *
 * Run: node scripts/build-authored-layouts.mjs
 * Output: public/_demo/layouts.json  (consumed by the screenshot tooling)
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')

// iPhone 16 Pro Max case footprint used by the app (src/data/products.js).
const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166
const CASE_COLOUR = 'black' // requested: black iPhone 16 Pro Max

const exists = async (p) => {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))

  const charmById = new Map(catalog.charms.map((c) => [c.id, c]))

  // catalogue sorted by long-edge mm, for size-based fallback art.
  const bySize = catalog.charms
    .map((c) => ({
      id: c.id,
      src: c.src,
      long: Math.max(c.widthMm, c.heightMm),
      name: c.name,
      category: c.category,
      type: c.type,
      price: c.price,
    }))
    .sort((a, b) => a.long - b.long)
  const closestBySize = (mm, category) => {
    const pool = bySize.filter((c) => !category || c.category === category)
    const arr = pool.length ? pool : bySize
    return arr.reduce(
      (best, c) => (Math.abs(c.long - mm) < Math.abs(best.long - mm) ? c : best),
      arr[0],
    )
  }

  const photoMeta = new Map(tracking.photos.map((p) => [p.photo, p]))
  const byPhoto = new Map()
  for (const p of tracking.pieces) {
    if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, [])
    byPhoto.get(p.photo).push(p)
  }

  const photos = []
  for (const [photo, meta] of photoMeta) {
    const pieces = byPhoto.get(photo)
    if (!pieces || !pieces.length) continue
    const box = meta.caseBoxPx
    const charms = []
    let linked = 0
    for (const p of pieces) {
      const fracX = (p.pixelBox.x - box.minx) / box.w
      const fracY = (p.pixelBox.y - box.miny) / box.h
      const cxMm = +(fracX * PRODUCT_W).toFixed(2)
      const cyMm = +(fracY * PRODUCT_H).toFixed(2)
      const wMm = +(p.mmW ?? (p.pctOfCaseW / 100) * PRODUCT_W).toFixed(2)
      const hMm = +(p.mmH ?? (p.pctOfCaseH / 100) * PRODUCT_H).toFixed(2)

      let src = null
      let category = p.category || 'gold'
      let name = p.categoryName || p.id
      let type = 2
      let price = 3

      if (p.nearestCutout) {
        const cutId = p.nearestCutout.file.replace(/\.png$/i, '')
        const candidate = `/assets/charms/ref/${cutId}.png`
        if (await exists(join(ROOT, 'public', candidate))) {
          src = candidate
          const cat = charmById.get(cutId)
          if (cat) {
            name = cat.name
            category = cat.category
            type = cat.type ?? 2
            price = cat.price ?? 3
          }
          linked++
        }
      }
      if (!src) {
        const f = closestBySize(Math.max(wMm, hMm), category)
        src = f.src
        category = f.category
        type = f.type ?? 2
        price = f.price ?? 3
        name = f.name
      }

      charms.push({
        id: `${photo}-${charms.length}`,
        src,
        name,
        category,
        type,
        cxMm,
        cyMm,
        wMm,
        hMm,
        rot: 0,
      })
    }
    photos.push({ photo, productId: PRODUCT_ID, caseColourId: CASE_COLOUR, charms })
    console.log(`${photo}  ${charms.length} charms (${linked} cut-out / ${charms.length - linked} size-match)`) // eslint-disable-line
  }

  const out = {
    generatedAt: new Date().toISOString(),
    productId: PRODUCT_ID,
    caseColourId: CASE_COLOUR,
    authored: true,
    source: 'pieces-tracking.json (measured positions)',
    photos,
  }
  await mkdir(join(ROOT, 'public', '_demo'), { recursive: true })
  await writeFile(join(ROOT, 'public', '_demo', 'layouts.json'), JSON.stringify(out, null, 2))
  console.log(`\nwrote public/_demo/layouts.json with ${photos.length} photos`) // eslint-disable-line
}

main()
