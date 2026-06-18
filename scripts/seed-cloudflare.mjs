/**
 * seed-cloudflare.mjs
 * -------------------------------------------------------------------------
 * Generates the D1 + KV seed for the de-shadowed reference/extracted-charms so
 * they live in Cloudflare (D1 metadata + KV image bytes), tagged with the
 * advisory dedupe status. Writes two files the wrangler CLI then imports:
 *   /tmp/seed-charms.sql   — INSERT statements for the `charms` table
 *   /tmp/seed-images.json  — `wrangler kv bulk put` payload (base64 PNGs)
 *
 * Run:  node scripts/seed-cloudflare.mjs
 * then: wrangler d1 execute charme-catalog --remote --file=/tmp/seed-charms.sql
 *       wrangler kv bulk put --namespace-id <ID> /tmp/seed-images.json --remote
 * -------------------------------------------------------------------------
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIR = join(ROOT, 'reference', 'extracted-charms')

const manifest = JSON.parse(await readFile(join(DIR, 'manifest.json'), 'utf8'))
let dedupe = { report: [] }
try { dedupe = JSON.parse(await readFile(join(ROOT, 'reference', 'dedupe-report.json'), 'utf8')) } catch { /* none */ }
const dedupeById = new Map(dedupe.report.map((r) => [r.id, r]))

const esc = (s) => String(s).replace(/'/g, "''")
// nice human name from the source id, e.g. "Charm 515-1" → use collection-ish
const niceName = (id, i) => `Reference charm ${i + 1}`

const sql = ['-- extracted reference charms (de-shadowed)']
const kv = []
let i = 0
for (const c of manifest.charms) {
  const png = await readFile(join(DIR, c.src))
  const b64 = png.toString('base64')
  const key = c.id
  kv.push({ key: `img:${key}`, value: b64, base64: true, metadata: { contentType: 'image/png' } })
  const d = dedupeById.get(c.id)
  const dupOf = d && d.status === 'duplicate' ? d.matchId : null
  const dupScore = d && d.status === 'duplicate' ? d.similarity : null
  // duplicates start HIDDEN so the storefront isn't flooded with re-adds; the
  // merchant can reveal them in admin after review.
  const hidden = dupOf ? 1 : 0
  sql.push(
    `INSERT OR REPLACE INTO charms (id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source,dup_of,dup_score) VALUES (` +
    `'${esc(c.id)}','${esc(niceName(c.id, i))}','Reference set','${esc(c.category || 'gold')}','${esc(c.tier)}',${c.type},${c.price},${c.widthMm},${c.heightMm},${c.pxW || 'NULL'},${c.pxH || 'NULL'},'${esc(key)}',${hidden},'extracted',${dupOf ? `'${esc(dupOf)}'` : 'NULL'},${dupScore ?? 'NULL'});`,
  )
  i++
}

await writeFile('/tmp/seed-charms.sql', sql.join('\n') + '\n')
await writeFile('/tmp/seed-images.json', JSON.stringify(kv))
console.log(`Wrote ${manifest.charms.length} charm rows → /tmp/seed-charms.sql`) // eslint-disable-line
console.log(`Wrote ${kv.length} images → /tmp/seed-images.json`) // eslint-disable-line
const dups = manifest.charms.filter((c) => { const d = dedupeById.get(c.id); return d && d.status === 'duplicate' }).length
console.log(`(${dups} marked as duplicates → seeded hidden)`) // eslint-disable-line
