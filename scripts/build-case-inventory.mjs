// Scans the phone-case asset folders and emits a status/tracking table of what we
// have (case-without-gel = plain shell, case-with-gel = poured-gel render) plus the
// models we still want. Outputs:
//   public/assets/cases/case-inventory.json  (structured metadata)
//   public/assets/cases/case-inventory.md    (human-readable table)
// Re-run any time assets change:  node scripts/build-case-inventory.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const CASES = path.join(ROOT, 'public', 'assets', 'cases')
const WITHOUT = path.join(CASES, 'case-without-gel')
const WITH = path.join(CASES, 'case-with-gel')

// --- display-name overrides (folder id -> pretty name) ---
const GALAXY_NAMES = {
  'galaxy-s26-ultra': 'Galaxy S26 Ultra', 'galaxy-s26-plus': 'Galaxy S26+', 'galaxy-s26': 'Galaxy S26',
  'galaxy-s25-edge': 'Galaxy S25 Edge', 'galaxy-s25-ultra': 'Galaxy S25 Ultra', 'galaxy-s25-plus': 'Galaxy S25+', 'galaxy-s25': 'Galaxy S25',
  'galaxy-s24-fe': 'Galaxy S24 FE', 'galaxy-s24-ultra': 'Galaxy S24 Ultra', 'galaxy-s24-plus': 'Galaxy S24+', 'galaxy-s24': 'Galaxy S24',
  'galaxy-s23-fe': 'Galaxy S23 FE', 'galaxy-s23-ultra': 'Galaxy S23 Ultra', 'galaxy-s23-plus': 'Galaxy S23+', 'galaxy-s23': 'Galaxy S23',
  'galaxy-s22-ultra': 'Galaxy S22 Ultra', 'galaxy-s22-plus': 'Galaxy S22+', 'galaxy-s22': 'Galaxy S22',
  'galaxy-a56': 'Galaxy A56 5G', 'galaxy-a55': 'Galaxy A55 5G', 'galaxy-a54': 'Galaxy A54 5G',
  'galaxy-a36': 'Galaxy A36 5G', 'galaxy-a35': 'Galaxy A35 5G', 'galaxy-a34': 'Galaxy A34 5G',
  'galaxy-a26': 'Galaxy A26 5G', 'galaxy-a25': 'Galaxy A25 5G', 'galaxy-a16': 'Galaxy A16 5G', 'galaxy-a15': 'Galaxy A15 5G',
}
const OTHER_NAMES = {
  'xiaomi-14-pro': 'Xiaomi 14 Pro', 'xiaomi-14': 'Xiaomi 14', 'xiaomi-13-pro': 'Xiaomi 13 Pro', 'xiaomi-13': 'Xiaomi 13',
  'huawei-mate-60-pro': 'Huawei Mate 60 Pro', 'huawei-mate-50-pro': 'Huawei Mate 50 Pro', 'huawei-p60-pro': 'Huawei P60 Pro',
}

// Google Pixel models requested for collection (2026-07-12).
const PIXEL_REQUESTED = [
  'pixel-10-pro-fold', 'pixel-10-pro-xl', 'pixel-10-pro', 'pixel-10',
  'pixel-9-pro-fold', 'pixel-9-pro-xl', 'pixel-9-pro', 'pixel-9', 'pixel-9a',
  'pixel-8-pro', 'pixel-8', 'pixel-8a', 'pixel-7-pro', 'pixel-7', 'pixel-7a',
  'pixel-6-pro', 'pixel-6', 'pixel-6a',
]
// Models the user explicitly requested for collection (28 Galaxy + 18 Pixel).
const REQUESTED = new Set([...Object.keys(GALAXY_NAMES), ...PIXEL_REQUESTED])
// Extra target models to always include even if no asset yet (catalog-defined).
const EXTRA_TARGETS = Object.keys(OTHER_NAMES)

function brandOf(id) {
  if (id.startsWith('iphone')) return 'Apple'
  if (id.startsWith('pixel')) return 'Google'
  if (id.startsWith('galaxy')) return 'Samsung'
  if (id.startsWith('xiaomi')) return 'Xiaomi'
  if (id.startsWith('huawei')) return 'Huawei'
  return 'Other'
}
const CAP = { pro: 'Pro', max: 'Max', plus: 'Plus', mini: 'mini', xs: 'XS', x: 'X', air: 'Air', se: 'SE', fe: 'FE', xl: 'XL', fold: 'Fold' }
function nameOf(id) {
  if (GALAXY_NAMES[id]) return GALAXY_NAMES[id]
  if (OTHER_NAMES[id]) return OTHER_NAMES[id]
  const parts = id.split('-')
  const brand = parts[0]
  const rest = parts.slice(1).map((w) => (/^\d+$/.test(w) ? w : CAP[w] || w)).join(' ')
  if (brand === 'iphone') return 'iPhone ' + rest
  if (brand === 'pixel') return 'Pixel ' + rest
  if (brand === 'galaxy') return 'Galaxy ' + rest
  return id
}

