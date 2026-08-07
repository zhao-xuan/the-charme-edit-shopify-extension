#!/usr/bin/env node
// Ensure the non-phone customizer products have actual Shopify products with a
// purchasable default variant. This is intentionally separate from the
// charme_product metaobjects, which only describe the editor canvas.
//
// Usage:
//   set -a; source .env; set +a
//   node scripts/ensure-shopify-accessory-products.mjs [--dry-run]
//
// Required env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
import { createHash } from 'node:crypto'

const API_VERSION = '2025-01'
const dryRun = process.argv.includes('--dry-run')
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

const ACCESSORIES = [
  {
    handle: 'charme-edit-tote',
    title: 'The Charmé Edit Tote',
    price: '16.00',
    legacyTitles: ["Trader Joe's Tote"],
  },
  {
    handle: 'charme-photo-frame',
    title: 'Photo Frame · 4×6”',
    price: '24.00',
    legacyTitles: ['Photo Frame', 'Photo Frame · 5×7”'],
  },
]

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET.')
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function accessToken() {
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw new Error(`Shopify token exchange failed (${response.status}).`)
  return body.access_token
}

let token
async function graphql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
    })
    const body = await response.json().catch(() => ({}))
    if (response.status === 429 || JSON.stringify(body.errors || '').includes('THROTTLED')) {
      await sleep(1000 * (attempt + 1))
      continue
    }
    if (!response.ok || body.errors) throw new Error(`Shopify GraphQL failed: ${JSON.stringify(body.errors || body)}`)
    return body.data
  }
  throw new Error('Shopify GraphQL remained throttled after five attempts.')
}

const PRODUCT_FIELDS = `
  id title handle status
  variants(first: 250) {
    nodes { id title price availableForSale inventoryPolicy }
  }
`
const PRODUCTS = `query($after: String) {
  products(first: 250, after: $after) {
    nodes { ${PRODUCT_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`
const CREATE_PRODUCT = `mutation($input: ProductInput!) {
  productCreate(input: $input) {
    product { ${PRODUCT_FIELDS} }
    userErrors { field message }
  }
}`
const UPDATE_VARIANT = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id title price inventoryPolicy }
    userErrors { field message }
  }
}`

async function allProducts() {
  const products = []
  let after = null
  do {
    const data = await graphql(PRODUCTS, { after })
    products.push(...data.products.nodes)
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (after)
  return products
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findProduct(products, accessory) {
  const handles = new Set([accessory.handle, accessory.handle.replace('charme-', '')])
  const titles = new Set([accessory.title, ...accessory.legacyTitles].map(normalize))
  return products.find((product) => handles.has(product.handle) || titles.has(normalize(product.title))) || null
}

function defaultVariant(product) {
  const variants = product.variants?.nodes || []
  return variants.find((variant) => variant.title === 'Default Title') || variants[0] || null
}

async function ensureAccessory(products, accessory) {
  let product = findProduct(products, accessory)
  if (!product) {
    if (dryRun) {
      console.log(`[dry-run] create ${accessory.handle}: ${accessory.title} at £${accessory.price}`)
      return { handle: accessory.handle, action: 'would-create', price: accessory.price }
    }
    const data = await graphql(CREATE_PRODUCT, {
      input: { title: accessory.title, handle: accessory.handle, status: 'ACTIVE' },
    })
    const errors = data.productCreate.userErrors || []
    if (errors.length) throw new Error(`${accessory.handle}: ${JSON.stringify(errors)}`)
    product = data.productCreate.product
    products.push(product)
    console.log(`created ${product.handle}`)
  }

  const variant = defaultVariant(product)
  if (!variant) throw new Error(`${product.handle} has no default Shopify variant.`)
  const currentPrice = Number(variant.price).toFixed(2)
  const shouldUpdate = currentPrice !== accessory.price || variant.inventoryPolicy !== 'CONTINUE'
  if (!shouldUpdate) {
    console.log(`ok ${product.handle}: ${variant.title} £${currentPrice}`)
    return { handle: product.handle, action: 'unchanged', variantId: variant.id, price: currentPrice }
  }
  if (dryRun) {
    console.log(`[dry-run] update ${product.handle}: ${variant.title} £${currentPrice} -> £${accessory.price}`)
    return { handle: product.handle, action: 'would-update', variantId: variant.id, price: accessory.price }
  }

  const data = await graphql(UPDATE_VARIANT, {
    productId: product.id,
    variants: [{ id: variant.id, price: accessory.price, inventoryPolicy: 'CONTINUE' }],
  })
  const errors = data.productVariantsBulkUpdate.userErrors || []
  if (errors.length) throw new Error(`${product.handle}: ${JSON.stringify(errors)}`)
  console.log(`updated ${product.handle}: ${variant.title} £${accessory.price}`)
  return { handle: product.handle, action: 'updated', variantId: variant.id, price: accessory.price }
}

token = await accessToken()
const products = await allProducts()
const results = []
for (const accessory of ACCESSORIES) results.push(await ensureAccessory(products, accessory))

const verification = createHash('sha256').update(JSON.stringify(results)).digest('hex').slice(0, 12)
console.log(JSON.stringify({ dryRun, results, verification }, null, 2))