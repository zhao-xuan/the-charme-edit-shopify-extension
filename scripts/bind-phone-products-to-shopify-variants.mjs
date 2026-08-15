#!/usr/bin/env node
// Bind each charme_product phone record to the matching default sellable
// custom-charm-phone-case variant. The live model x colour resolver remains
// authoritative at checkout; this binding gives Admin and the customizer a
// real Shopify fallback variant and price.
//
// Usage:
//   source .env && node scripts/bind-phone-products-to-shopify-variants.mjs
//   source .env && node scripts/bind-phone-products-to-shopify-variants.mjs --apply

const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
const apply = process.argv.includes('--apply')

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET')
}

const tokenResponse = await fetch(`https://${store}/admin/oauth/access_token`, {
  method: 'POST',
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
})
const tokenData = await tokenResponse.json().catch(() => ({}))
if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Shopify token exchange failed')

async function gql(query, variables) {
  const response = await fetch(`https://${store}/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': tokenData.access_token },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors || body))
  return body.data
}

const VARIANTS_QUERY = `
  query($after: String) {
    products(first: 1, query: "handle:custom-charm-phone-case") {
      nodes {
        variants(first: 250, after: $after) {
          nodes { id price availableForSale selectedOptions { name value } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`
const METAOBJECTS_QUERY = `
  query($after: String) {
    metaobjects(type: "charme_product", first: 250, after: $after) {
      nodes { id fields { key value } }
      pageInfo { hasNextPage endCursor }
    }
  }`
const DEFINITION_QUERY = `
  query {
    metaobjectDefinitionByType(type: "charme_product") {
      id
      fieldDefinitions { key }
    }
  }`
const DEFINITION_UPDATE = `
  mutation($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      userErrors { field message }
    }
  }`
const UPDATE = `
  mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      userErrors { field message }
    }
  }`

const variants = []
let variantAfter = null
do {
  const data = await gql(VARIANTS_QUERY, { after: variantAfter })
  const connection = data.products?.nodes?.[0]?.variants
  if (!connection) throw new Error('custom-charm-phone-case was not found')
  variants.push(...connection.nodes)
  variantAfter = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
} while (variantAfter)

const metaobjects = []
let metaobjectAfter = null
do {
  const data = await gql(METAOBJECTS_QUERY, { after: metaobjectAfter })
  metaobjects.push(...data.metaobjects.nodes)
  metaobjectAfter = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
} while (metaobjectAfter)

const normalise = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const MODEL_ALIASES = new Map([
  ['galaxy a55 5g', 'galaxy a55'],
  ['galaxy a54 5g', 'galaxy a54'],
  ['galaxy a73 5g', 'galaxy a73'],
  ['galaxy a16 5g', 'galaxy a16'],
  ['galaxy s10+', 'galaxy s10 plus'],
  ['galaxy s9+', 'galaxy s9 plus'],
  ['xiaomi 14 pro', 'any other phone model incl. android - please write down your model in the checkout note'],
])
const modelKey = (value) => MODEL_ALIASES.get(normalise(value)) || normalise(value)
const modelOf = (variant) => variant.selectedOptions.find((option) => /model|phone|device/i.test(option.name))?.value || ''
const colourOf = (variant) => variant.selectedOptions.find((option) => /colour|color|gel|finish/i.test(option.name))?.value || ''
const isBaseVariant = (variant) => variant.selectedOptions
  .filter((option) => !/model|phone|device|colour|color|gel|finish/i.test(option.name))
  .every((option) => /^(no|none|without)\b/i.test(String(option.value || '').trim()))
const priority = (variant) => {
  const colour = colourOf(variant).toLowerCase()
  if (/white/.test(colour) && /glitter/.test(colour)) return 0
  if (/white/.test(colour)) return 1
  if (/black/.test(colour)) return 2
  return 3
}
const variantsByModel = new Map()
for (const variant of variants) {
  if (!variant.availableForSale || !isBaseVariant(variant)) continue
  const key = modelKey(modelOf(variant))
  if (!key) continue
  const current = variantsByModel.get(key)
  if (!current || priority(variant) < priority(current)) variantsByModel.set(key, variant)
}

const phoneRecords = metaobjects.map((node) => ({
  id: node.id,
  fields: Object.fromEntries(node.fields.map((field) => [field.key, field.value])),
})).filter((record) => record.fields.kind === 'phone')

const definition = (await gql(DEFINITION_QUERY)).metaobjectDefinitionByType
if (!definition) throw new Error('charme_product metaobject definition was not found')
let fieldPresent = definition.fieldDefinitions.some((field) => field.key === 'shopify_variant_id')
if (apply && !fieldPresent) {
  const result = await gql(DEFINITION_UPDATE, {
    id: definition.id,
    definition: {
      fieldDefinitions: [{
        create: {
          key: 'shopify_variant_id',
          name: 'Shopify variant ID',
          type: 'single_line_text_field',
        },
      }],
    },
  })
  const errors = result.metaobjectDefinitionUpdate?.userErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))
  fieldPresent = true
}

let bound = 0
let unchanged = 0
let unmatched = 0
const unmatchedNames = []
for (const record of phoneRecords) {
  const target = variantsByModel.get(modelKey(record.fields.name))
  if (!target) {
    unmatched += 1
    unmatchedNames.push(record.fields.name)
    continue
  }
  const variantId = target.id.split('/').pop()
  const needsUpdate = record.fields.shopify_variant_id !== variantId || Number(record.fields.base_price) !== Number(target.price)
  if (!needsUpdate) {
    unchanged += 1
    continue
  }
  if (apply) {
    const result = await gql(UPDATE, {
      id: record.id,
      fields: [
        { key: 'shopify_variant_id', value: variantId },
        { key: 'base_price', value: String(target.price) },
      ],
    })
    const errors = result.metaobjectUpdate?.userErrors || []
    if (errors.length) throw new Error(JSON.stringify(errors))
  }
  bound += 1
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  variants: variants.length,
  baseModels: variantsByModel.size,
  phoneRecords: phoneRecords.length,
  fieldPresent,
  bound,
  unchanged,
  unmatched,
  unmatchedNames,
}))