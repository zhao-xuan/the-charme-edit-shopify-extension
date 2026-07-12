// Admin endpoint for the REAL sellable phone-case variants (the actual Shopify
// product the customer buys), so the merchant can see/edit their live prices &
// availability from the admin — the "product page" is wired to the real Shopify
// variants, not just the customizer's display metaobjects.
//
//   GET   /api/admin/case-variants[?handle=custom-charm-phone-case]
//         → { productId, handle, title, options, variants:[{id, price, model,
//             colour, available, inventory}] }
//   PATCH /api/admin/case-variants  { productId, variantId, price?, available? }
//         → updates the variant via productVariantsBulkUpdate (needs write_products)
//
// The product = one "Custom phone case" with Option "iPhone Model" × "Case & Gel
// Colour" (see scripts/build-base-variant-map.mjs). API version 2024-10.
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { shopifyConfigured } from '../_shopify-store.js'

const DEFAULT_HANDLE = 'custom-charm-phone-case'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const Q_PRODUCT = `
  query($q: String!) {
    products(first: 1, query: $q) {
      edges { node {
        id title handle
        options { name position values }
        variants(first: 100) {
          edges { node {
            id title price availableForSale inventoryQuantity inventoryPolicy
            selectedOptions { name value }
          } }
        }
      } }
    }
  }`

const M_UPDATE = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price inventoryPolicy }
      userErrors { field message }
    }
  }`

/** Pick the option value whose option name matches (case-insensitive) any hint. */
function optOf(selected, hints) {
  const s = (selected || []).find((o) => hints.some((h) => o.name.toLowerCase().includes(h)))
  return s ? s.value : ''
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return json({ productId: null, variants: [] }, { headers: cors })
  const url = new URL(request.url)
  const handle = (url.searchParams.get('handle') || DEFAULT_HANDLE).trim()
  try {
    const data = await shopifyAdmin(env, Q_PRODUCT, { q: `handle:${handle}` })
    const node = data.products?.edges?.[0]?.node
    if (!node) return bad(`product "${handle}" not found`, 404)
    const variants = (node.variants?.edges || []).map((e) => {
      const v = e.node
      return {
        id: v.id,
        price: v.price != null ? Number(v.price) : null,
        model: optOf(v.selectedOptions, ['model', 'phone']),
        colour: optOf(v.selectedOptions, ['colour', 'color', 'gel']),
        available: !!v.availableForSale,
        inventory: v.inventoryQuantity,
        continueSelling: v.inventoryPolicy === 'CONTINUE',
      }
    })
    return json(
      { productId: node.id, handle: node.handle, title: node.title, options: node.options || [], variants },
      { headers: cors },
    )
  } catch (e) {
    return bad(`Shopify variants query failed: ${e.message}`, 502)
  }
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Shopify not configured', 400)
  const { productId, variantId, price, continueSelling } = (await request.json().catch(() => ({}))) || {}
  if (!productId || !variantId) return bad('productId and variantId required')
  const variant = { id: variantId }
  if (price != null && price !== '') variant.price = String(price)
  // Availability is controlled via the inventory policy (sell when out of stock).
  if (continueSelling != null) variant.inventoryPolicy = continueSelling ? 'CONTINUE' : 'DENY'
  if (variant.price == null && variant.inventoryPolicy == null) return bad('nothing to update')
  try {
    const data = await shopifyAdmin(env, M_UPDATE, { productId, variants: [variant] })
    const errs = data.productVariantsBulkUpdate?.userErrors || []
    if (errs.length) return bad(`Shopify: ${JSON.stringify(errs)}`, 400)
    return json({ ok: true }, { headers: cors })
  } catch (e) {
    return bad(`Shopify variant update failed: ${e.message}`, 502)
  }
}
