/**
 * calibrate-charm-sizes.mjs
 * -------------------------------------------------------------------------
 * Re-derives every charm's real-world size (widthMm/heightMm) in
 * src/data/catalog.json from the sizes MEASURED off the real reference photos
 * in dist/assets/charms-real-image (gold charms on a known iPhone 16 Pro Max
 * case — see scripts/measure-real-charms.mjs).
 *
 * Findings from the measurements (uniform 0.215 mm/px scale):
 *   • General feature ("Midi") charms cluster ~17–19 mm long side → the existing
 *     Midi default (17 mm) is accurate; Grande statement pieces ~28–39 mm → the
 *     32 mm default holds; Mini fillers ~9–13 mm → 11 mm holds.
 *   • BUT three collections are pinned to Midi (17 mm) yet are physically much
 *     smaller in the photos:
 *        Letters & Initials  ≈ 9 mm   (were 17 — ~2× too big)
 *        Numbers             ≈ 10 mm  (were 17)
 *        Zodiac Signs        ≈ 14 mm  (were 17)
 *
 * This script rescales each charm to its calibrated long side while preserving
 * the cut-out's aspect ratio, then writes catalog.json back. Run it again any
 * time after the asset pipeline regenerates the catalogue.
 *
 * Run:  node scripts/calibrate-charm-sizes.mjs
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CATALOG = join(__dirname, '..', 'src', 'data', 'catalog.json')

// Real long-side (mm) per interaction tier, validated against the photos.
const TIER_LONG_MM = { grande: 32, midi: 17, mini: 11 }

// Per-collection real long-side (mm) overrides measured from the photos. These
// win over the tier default. Keyed by the catalogue `collection` string.
const COLLECTION_LONG_MM = {
  'Letters & Initials': 9,
  Numbers: 10,
  'Zodiac Signs': 14,
}

const round1 = (n) => +n.toFixed(1)

const catalog = JSON.parse(await readFile(CATALOG, 'utf8'))
let changed = 0
const summary = {}

for (const charm of catalog.charms) {
  const targetLong = COLLECTION_LONG_MM[charm.collection] ?? TIER_LONG_MM[charm.tier]
  if (!targetLong) continue
  const oldLong = Math.max(charm.widthMm, charm.heightMm)
  if (!oldLong) continue
  const k = targetLong / oldLong
  const nw = round1(charm.widthMm * k)
  const nh = round1(charm.heightMm * k)
  if (nw !== charm.widthMm || nh !== charm.heightMm) {
    charm.widthMm = nw
    charm.heightMm = nh
    changed++
    const key = COLLECTION_LONG_MM[charm.collection] ? charm.collection : `tier:${charm.tier}`
    summary[key] = (summary[key] || 0) + 1
  }
}

catalog.calibratedFrom = 'charms-real-image (iPhone 16 Pro Max, 0.215 mm/px)'
catalog.calibratedAt = new Date().toISOString()

await writeFile(CATALOG, JSON.stringify(catalog, null, 2) + '\n')
console.log(`Recalibrated ${changed} / ${catalog.charms.length} charms.`)
console.log('By group:', JSON.stringify(summary, null, 2))