function scan(dir, prefix) {
  const map = {}
  if (!fs.existsSync(dir)) return map
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.png')) continue
    let stem = f.replace(/\.png$/, '')
    if (prefix) stem = stem.replace(new RegExp('^' + prefix), '')
    const m = stem.match(/^(.*)-(black|white|glitter)$/)
    if (!m) continue
    ;(map[m[1]] ||= new Set()).add(m[2])
  }
  return map
}
const wo = scan(WITHOUT, '')
const wg = scan(WITH, 'integrated-')

let catalog = new Set()
try { catalog = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'integrated-models.json'), 'utf8'))) } catch {}

const ids = new Set([...Object.keys(wo), ...Object.keys(wg), ...REQUESTED, ...EXTRA_TARGETS])

const BRAND_ORDER = { Apple: 0, Google: 1, Samsung: 2, Xiaomi: 3, Huawei: 4, Other: 5 }
const rows = [...ids].map((id) => {
  const w = wo[id] || new Set()
  const g = wg[id] || new Set()
  const withoutGel = { black: w.has('black'), white: w.has('white') }
  const withGel = { black: g.has('black'), white: g.has('white'), glitter: g.has('glitter') }
  const baseDone = withoutGel.black && withoutGel.white
  const gelDone = withGel.black && withGel.white
  let status
  if (baseDone && gelDone) status = 'complete'
  else if (!baseDone && gelDone) status = 'gel-only (missing plain shell)'
  else if (baseDone && !gelDone) status = 'shell-only (needs gel)'
  else status = 'missing (none)'
  const needs = []
  if (!withoutGel.black) needs.push('without-gel/black')
  if (!withoutGel.white) needs.push('without-gel/white')
  if (!withGel.black) needs.push('with-gel/black')
  if (!withGel.white) needs.push('with-gel/white')
  return {
    id, brand: brandOf(id), name: nameOf(id),
    requested: REQUESTED.has(id),
    liveInCatalog: catalog.has(id),
    withoutGel, withGel, status, needs,
  }
}).sort((a, b) => (BRAND_ORDER[a.brand] - BRAND_ORDER[b.brand]) || a.id.localeCompare(b.id))

// ---- summary ----
const summary = {
  generatedAt: new Date().toISOString(),
  totalModels: rows.length,
  byBrand: {},
  counts: {
    withoutGelComplete: rows.filter((r) => r.withoutGel.black && r.withoutGel.white).length,
    withGelComplete: rows.filter((r) => r.withGel.black && r.withGel.white).length,
    fullyComplete: rows.filter((r) => r.status === 'complete').length,
    requestedTotal: rows.filter((r) => r.requested).length,
    requestedMissingShell: rows.filter((r) => r.requested && !(r.withoutGel.black && r.withoutGel.white)).length,
  },
}
for (const r of rows) summary.byBrand[r.brand] = (summary.byBrand[r.brand] || 0) + 1

fs.writeFileSync(path.join(CASES, 'case-inventory.json'), JSON.stringify({ summary, models: rows }, null, 2))

// ---- markdown table ----
const yn = (b) => (b ? '●' : '○')
let md = `# Phone-case asset inventory\n\n`
md += `_Generated ${summary.generatedAt} by \`scripts/build-case-inventory.mjs\`._\n\n`
md += `Legend: ● = present · ○ = missing. **without-gel** = plain silicone shell (base for gel). `
md += `**with-gel** = poured-gel render used in the customizer.\n\n`
md += `**Totals:** ${summary.totalModels} models · plain-shell complete (B+W): ${summary.counts.withoutGelComplete} · `
md += `gel complete (B+W): ${summary.counts.withGelComplete} · fully complete: ${summary.counts.fullyComplete}.\n`
md += `Requested models (Galaxy + Pixel): ${summary.counts.requestedTotal}, of which **${summary.counts.requestedMissingShell} still need a plain shell** in case-without-gel.\n\n`

let curBrand = null
for (const r of rows) {
  if (r.brand !== curBrand) {
    curBrand = r.brand
    md += `\n## ${curBrand} (${rows.filter((x) => x.brand === curBrand).length})\n\n`
    md += `| Model | id | without-gel B / W | with-gel B / W / Glitter | status | requested |\n`
    md += `| --- | --- | :---: | :---: | --- | :---: |\n`
  }
  md += `| ${r.name} | \`${r.id}\` | ${yn(r.withoutGel.black)} / ${yn(r.withoutGel.white)} `
  md += `| ${yn(r.withGel.black)} / ${yn(r.withGel.white)} / ${yn(r.withGel.glitter)} | ${r.status} | ${r.requested ? '✔' : ''} |\n`
}
fs.writeFileSync(path.join(CASES, 'case-inventory.md'), md)

console.log('models:', rows.length)
console.log('without-gel complete (B+W):', summary.counts.withoutGelComplete)
console.log('with-gel complete (B+W):', summary.counts.withGelComplete)
console.log('requested (Galaxy+Pixel):', summary.counts.requestedTotal, '— missing plain shell:', summary.counts.requestedMissingShell)
console.log('wrote', path.join(CASES, 'case-inventory.json'))
console.log('wrote', path.join(CASES, 'case-inventory.md'))
