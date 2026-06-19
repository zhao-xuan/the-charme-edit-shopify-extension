/**
 * recalibrate-charm-scale.mjs
 * -------------------------------------------------------------------------
 * Re-derives every extracted charm's real mm size using ONE consistent px->mm
 * ruler, so each piece's size RELATIVE TO THE PHONE on the website matches the
 * reference photos.
 *
 * Why: the per-photo case auto-detection during extraction was unreliable (the
 * cream case blends into the cream desk), so different photos got different
 * rulers — 4 photos ~0.1044 mm/px (charms ~29% too small) and photo 516
 * ~0.1983 mm/px (its charm ~32% too big). The case actually occupies the SAME
 * pixels in all 5 photos (identical framing). Measuring the case edge by warmth
 * (silicone is warmer than the desk) at WORK_LONG=1600 gives a consistent case
 * of ~598 px wide (= 80.6 mm, the iPhone 16 Pro Max case-outer width the site
 * uses) and ~1246 px tall (= 167 mm) → 0.1344 mm/px.
 *
 * Using the SAME case width the storefront renders (product.widthMm = 80.6)
 * guarantees: charm-width / phone-width on screen == charm-px / case-px in the
 * photo. manifest.pxW/pxH are at this same 1600-tall resolution.
 *
 * Run:  node scripts/recalibrate-charm-scale.mjs
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(__dirname, '..', 'reference', 'extracted-charms', 'manifest.json')

const MM_PER_PX = 0.1344 // iPhone 16 Pro Max case: 80.6 mm / 598 px (== 167 / 1246) @ WORK_LONG 1600
const r1 = (n) => +n.toFixed(1)
const tierFromMm = (longMm) =>
  longMm >= 23 ? { tier: 'grande', type: 1, price: 3 }
    : longMm <= 11.5 ? { tier: 'mini', type: 3, price: 2 }
      : { tier: 'midi', type: 2, price: 2 }

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
let changed = 0
for (const c of manifest.charms) {
  if (!c.pxW || !c.pxH) continue
  const widthMm = r1(c.pxW * MM_PER_PX)
  const heightMm = r1(c.pxH * MM_PER_PX)
  const longMm = Math.max(widthMm, heightMm)
  const before = `${c.widthMm}x${c.heightMm}`
  c.widthMm = widthMm
  c.heightMm = heightMm
  Object.assign(c, tierFromMm(longMm))
  if (`${widthMm}x${heightMm}` !== before) changed++
}
manifest.scaleCalibratedAt = new Date().toISOString()
manifest.mmPerPx = MM_PER_PX
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

const longs = manifest.charms.map((c) => Math.max(c.widthMm, c.heightMm)).sort((a, b) => a - b)
console.log(`Recalibrated ${changed}/${manifest.charms.length} charms at ${MM_PER_PX} mm/px`) // eslint-disable-line
console.log(`long-side mm: min ${longs[0]}  median ${longs[longs.length >> 1]}  max ${longs[longs.length - 1]}`) // eslint-disable-line
