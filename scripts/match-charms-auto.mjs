// Auto-match customizer charms to Shopify charm variants by keyword, then let a
// human verify. For each distinct customizer charm name we strip the colour
// prefix (Gold/Silver/Colourful/Natural) to get the core noun (e.g. "Dolphin",
// "Porcelain Heart") and score every Shopify variant by how well the core words
// appear in "<product title> <variant title>", preferring a matching price.
//
// Output: reference/charm-map-draft.json — per customizer name: best match +
// top candidates, so疑难项可人工/看图核对。Letters & Numbers are handled specially.
import { readFileSync, writeFileSync } from 'fs'

const shop = JSON.parse(readFileSync('reference/shopify-charms.json', 'utf8'))
const cat = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = Array.isArray(cat) ? cat : cat.charms || Object.values(cat)

// Flatten Shopify variants with searchable text.
const variants = []
for (const p of shop) {
  for (const v of p.variants) {
    variants.push({
      id: v.id,
      price: Number(v.price),
      product: p.title.replace(/\s+/g, ' ').trim(),
      vtitle: v.title,
      text: `${p.title} ${v.title}`.toLowerCase(),
    })
  }
}

const STOP = new Set(['gold', 'silver', 'colourful', 'natural', 'the', 'a', 'of', 'and', 'charm', 'grande', 'midi', 'mini', '&'])
const core = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))

// Distinct customizer names with a representative price.
const byName = new Map()
for (const c of charms) {
  if (!byName.has(c.name)) byName.set(c.name, { name: c.name, price: Number(c.price), category: c.category })
}

function scoreVariant(words, v, price) {
  let s = 0
  for (const w of words) {
    if (v.text.includes(w)) s += w.length >= 4 ? 3 : 2 // longer word = stronger signal
  }
  if (s === 0) return 0
  if (v.price === price) s += 2
  else if (Math.abs(v.price - price) <= 1) s += 1
  return s
}

// Letter / number special-case: customizer "Gold Letter A" → Letters/Initials
// variant "Gold / A"; "Silver Letter B" → "Silver / B".
function letterMatch(name) {
  let m = /^(gold|silver) letter ([a-z])$/i.exec(name)
  if (m) {
    const colour = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
    const L = m[2].toUpperCase()
    const v = variants.find((x) => /letters/i.test(x.product) && x.vtitle.startsWith(`${colour} / ${L}`))
    if (v) return v
  }
  return null
}

const out = {}
let matched = 0
let unmatched = []
for (const { name, price, category } of byName.values()) {
  const lm = letterMatch(name)
  if (lm) {
    out[name] = { price, category, match: { id: lm.id, product: lm.product, vtitle: lm.vtitle, price: lm.price }, candidates: [] }
    matched++
    continue
  }
  const words = core(name)
  const scored = variants
    .map((v) => ({ v, s: scoreVariant(words, v, price) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const top = scored.slice(0, 4).map((x) => ({ id: x.v.id, product: x.v.product, vtitle: x.v.vtitle, price: x.v.price, score: x.s }))
  const best = top[0] && top[0].score >= 4 ? top[0] : null
  out[name] = { price, category, match: best, candidates: top }
  if (best) matched++
  else unmatched.push(name)
}

writeFileSync('reference/charm-map-draft.json', JSON.stringify(out, null, 2))
console.log(`distinct names: ${byName.size}`)
console.log(`auto-matched (score>=4): ${matched}`)
console.log(`needs review (no confident match): ${unmatched.length}`)
console.log('\n--- unmatched (need visual) ---')
console.log(unmatched.join(', '))
