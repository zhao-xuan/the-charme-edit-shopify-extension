// Admin endpoint for the ONE real sellable phone-case product on Shopify — the
// single source of truth for what customers buy (iPhone Model × Case & Gel
// Colour). The admin's product list is wired to these variants:
//
//   GET   /api/admin/case-variants[?handle=]
//         → { productId, colourOptionName, modelOptionName, colours[], models[],
//             variants[] } (see _case-variants.getCaseProduct)
//   PATCH /api/admin/case-variants  { productId, variantId, price?, continueSelling? }
//         → update ONE variant (productVariantsBulkUpdate)
//   POST  /api/admin/case-variants  { action, ... }   (needs write_products)
//         addModel    { model, price? }   create the model's colour variants
//         deleteModel { model }           delete a model's variants
//         addColour   { colour, price? }  add a colour variant to every model
//         deleteColour{ colour }          remove a colour from every model
//
// API version 2024-10.
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { shopifyConfigured } from '../_shopify-store.js'
import {
  getCaseProduct,
  addModelVariants,
  deleteModelVariants,
  addColourVariants,
  deleteColourVariants,
} from '../_case-variants.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const M_UPDATE = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price inventoryPolicy }
      userErrors { field message }
    }
  }`

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return json({ productId: null, colours: [], models: [], variants: [] }, { headers: cors })
  const url = new URL(request.url)
  const handle = (url.searchParams.get('handle') || '').trim() || undefined
  try {
    const product = await getCaseProduct(env, handle)
    if (!product) return bad('phone-case product not found', 404)
    return json(product, { headers: cors })
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

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Shopify not configured', 400)
  const body = (await request.json().catch(() => ({}))) || {}
  const action = body.action
  try {
    const product = await getCaseProduct(env)
    if (!product) return bad('phone-case product not found', 404)
    let created = 0
    let deleted = 0
    if (action === 'addModel') {
      if (!body.model) return bad('model required')
      created = await addModelVariants(env, product, String(body.model).trim(), body.price)
    } else if (action === 'deleteModel') {
      if (!body.model) return bad('model required')
      deleted = await deleteModelVariants(env, product, String(body.model).trim())
    } else if (action === 'addColour') {
      if (!body.colour) return bad('colour required')
      created = await addColourVariants(env, product, String(body.colour).trim(), body.price)
    } else if (action === 'deleteColour') {
      if (!body.colour) return bad('colour required')
      deleted = await deleteColourVariants(env, product, String(body.colour).trim())
    } else {
      return bad(`unknown action "${action}"`)
    }
    return json({ ok: true, created, deleted }, { headers: cors })
  } catch (e) {
    return bad(`Shopify variant ${action} failed: ${e.message}`, 502)
  }
}
