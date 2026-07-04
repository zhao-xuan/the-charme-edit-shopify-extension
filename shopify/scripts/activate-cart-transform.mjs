#!/usr/bin/env node
// Activate the Charmé cart-transform function + point it at the parent variant.
// ---------------------------------------------------------------------------
// After `shopify app deploy` has pushed the `charme-bundle` function, run this
// ONCE to:
//   1. store the "Custom Charm Case" parent variant id in an app-owned shop
//      metafield ($app:charme / parent_variant) that the function reads, and
//   2. activate the cart transform (cartTransformCreate) so Shopify runs it.
//
// Auth reuses the same dev-dashboard app credentials as the draft-order
// endpoint (client_credentials grant → Admin API token).
//
// Usage:
//   SHOPIFY_STORE=7ftyeu-0m.myshopify.com \
//   SHOPIFY_CLIENT_ID=xxxx \
//   SHOPIFY_CLIENT_SECRET=shpss_xxxx \
//   node shopify/scripts/activate-cart-transform.mjs \
//     --parent gid://shopify/ProductVariant/1234567890
//
// Re-running is safe: the metafield is upserted and an existing cart transform
// is detected (cartTransformCreate returns a "already activated" style error
// which we treat as success).

const API_VERSION = '2025-01'

const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

const parentArgIdx = process.argv.indexOf('--parent')
let parentVariant = parentArgIdx !== -1 ? process.argv[parentArgIdx + 1] : process.env.PARENT_VARIANT

if (!store || !clientId || !clientSecret) {
  console.error('Missing env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET are required.')
  process.exit(1)
}
if (!parentVariant) {
  console.error('Missing --parent <variant gid> (the "Custom Charm Case" parent variant).')
  process.exit(1)
}
// Accept a bare numeric id or a full gid.
if (/^\d+$/.test(parentVariant)) parentVariant = `gid://shopify/ProductVariant/${parentVariant}`

async function accessToken() {
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(data)}`)
  }
  return data.access_token
}

async function gql(token, query, variables) {
  const res = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data
}

const SHOP_ID = `{ shop { id } }`

const FUNCTIONS = `{
  shopifyFunctions(first: 50) {
    nodes { id title apiType }
  }
}`

const SET_METAFIELD = `
  mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value }
      userErrors { field message }
    }
  }`

const CART_TRANSFORM_CREATE = `
  mutation Create($functionId: String!) {
    cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
      cartTransform { id }
      userErrors { field message code }
    }
  }`

async function main() {
  const token = await accessToken()

  // 1. Resolve the cart-transform function id deployed by `shopify app deploy`.
  const fns = await gql(token, FUNCTIONS)
  const fn = (fns.shopifyFunctions.nodes || []).find((n) => n.apiType === 'cart_transform')
  if (!fn) {
    throw new Error(
      'No cart_transform function found. Run `shopify app deploy` first so the charme-bundle function exists.',
    )
  }
  console.log(`✔ cart_transform function: ${fn.title} (${fn.id})`)

  // 2. Store the parent variant id in the app-owned shop metafield the function reads.
  const { shop } = await gql(token, SHOP_ID)
  const meta = await gql(token, SET_METAFIELD, {
    metafields: [
      {
        ownerId: shop.id,
        namespace: '$app:charme',
        key: 'parent_variant',
        type: 'single_line_text_field',
        value: parentVariant,
      },
    ],
  })
  const metaErr = meta.metafieldsSet.userErrors
  if (metaErr && metaErr.length) throw new Error(`metafield error: ${JSON.stringify(metaErr)}`)
  console.log(`✔ shop metafield $app:charme/parent_variant = ${parentVariant}`)

  // 3. Activate the cart transform.
  const created = await gql(token, CART_TRANSFORM_CREATE, { functionId: fn.id })
  const errs = created.cartTransformCreate.userErrors || []
  const already = errs.some((e) => /already|exist/i.test(e.message || '') || e.code === 'TAKEN')
  if (errs.length && !already) {
    throw new Error(`cartTransformCreate error: ${JSON.stringify(errs)}`)
  }
  if (already) {
    console.log('✔ cart transform already active (nothing to do)')
  } else {
    console.log(`✔ cart transform activated: ${created.cartTransformCreate.cartTransform.id}`)
  }

  console.log('\nDone. Add a custom case to the cart in Cart mode to see the merged bundle line.')
}

main().catch((err) => {
  console.error('\n✖', err.message || err)
  process.exit(1)
})
