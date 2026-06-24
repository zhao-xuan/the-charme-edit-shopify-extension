/**
 * seed-cloudflare.mjs
 * -------------------------------------------------------------------------
 * Generates the D1 + KV seed for the categorised reference charms (the new
 * catalogue in src/data/catalog.json, images in public/assets/charms/ref) so
 * they live in Cloudflare (D1 metadata + KV image bytes). Writes two files the
 * wrangler CLI then imports:
 *   /tmp/seed-charms.sql   — replaces the `extracted` charm rows
 *   /tmp/seed-images.json  — `wrangler kv bulk put` payload (base64 PNGs)
 *
 * Run:  node scripts/seed-cloudflare.mjs
 * then: wrangler d1 execute charme-catalog --remote --file=/tmp/seed-charms.sql
 *       wrangler kv bulk put --namespace-id b4c301e68f82476e894f46dcf79c357e \
 *              /tmp/seed-images.json --remote
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ASSETS = join(ROOT, 'public', 'assets', 'charms', 'ref')

const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
const esc = (s) => String(s).replace(/'/g, "''")
const num = (v) => (v == null || Number.isNaN(v) ? 'NULL' : v)

// Replace the previous reference set; keep any merchant 'custom' rows untouched.
const sql = [
  '-- categorised reference charms (real charm photos)',
  "DELETE FROM charms WHERE source = 'extracted';",
]
const kv = []
for (const c of catalog.charms) {
  const png = await readFile(join(ASSETS, `${c.id}.png`))
  const b64 = png.toString('base64')
  // content-hash the key so re-processed bytes get a fresh, cache-busting URL
  const hash = createHash('sha1').update(png).digest('hex').slice(0, 10)
  const key = `${c.id}-${hash}`
  kv.push({ key: `img:${key}`, value: b64, base64: true, metadata: { contentType: 'image/png' } })
  sql.push(
    'INSERT OR REPLACE INTO charms ' +
    '(id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source) VALUES (' +
    `'${esc(c.id)}','${esc(c.name)}','${esc(c.collection)}','${esc(c.category)}','${esc(c.tier)}',` +
    `${c.type},${c.price},${num(c.widthMm)},${num(c.heightMm)},${num(c.pxW)},${num(c.pxH)},'${esc(key)}',0,'extracted');`,
  )
}

await writeFile('/tmp/seed-charms.sql', sql.join('\n') + '\n')
await writeFile('/tmp/seed-images.json', JSON.stringify(kv))
console.log(`Wrote ${catalog.charms.length} charm rows → /tmp/seed-charms.sql`) // eslint-disable-line
console.log(`Wrote ${kv.length} KV images → /tmp/seed-images.json`) // eslint-disable-line
