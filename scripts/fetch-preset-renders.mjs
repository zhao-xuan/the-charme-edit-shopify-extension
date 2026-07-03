/**
 * fetch-preset-renders.mjs
 * -------------------------------------------------------------------------
 * Downloads the primary (position-1) flat-lay design render for each of the 15
 * "custom phone case" preset designs from thecharmeedit.com into
 * reference/presets/<handle>.png.
 *
 * The authoritative CDN url is resolved per design via the storefront product
 * `.js` endpoint (images[0].src) — the collection products.json is line-wrapped
 * when piped through tooling and its UUIDs cannot be trusted. Files are JPEG
 * despite the .png extension (kept as-is; sharp reads by content, not name).
 *
 * Run: node scripts/fetch-preset-renders.mjs
 * -------------------------------------------------------------------------
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'reference', 'presets')

// handle -> display title (order = collection order, 1st blank + airpods excluded)
export const DESIGNS = [
  ['eros-light', 'Eros Light'],
  ['burning-heart', 'Burning Heart'],
  ['amalfi-rouge', 'Amalfi Rouge'],
  ['antique-garden', 'Antique Garden'],
  ['celeste-key-gold-custom-charm-phone-case', 'Celeste Key (Gold)'],
  ['the-cosmos', 'The Cosmos'],
  ['sea-treasures-custom-charm-phone-case', 'Sea treasures'],
  ['exhibit-a-custom-phone-case', 'Exhibit A'],
  ['cupid-blush-custom-charm-phone-case', 'Cupid Blush'],
  ['shoreline-glow-copy', 'Moonlit Veil'],
  ['coral-dreams', 'Coral Dreams'],
  ['the-oracle', 'The Oracle'],
  ['sea-of-light', 'Sea of Light'],
  ['amour-rosa-custom-charm-phone-case', 'Amour Rosa'],
  ['celeste-key', 'Celeste Key (Silver)'],
]

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

async function resolveRenderUrl(handle) {
  const res = await fetch(`https://thecharmeedit.com/products/${handle}.js`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`product .js ${handle} → HTTP ${res.status}`)
  const data = await res.json()
  const src = (data.images && data.images[0]) || data.featured_image
  if (!src) throw new Error(`no image for ${handle}`)
  return src.startsWith('//') ? `https:${src}` : src
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`download → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 5000 || buf.slice(0, 15).toString().includes('<!DOCTYPE'))
    throw new Error(`download looks like an error page (${buf.length} bytes)`)
  await writeFile(dest, buf)
  return buf.length
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const manifest = []
  for (const [handle, title] of DESIGNS) {
    try {
      const url = await resolveRenderUrl(handle)
      const dest = join(OUT, `${handle}.png`)
      const bytes = await download(url, dest)
      manifest.push({ handle, title, url })
      console.log(`ok  ${handle.padEnd(42)} ${(bytes / 1024).toFixed(0)}KB`) // eslint-disable-line
    } catch (e) {
      console.error(`ERR ${handle.padEnd(42)} ${e.message}`) // eslint-disable-line
    }
  }
  await writeFile(join(OUT, 'renders.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nwrote ${manifest.length}/${DESIGNS.length} → reference/presets/`) // eslint-disable-line
}

// Only download when run directly (not when imported for the DESIGNS list).
if (process.argv[1] && process.argv[1].endsWith('fetch-preset-renders.mjs')) main()
