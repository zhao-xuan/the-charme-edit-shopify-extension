/**
 * dedupe-extracted.mjs
 * -------------------------------------------------------------------------
 * Compares the de-shadowed reference/extracted-charms against the GOLD charms
 * already in the bundled catalogue (src/data/catalog.json, category=gold) to
 * find duplicates — the reference photos were of charms that mostly already
 * exist in the catalogue, so we don't want to import the same charm twice.
 *
 * Matching is by SHAPE: each cut-out's alpha silhouette is normalised to a
 * 32×32 occupancy grid and compared by Hamming distance (rotation-robust enough
 * for these upright charms). It writes a report (reference/dedupe-report.json)
 * marking each extracted charm as `duplicate` (with its best gold match) or
 * `unique`, plus a similarity score, so the import step can skip duplicates.
 *
 * Run:  node scripts/dedupe-extracted.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const EXTRACTED = join(ROOT, 'reference', 'extracted-charms')
const GOLD_DIR = join(ROOT, 'public', 'assets', 'charms')
const CATALOG = join(ROOT, 'src', 'data', 'catalog.json')

const GRID = 32
const DUP_THRESHOLD = 0.12 // ≤12% of cells differ → same shape

// classify a catalogue charm's category exactly like src/lib/catalog.js
const UNIQUE_WORDS = ['shell', 'pearl', 'stone', 'ceramic', 'abalone', 'sunstone', 'coral', 'marble', 'porcelain', 'amber', 'orb', 'crystal', 'amulet', 'reliquary', 'riviera', 'treasure', 'pebble', 'nacre']
const has = (s, words) => words.some((w) => s.includes(w))
function charmCategory(charm) {
  const s = `${charm.name} ${charm.collection}`.toLowerCase()
  if (has(s, UNIQUE_WORDS)) return 'unique'
  if (s.includes('silver')) return 'silver'
  if (s.includes('gold') || s.includes('brass') || charm.collection === 'Letters & Initials' || charm.collection === 'Numbers') return 'gold'
  return 'colourful'
}

/** Normalised 32×32 alpha-occupancy bitmap (trimmed to content, then resized). */
async function silhouette(file) {
  const img = sharp(file).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 60) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
  }
  if (maxx < 0) return null
  const bw = maxx - minx + 1, bh = maxy - miny + 1
  const bits = new Uint8Array(GRID * GRID)
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const sx = minx + Math.floor((gx + 0.5) / GRID * bw)
    const sy = miny + Math.floor((gy + 0.5) / GRID * bh)
    bits[gy * GRID + gx] = data[(sy * W + sx) * 4 + 3] > 60 ? 1 : 0
  }
  return { bits, aspect: bw / bh }
}

function diff(a, b) {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d / a.length
}

const catalog = JSON.parse(await readFile(CATALOG, 'utf8'))
const goldCharms = catalog.charms.filter((c) => charmCategory(c) === 'gold')
console.log(`Gold catalogue charms: ${goldCharms.length}`) // eslint-disable-line

// build gold silhouettes (image filename = `${id}.png` in public/assets/charms)
const goldSil = []
for (const c of goldCharms) {
  const file = join(GOLD_DIR, `${c.id}.png`)
  try {
    const s = await silhouette(file)
    if (s) goldSil.push({ id: c.id, name: c.name, collection: c.collection, sil: s.bits, aspect: s.aspect })
  } catch { /* missing image — skip */ }
}
console.log(`Gold silhouettes built: ${goldSil.length}`) // eslint-disable-line

const manifest = JSON.parse(await readFile(join(EXTRACTED, 'manifest.json'), 'utf8'))
const report = []
let dupCount = 0
for (const ch of manifest.charms) {
  const s = await silhouette(join(EXTRACTED, ch.src))
  if (!s) { report.push({ id: ch.id, status: 'empty' }); continue }
  let best = null
  for (const g of goldSil) {
    // only compare charms of a similar proportion (kills round-blob false matches)
    if (Math.abs(Math.log(s.aspect / g.aspect)) > 0.18) continue
    const d = diff(s.bits, g.sil)
    if (!best || d < best.d) best = { d, id: g.id, name: g.name }
  }
  const isDup = best && best.d <= DUP_THRESHOLD
  if (isDup) dupCount++
  report.push({
    id: ch.id,
    status: isDup ? 'duplicate' : 'unique',
    similarity: best ? +(1 - best.d).toFixed(3) : 0,
    matchId: best?.id || null,
    matchName: best?.name || null,
  })
}

await writeFile(join(ROOT, 'reference', 'dedupe-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), threshold: DUP_THRESHOLD, total: report.length, duplicates: dupCount, unique: report.length - dupCount, report }, null, 2) + '\n')
console.log(`\n${dupCount}/${report.length} flagged as duplicates of gold catalogue charms.`) // eslint-disable-line
console.log('Top matches:') // eslint-disable-line
for (const r of report.filter((r) => r.status === 'duplicate').sort((a, b) => b.similarity - a.similarity).slice(0, 12)) {
  console.log(`  ${r.id}  ~${(r.similarity * 100).toFixed(0)}%  ←  ${r.matchName}`) // eslint-disable-line
}
