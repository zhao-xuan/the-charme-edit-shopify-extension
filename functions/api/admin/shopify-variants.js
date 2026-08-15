// List Shopify charm variants for Admin decoration associations.
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { TYPES, listRecords, shopifyConfigured } from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const Q = `
  query($after: String) {
    products(first: 250, after: $after) {
      edges { node {
        title handle
        featuredMedia { preview { image { url } } }
        variants(first: 250) { edges { node { id title price availableForSale image { url } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`

const Q_LINKED = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id title price availableForSale image { url }
        product { title handle featuredMedia { preview { image { url } } } }
      }
    }
  }`

const asVariant = (variant, product) => ({
  id: String(variant.id || '').split('/').pop(),
  title: variant.title || 'Default title',
  productTitle: product?.title || '',
  handle: product?.handle || '',
  imageUrl: variant.image?.url || product?.featuredMedia?.preview?.image?.url || '',
  price: Number(variant.price) || 0,
  available: !!variant.availableForSale,
})

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return json({ variants: [] }, { headers: cors })

  try {
    const variants = []
    let after = null
    do {
      const data = await shopifyAdmin(env, Q, { after })
      const connection = data.products
      for (const { node: product } of connection?.edges || []) {
        for (const { node: variant } of product.variants?.edges || []) {
          variants.push(asVariant(variant, product))
        }
      }
      after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null
    } while (after)

    // Some valid charm products, such as "Letters / Initials", do not include
    // "Charm" in their title. Resolve every existing decoration association by
    // ID so saved selections always retain their visual label without loading
    // the store's entire variant catalogue.
    const records = await Promise.all([
      listRecords(env, TYPES.charm),
      listRecords(env, TYPES.patch),
      listRecords(env, TYPES.product),
      listRecords(env, TYPES.override),
    ])
    const linkedIds = [...new Set(records
      .flat()
      .map((record) => String(record.shopifyVariantId || ''))
      .filter((id) => /^\d+$/.test(id)))]
    const knownIds = new Set(variants.map((variant) => variant.id))
    for (let index = 0; index < linkedIds.length; index += 100) {
      const ids = linkedIds
        .slice(index, index + 100)
        .filter((id) => !knownIds.has(id))
        .map((id) => `gid://shopify/ProductVariant/${id}`)
      if (!ids.length) continue
      const linked = await shopifyAdmin(env, Q_LINKED, { ids })
      for (const variant of linked.nodes || []) {
        if (!variant?.id) continue
        const item = asVariant(variant, variant.product)
        variants.push(item)
        knownIds.add(item.id)
      }
    }
    return json({ variants }, { headers: cors })
  } catch (error) {
    return bad(`Shopify variants query failed: ${error.message}`, 502)
  }
}