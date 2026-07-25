/**
 * build-layout-demo.mjs
 * -------------------------------------------------------------------------
 * Reproduces a real reference photo's charm arrangement as a seedable layout
 * for the live site (window.__charmeSeedLayout). For the chosen photo every
 * tracked piece becomes a placed charm at the same fractional position + real
 * measured size on an iPhone 16 Pro Max. The charm art is the piece's
 * nearestCutout cut-out (already copied to public/assets/charms/ref); pieces
 * with no link fall back to the catalogue charm of the closest long-edge size.
 * Run: node scripts/build-layout-demo.mjs [photoFileName]
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

const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
  const photoMeta = new Map(tracking.photos.map((p) => [p.photo, p]))

  // per-photo stats
  const byPhoto = new Map()
  for (const p of tracking.pieces) {
    if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, [])
    byPhoto.get(p.photo).push(p)
  }
  console.log('photo stats (pieces / linked):') // eslint-disable-line
  for (const [photo, pieces] of byPhoto) {
    const linked = pieces.filter((p) => p.nearestCutout).length
    console.log(`  ${photo}  ${pieces.length} / ${linked}`) // eslint-disable-line
  }

  const target = process.argv[2] || 'Image_20260618161922_515_813.jpg'
  const meta = photoMeta.get(target)
  const pieces = byPhoto.get(target)
  if (!meta || !pieces) throw new Error(`no such photo: ${target}`)
  const box = meta.caseBoxPx

  // catalogue sorted by long-edge mm, for size-based fallback art
  const bySize = catalog.charms
    .map((c) => ({ src: c.src, long: Math.max(c.widthMm, c.heightMm), name: c.name, category: c.category }))
    .sort((a, b) => a.long - b.long)
  const closestBySize = (mm) => bySize.reduce((best, c) =>
    Math.abs(c.long - mm) < Math.abs(best.long - mm) ? c : best, bySize[0])

  const charms = []
  for (const p of pieces) {
    // pieces-tracking pixelBox.x/y is the CENTRE of the piece (not top-left).
    const cxPx = p.pixelBox.x
    const cyPx = p.pixelBox.y
    const fracX = (cxPx - box.minx) / box.w
    const fracY = (cyPx - box.miny) / box.h
    const cxMm = +(fracX * PRODUCT_W).toFixed(2)
    const cyMm = +(fracY * PRODUCT_H).toFixed(2)
    const wMm = +((p.pctOfCaseW / 100) * PRODUCT_W).toFixed(2)
    const hMm = +((p.pctOfCaseH / 100) * PRODUCT_H).toFixed(2)
    let src = null
    let category = p.category || 'gold'
    let name = p.categoryName || p.id
    if (p.nearestCutout) {
      const cutId = p.nearestCutout.file.replace(/\.png$/i, '')
      const candidate = `/assets/charms/ref/${cutId}.png`
      if (await exists(join(ROOT, 'public', candidate))) src = candidate
    }
    if (!src) {
      const f = closestBySize(Math.max(wMm, hMm))
      src = f.src; category = f.category; name = `${name} (size-match)`
    }
    charms.push({ id: p.id, src, name, category, cxMm, cyMm, wMm, hMm, rot: 0 })
  }

  const layout = { productId: PRODUCT_ID, caseColourId: 'white', gelColourId: 'glitter', photo: target, charms }
  await mkdir(join(ROOT, 'public', '_demo'), { recursive: true })
  await writeFile(join(ROOT, 'public', '_demo', 'layout.json'), JSON.stringify(layout, null, 2))

  console.log(`\nchosen photo: ${target}`) // eslint-disable-line
  console.log(`charms: ${charms.length} (linked art: ${charms.filter((c) => !c.name.includes('size-match')).length})`) // eslint-disable-line
  console.log(`case box px: ${box.w}x${box.h}  -> product ${PRODUCT_W}x${PRODUCT_H}mm`) // eslint-disable-line
  console.log('wrote public/_demo/layout.json') // eslint-disable-line
}
main()
