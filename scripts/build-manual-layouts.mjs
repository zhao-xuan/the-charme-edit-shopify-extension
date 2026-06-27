/**
 * build-manual-layouts.mjs
 * -------------------------------------------------------------------------
 * Turns the hand-authored arrangements in reference/manual-layouts.json into a
 * seedable layout bundle (public/_demo/layouts.json) consumed by the screenshot
 * tooling. Each authored charm references a catalogue charm (by full `id`, by
 * `n` = suffix of the 7561dd4b gold reference collection, or by `name`) and a
 * fractional position on the iPhone 16 Pro Max case; the real measured mm size
 * comes from the catalogue so every charm keeps its true proportions.
 *
 * Run: node scripts/build-manual-layouts.mjs
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166

async function main() {
  const manual = JSON.parse(await readFile(join(ROOT, 'reference', 'manual-layouts.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
  const byId = new Map(catalog.charms.map((c) => [c.id, c]))
  const GOLD = manual.GOLD

  const resolve = (ch) => {
    let cat = null
    if (ch.id) cat = byId.get(ch.id)
    else if (ch.n) cat = byId.get(`${GOLD}-${ch.n}`)
    else if (ch.name) {
      cat =
        catalog.charms.find((c) => c.name === ch.name && c.category === 'gold') ||
        catalog.charms.find((c) => c.name === ch.name) ||
        catalog.charms.find(
          (c) => c.name.toLowerCase().includes(ch.name.toLowerCase()) && c.category === 'gold',
        )
    }
    if (!cat) throw new Error(`unresolved charm: ${JSON.stringify(ch)}`)
    return cat
  }

  const photos = []
  for (const [photo, def] of Object.entries(manual.photos)) {
    const charms = def.charms.map((ch, i) => {
      const cat = resolve(ch)
      const wMm = ch.wMm ?? cat.widthMm
      const hMm = ch.hMm ?? cat.heightMm
      return {
        id: `${photo}-${i}`,
        charmId: cat.id,
        src: cat.src,
        name: cat.name,
        category: cat.category,
        type: cat.type ?? 2,
        cxMm: +(ch.fx * PRODUCT_W).toFixed(2),
        cyMm: +(ch.fy * PRODUCT_H).toFixed(2),
        wMm: +wMm.toFixed(2),
        hMm: +hMm.toFixed(2),
        rot: ch.rot ?? 0,
      }
    })
    photos.push({
      photo,
      productId: PRODUCT_ID,
      caseColourId: def.caseColourId || 'black',
      charms,
    })
    console.log(`${photo}  ${charms.length} charms`) // eslint-disable-line
  }

  const out = {
    generatedAt: new Date().toISOString(),
    productId: PRODUCT_ID,
    caseColourId: 'black',
    authored: true,
    source: 'manual-layouts.json (hand-authored)',
    photos,
  }
  await mkdir(join(ROOT, 'public', '_demo'), { recursive: true })
  await writeFile(join(ROOT, 'public', '_demo', 'layouts.json'), JSON.stringify(out, null, 2))
  console.log(`\nwrote public/_demo/layouts.json with ${photos.length} photos`) // eslint-disable-line
}

main()
