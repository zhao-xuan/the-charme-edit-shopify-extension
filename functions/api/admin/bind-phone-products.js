// Bind every phone `charme_product` record to its matching sellable Shopify
// case variant. POST `{ apply: false }` previews the result; `{ apply: true }`
// persists both the variant ID and its current Shopify price as the fallback.
import { json, bad, requireAdmin } from '../_lib.js'
import { TYPES, listRecords, saveRecord, shopifyConfigured } from '../_shopify-store.js'
import { getCaseProduct } from '../_case-variants.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const normalise = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\s_-]+/g, ' ')
  .replace(/\s+/g, ' ')

const MODEL_ALIASES = new Map([
  ['galaxy a55 5g', 'galaxy a55'],
  ['galaxy a54 5g', 'galaxy a54'],
  ['galaxy a73 5g', 'galaxy a73'],
  ['galaxy a16 5g', 'galaxy a16'],
  ['galaxy s10+', 'galaxy s10 plus'],
  ['galaxy s9+', 'galaxy s9 plus'],
  ['xiaomi 14 pro', 'any other phone model incl. android please write down your model in the checkout note'],
])
const modelKey = (value) => MODEL_ALIASES.get(normalise(value)) || normalise(value)

const preference = (variant) => {
  const colour = String(variant.colour || '').toLowerCase()
  if (/white/.test(colour) && /glitter/.test(colour)) return 0
  if (/white/.test(colour)) return 1
  if (/black/.test(colour)) return 2
  return 3
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Shopify is not configured', 503)

  const { apply = false } = (await request.json().catch(() => ({}))) || {}
  try {
    const [products, caseProduct] = await Promise.all([
      listRecords(env, TYPES.product),
      getCaseProduct(env),
    ])
    if (!caseProduct) return bad('custom-charm-phone-case was not found', 404)

    const variantsByModel = new Map()
    for (const variant of caseProduct.variants) {
      if (!variant.isBaseVariant || !variant.available) continue
      const key = modelKey(variant.model)
      if (!key) continue
      const current = variantsByModel.get(key)
      if (!current || preference(variant) < preference(current)) variantsByModel.set(key, variant)
    }

    const matched = []
    const unmatched = []
    let updated = 0
    let unchanged = 0
    for (const product of products.filter((item) => item.kind === 'phone')) {
      const variant = variantsByModel.get(modelKey(product.name))
      if (!variant?.id) {
        unmatched.push(product.name)
        continue
      }
      const variantId = String(variant.id).split('/').pop()
      const needsUpdate = String(product.shopifyVariantId || '') !== variantId || Number(product.basePrice) !== Number(variant.price)
      matched.push({ productId: product.id, name: product.name, variantId, price: variant.price, updated: needsUpdate })
      if (!needsUpdate) {
        unchanged += 1
        continue
      }
      if (apply) await saveRecord(env, TYPES.product, product.id, {
        ...product,
        shopifyVariantId: variantId,
        basePrice: variant.price,
      })
      updated += 1
    }
    return json({
      ok: true,
      applied: !!apply,
      phoneProducts: products.filter((item) => item.kind === 'phone').length,
      updated,
      unchanged,
      matched,
      unmatched,
    }, { headers: cors })
  } catch (error) {
    return bad(`Phone binding failed: ${error.message}`, 502)
  }
}