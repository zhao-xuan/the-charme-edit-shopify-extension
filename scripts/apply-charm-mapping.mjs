// Apply the finished charm mapping to the bundled catalogue:
//   • matched charms   → price := the mapped Shopify variant's price
//                        (+ record charmId → variantId for cart mode)
//   • unmatched charms → flagged { unavailable: true } so the front-end greys
//                        them out / makes them unselectable.
// Also (re)writes shopify/widget/variantmap-charms.generated.json.
import { readFileSync, writeFileSync } from 'fs'

const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = catalog.charms
const draft = JSON.parse(readFileSync('reference/charm-map-draft.json', 'utf8'))
const overrides = JSON.parse(readFileSync('reference/charm-map-overrides.json', 'utf8'))
const shop = JSON.parse(readFileSync('reference/shopify-charms.json', 'utf8'))

const priceById = new Map()
for (const p of shop) for (const v of p.variants) priceById.set(v.id, Number(v.price))

// name -> variant id (override wins; null = deliberately no match)
const nameToId = {}
for (const name of Object.keys(draft)) if (draft[name].match) nameToId[name] = draft[name].match.id
for (const name of Object.keys(overrides)) {
  if (name.startsWith('_')) continue
  nameToId[name] = overrides[name]
}

const charmsMap = {}
const overrideLayer = {} // charmId -> { price?, variantId?, unavailable? } (wins over remote)
let mapped = 0
let unavailable = 0
const unavailableNames = new Set()

for (const c of charms) {
  const id = Object.prototype.hasOwnProperty.call(nameToId, c.name) ? nameToId[c.name] : undefined
  const has = id != null && priceById.has(id)
  if (has) {
    c.price = priceById.get(id)
    charmsMap[c.id] = id
    if (c.unavailable) delete c.unavailable
    overrideLayer[c.id] = { price: priceById.get(id), variantId: id }
    mapped++
  } else {
    c.unavailable = true
    overrideLayer[c.id] = { unavailable: true }
    unavailable++
    unavailableNames.add(c.name)
  }
}

writeFileSync('src/data/catalog.json', JSON.stringify(catalog, null, 2) + '\n')
writeFileSync('shopify/widget/variantmap-charms.generated.json', JSON.stringify(charmsMap, null, 2) + '\n')
// Override layer applied last in catalog.js so it wins even when the D1 remote
// catalogue overrides bundled charms by id.
writeFileSync('src/data/charm-overrides.generated.json', JSON.stringify(overrideLayer, null, 2) + '\n')

console.log(`charms: ${charms.length}`)
console.log(`mapped (price from Shopify, cart-ready): ${mapped}`)
console.log(`unavailable (greyed out): ${unavailable}`)
console.log('\nnew price distribution:')
const pd = {}
for (const c of charms) if (!c.unavailable) pd[c.price] = (pd[c.price] || 0) + 1
console.log(pd)
console.log('\nunavailable names:', [...unavailableNames].sort().join(', '))
