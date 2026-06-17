/**
 * Copies the generated charm cut-outs + catalogue into the theme app extension's
 * assets folder so they ship with the extension and are served from Shopify's CDN.
 * Run automatically by `npm run build:shopify`.
 */
import { mkdir, copyFile, readdir, writeFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const ASSET_DIRS = ['charms', 'cases', 'totes', 'patches'].map((d) =>
  join(ROOT, 'public', 'assets', d),
)
const CATALOG = join(ROOT, 'src', 'data', 'catalog.json')
const PATCHES = join(ROOT, 'src', 'data', 'patches.json')
const DEST = join(ROOT, 'shopify', 'extensions', 'charme-customizer', 'assets')

await mkdir(DEST, { recursive: true })

// Clear any stale PNGs from a previous run so removed/renamed charms don't ship.
for (const f of await readdir(DEST).catch(() => [])) {
  if (f.endsWith('.png')) await rm(join(DEST, f))
}

let copied = 0
for (const dir of ASSET_DIRS) {
  const files = await readdir(dir).catch(() => [])
  for (const f of files) {
    if (f.endsWith('.png')) {
      await copyFile(join(dir, f), join(DEST, f))
      copied++
    }
  }
}

// ship the catalogues too (handy if you later switch the widget to fetch them)
const catalog = JSON.parse(await readFile(CATALOG, 'utf8'))
await writeFile(join(DEST, 'charm-catalog.json'), JSON.stringify(catalog, null, 2))
const patches = JSON.parse(await readFile(PATCHES, 'utf8'))
await writeFile(join(DEST, 'patch-catalog.json'), JSON.stringify(patches, null, 2))

console.log(`Copied ${copied} PNGs (charms + cases + totes + patches) + catalogues → ${DEST}`)
