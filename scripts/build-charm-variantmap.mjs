// Merge the auto-matched draft (151) + manual overrides (48) into a final
// per-charm-id variant map for cart mode: variantMap.charms { charmId: variantId }.
// Every customizer charm id that shares a matched name gets that Shopify variant;
// names mapped to null (no Shopify equivalent) are left out and fall back to
// charmByPrice at cart time.
import { readFileSync, writeFileSync } from 'fs'

const draft = JSON.parse(readFileSync('reference/charm-map-draft.json', 'utf8'))
const overrides = JSON.parse(readFileSync('reference/charm-map-overrides.json', 'utf8'))
const cat = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = Array.isArray(cat) ? cat : cat.charms || Object.values(cat)
const shop = JSON.parse(readFileSync('reference/shopify-charms.json', 'utf8'))
const validIds = new Set()
for (const p of shop) for (const v of p.variants) validIds.add(v.id)

// name -> variant id (null = deliberately no match)
const nameToId = {}
for (const name of Object.keys(draft)) {
  if (draft[name].match) nameToId[name] = draft[name].match.id
}
for (const name of Object.keys(overrides)) {
  if (name.startsWith('_')) continue
  nameToId[name] = overrides[name] // may be null
}

// Sanity: every non-null id must exist in the Shopify catalogue.
const bad = Object.entries(nameToId).filter(([, id]) => id != null && !validIds.has(id))
if (bad.length) {
  console.error('INVALID variant ids:', bad)
  process.exit(1)
}

const charmsMap = {}
let mappedCharms = 0
const unmappedNames = new Set()
for (const c of charms) {
  const id = nameToId[c.name]
  if (id != null) {
    charmsMap[c.id] = id
    mappedCharms++
  } else {
    unmappedNames.add(c.name)
  }
}

writeFileSync('shopify/widget/variantmap-charms.generated.json', JSON.stringify(charmsMap, null, 2))

const distinct = new Set(charms.map((c) => c.name)).size
const mappedNames = Object.entries(nameToId).filter(([, id]) => id != null).length
console.log(`distinct names: ${distinct}`)
console.log(`names mapped to a Shopify variant: ${mappedNames}`)
console.log(`names with NO Shopify equivalent (charmByPrice fallback): ${unmappedNames.size}`)
console.log(`charm ids mapped: ${mappedCharms}/${charms.length}`)
console.log(`\nwrote shopify/widget/variantmap-charms.generated.json`)
console.log('\n--- names with no Shopify equivalent ---')
console.log([...unmappedNames].sort().join(', '))
