#!/usr/bin/env node
// Builds an auditable customizer-to-Shopify charm mapping ledger from the live
// catalogue and a checked-in Shopify variant snapshot. It does not modify data.
import { writeFile } from 'node:fs/promises'

const CATALOG_URL = process.env.CHARME_CATALOG_URL || 'https://charme-customizer.pages.dev/api/catalog'
const OUTPUT = 'reference/shopify-charm-customizer-mapping.md'

const [catalogResponse, shop] = await Promise.all([
  fetch(CATALOG_URL, { headers: { accept: 'application/json' } }),
  import('../reference/shopify-charms.json', { with: { type: 'json' } }).then((module) => module.default),
])
if (!catalogResponse.ok) throw new Error(`Could not read ${CATALOG_URL} (${catalogResponse.status})`)

const catalog = await catalogResponse.json()
const variants = new Map(
  shop.flatMap((product) =>
    product.variants.map((variant) => [String(variant.id), { ...variant, product: product.title }]),
  ),
)
const charms = [...(catalog.charms || [])].sort((left, right) =>
  `${left.collection}\0${left.name}\0${left.id}`.localeCompare(`${right.collection}\0${right.name}\0${right.id}`),
)
const usage = new Map()
for (const charm of charms) {
  if (!charm.shopifyVariantId) continue
  const variantId = String(charm.shopifyVariantId)
  usage.set(variantId, [...(usage.get(variantId) || []), charm.id])
}

const escapeCell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const rows = charms.map((charm) => {
  const variantId = charm.shopifyVariantId ? String(charm.shopifyVariantId) : ''
  const variant = variants.get(variantId)
  const collision = variantId && (usage.get(variantId)?.length || 0) > 1
  const status = !variantId
    ? 'UNMAPPED - blocks native cart'
    : !variant
      ? 'STALE - variant absent from snapshot'
      : collision
        ? `REVIEW - shared by ${usage.get(variantId).length} charms`
        : 'MAPPED - unique'
  return `| ${escapeCell(charm.id)} | ${escapeCell(charm.name)} | ${escapeCell(charm.collection)} | ${escapeCell(charm.price)} | ${escapeCell(variantId || '-')} | ${escapeCell(variant ? variant.product : '-')} | ${escapeCell(variant ? variant.title : '-')} | ${escapeCell(variant ? variant.price : '-')} | ${status} |`
})

const counts = rows.reduce((result, row) => {
  if (row.endsWith('MAPPED - unique |')) result.unique += 1
  else if (row.includes('UNMAPPED')) result.unmapped += 1
  else if (row.includes('STALE')) result.stale += 1
  else result.review += 1
  return result
}, { unique: 0, unmapped: 0, stale: 0, review: 0 })

const document = `# Shopify Charm Mapping Audit

Generated from the live Charm customizer catalogue at \`${CATALOG_URL}\` and \`reference/shopify-charms.json\`.

## Summary

| Live customizer charms | Unique exact mappings | Unmapped | Stale mappings | Shared-variant review |
| ---: | ---: | ---: | ---: | ---: |
| ${charms.length} | ${counts.unique} | ${counts.unmapped} | ${counts.stale} | ${counts.review} |

Rules: a native-cart charm is valid only with an exact Shopify variant ID. Unmapped charms now block native checkout instead of being substituted by price. A shared variant is retained for review only; it is not proof that the displayed charm and Shopify item match.

## Records

| Customizer ID | Customizer name | Collection | Customizer price (GBP) | Shopify variant ID | Shopify product | Shopify variant | Shopify price (GBP) | Audit status |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
${rows.join('\n')}
`

await writeFile(OUTPUT, document)
console.log(JSON.stringify({ output: OUTPUT, charms: charms.length, ...counts }, null, 2))