/**
 * process-logo.mjs — knock the white background out of the brand wordmark and
 * emit a tight, transparent PNG for the nav bar.
 *
 * Input : a raster of "The Charmé Edit" as dark ink on a white background.
 * Output: public/assets/brand/logo.png (transparent, trimmed, @2x-friendly).
 *
 * The wordmark is dark-on-white line art, so we derive per-pixel alpha from the
 * pixel's darkness (white → fully transparent, ink → opaque) and keep the
 * original ink colour. This yields clean anti-aliased edges on any background.
 *
 * Run: node scripts/process-logo.mjs [sourceImage]
 *   default source: reference/brand-logo-source.png
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = process.argv[2] || join(ROOT, 'reference', 'brand-logo-source.png')
const OUT = join(ROOT, 'public', 'assets', 'brand', 'logo.png')

// White at/above this luminance is treated as pure background (fully clear);
// darker pixels ramp up to opaque so anti-aliased edges stay smooth.
const WHITE = 244
const GAIN = 1.12

const img = sharp(SRC).ensureAlpha()
const { width, height } = await img.metadata()
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
const ch = info.channels

for (let i = 0; i < data.length; i += ch) {
  const r = data[i], g = data[i + 1], b = data[i + 2]
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  let a
  if (lum >= WHITE) a = 0
  else a = Math.max(0, Math.min(255, Math.round((WHITE - lum) * GAIN)))
  data[i + ch - 1] = a
}

await mkdir(dirname(OUT), { recursive: true })
await sharp(data, { raw: { width, height, channels: ch } })
  .png()
  // Trim the now-transparent margin, then add a hair of padding so the wordmark
  // never touches the nav edges.
  .trim({ threshold: 1 })
  .extend({ top: 6, bottom: 6, left: 10, right: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toFile(OUT)

console.log(`Wrote transparent wordmark → ${OUT}`) // eslint-disable-line no-console
