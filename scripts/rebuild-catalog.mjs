/**
 * rebuild-catalog.mjs
 * -------------------------------------------------------------------------
 * Rebuilds src/data/catalog.json from the categorised reference cut-outs
 * (reference/charm-categories.json + 3-charms-each-piece), replacing the old
 * scraped catalogue. Copies each cut-out PNG into public/assets/charms/ref/ so
 * the standalone site can serve it.
 *
 * Sizes (mm): per-source calibration. The real charms were measured on the
 * cases (pieces-tracking.json mmLong); each tracked piece weakly links to a
 * cut-out (nearestCutout). For every source collage we take the median
 * mm-per-pixel of its linked cut-outs; collages without enough links fall back
 * to the global median (measured-median-mm / cut-out-median-px).
 *
 * Run: node scripts/rebuild-catalog.mjs
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const CUTOUT_DIR = join(REF, '3-charms-each-piece')
const OUT_ASSETS = join(ROOT, 'public', 'assets', 'charms', 'ref')

const SUB_LABEL = {
  letter: 'Letters & initials', number: 'Numbers', zodiac: 'Zodiac signs', celestial: 'Celestial',
  angel: 'Angels & cherubs', symbol: 'Symbols & icons', animal: 'Animals', flower: 'Flowers', heart: 'Hearts',
  star: 'Stars', moon: 'Moons', bow: 'Bows', fruit: 'Fruit', shell: 'Shells', pearl: 'Pearls', stone: 'Stones',
  gem: 'Crystals & gems', pottery: 'Sea pottery', ceramic: 'Ceramic', coral: 'Coral', other: 'One of a kind',
}
// subcategory display order within a category tab
const SUB_ORDER = ['letter', 'number', 'zodiac', 'celestial', 'star', 'moon', 'heart', 'flower', 'bow', 'angel',
  'animal', 'fruit', 'symbol', 'shell', 'pearl', 'stone', 'gem', 'coral', 'pottery', 'ceramic', 'other']
const MAJOR_ORDER = ['gold', 'silver', 'colourful', 'natural']
const CATEGORY_KEY = { gold: 'gold', silver: 'silver', colourful: 'colourful', natural: 'unique' }
const ZODIAC_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']

const median = (arr) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

async function main() {
  const cat = JSON.parse(await readFile(join(REF, 'charm-categories.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(CUTOUT_DIR, 'manifest.json'), 'utf8'))
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const photoById = new Map(manifest.pieces.map((p) => [p.id, p.fromPhoto]))

  // --- calibration -------------------------------------------------------
  const measuredMm = tracking.pieces.map((p) => p.mmLong).filter(Boolean)
  const cutoutPx = manifest.pieces.map((p) => Math.max(p.pxW, p.pxH))
  const R0 = median(measuredMm) / median(cutoutPx) // global mm-per-px
  // reverse links: cutoutId -> [mmLong of pieces that point at it]
  const linkMm = new Map()
  for (const p of tracking.pieces) {
    const f = p.nearestCutout && p.nearestCutout.file
    if (!f) continue
    const id = f.replace(/\.png$/i, '')
    if (!linkMm.has(id)) linkMm.set(id, [])
    linkMm.get(id).push(p.mmLong)
  }
  // per-source ratio (mm per cut-out px) from linked cut-outs
  const pxById = new Map(manifest.pieces.map((p) => [p.id, Math.max(p.pxW, p.pxH)]))
  const sourceRatios = new Map()
  for (const [id, mms] of linkMm) {
    const px = pxById.get(id)
    const photo = photoById.get(id)
    if (!px || !photo) continue
    const r = median(mms) / px
    if (!sourceRatios.has(photo)) sourceRatios.set(photo, [])
    sourceRatios.get(photo).push(r)
  }
  const sourceScale = new Map()
  for (const [photo, ratios] of sourceRatios) {
    sourceScale.set(photo, ratios.length >= 4 ? clamp(median(ratios), 0.6 * R0, 1.7 * R0) : R0)
  }
  // The nearestCutout links are weak (advisory, scores ~45-51), so the per-source
  // medians are noisy (≈2x spread, one 0.065 outlier that would make letters
  // tiny). Size every cut-out with the robust GLOBAL mm-per-px instead; the
  // per-source values are kept in the output only for transparency. Exact
  // physical sizes for the on-case demo come straight from pieces-tracking.json.
  const scaleFor = () => R0

  // --- build charms ------------------------------------------------------
  await rm(OUT_ASSETS, { recursive: true, force: true })
  await mkdir(OUT_ASSETS, { recursive: true })

  const charms = []
  for (const c of cat.charms) {
    const s = scaleFor(c.id)
    let wMm = c.pxW * s
    let hMm = c.pxH * s
    const longMm = Math.max(wMm, hMm)
    if (longMm < 4 || longMm > 62) {
      const k = clamp(longMm, 4, 62) / longMm
      wMm *= k; hMm *= k
    }
    wMm = +wMm.toFixed(1); hMm = +hMm.toFixed(1)
    const lng = Math.max(wMm, hMm)
    const natural = c.major === 'natural'
    const tiny = ['stone', 'pearl', 'pottery', 'ceramic', 'gem', 'seaglass'].includes(c.sub)
    let type, tier, minScale, maxScale
    if (tiny && lng < 14) { type = 3; tier = 'mini'; minScale = 1; maxScale = 1 }
    else if (lng >= 28) { type = 1; tier = 'grande'; minScale = 0.9; maxScale = 1.3 }
    else { type = 2; tier = 'midi'; minScale = 0.8; maxScale = 1.5 }
    const price = type === 3 ? 2 : type === 1 ? 5 : 3

    await copyFile(join(CUTOUT_DIR, c.src), join(OUT_ASSETS, `${c.id}.png`))

    charms.push({
      id: c.id,
      name: c.name,
      collection: SUB_LABEL[c.sub] || c.sub,
      category: CATEGORY_KEY[c.major],
      major: c.major,
      subcategory: c.sub,
      subLabel: SUB_LABEL[c.sub] || c.sub,
      charmLabel: c.label || undefined,
      tier,
      type,
      price,
      src: `/assets/charms/ref/${c.id}.png`,
      pxW: c.pxW,
      pxH: c.pxH,
      widthMm: wMm,
      heightMm: hMm,
      minScale,
      maxScale,
    })
  }

  // --- sort for nice tray order -----------------------------------------
  const subRank = (s) => { const i = SUB_ORDER.indexOf(s); return i < 0 ? 99 : i }
  const labelRank = (c) => {
    if (c.subcategory === 'letter') return c.charmLabel ? c.charmLabel.charCodeAt(0) : 999
    if (c.subcategory === 'number') return c.charmLabel ? +c.charmLabel : 999
    if (c.subcategory === 'zodiac') { const i = ZODIAC_ORDER.indexOf(c.charmLabel); return i < 0 ? 999 : i }
    return 0
  }
  charms.sort((a, b) =>
    MAJOR_ORDER.indexOf(a.major) - MAJOR_ORDER.indexOf(b.major) ||
    subRank(a.subcategory) - subRank(b.subcategory) ||
    labelRank(a) - labelRank(b) ||
    a.name.localeCompare(b.name))

  const counts = { grande: 0, midi: 0, mini: 0, total: charms.length }
  for (const c of charms) counts[c.tier]++
  const byMajor = {}
  for (const c of charms) byMajor[c.major] = (byMajor[c.major] || 0) + 1

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'reference/3-charms-each-piece (real charm photos, categorised + measured)',
    calibration: { globalMmPerPx: +R0.toFixed(4), perSource: Object.fromEntries([...sourceScale].map(([k, v]) => [k, +v.toFixed(4)])) },
    counts,
    byMajor,
    charms,
  }
  await writeFile(join(ROOT, 'src', 'data', 'catalog.json'), JSON.stringify(out, null, 2) + '\n')

  console.log(`wrote ${charms.length} charms -> src/data/catalog.json`) // eslint-disable-line
  console.log('byMajor', byMajor, 'tiers', counts) // eslint-disable-line
  console.log('globalMmPerPx', R0.toFixed(4), 'sources calibrated:', sourceScale.size) // eslint-disable-line
  const lens = charms.map((c) => Math.max(c.widthMm, c.heightMm)).sort((a, b) => a - b)
  console.log('charm longMm: min', lens[0], 'med', lens[Math.floor(lens.length / 2)], 'max', lens[lens.length - 1]) // eslint-disable-line
}
main()
