// List Shopify variants for Admin decoration associations and imports.
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { TYPES, listRecords, shopifyConfigured } from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const Q = `
  query($after: String, $query: String) {
    productVariants(first: 100, after: $after, query: $query) {
      edges { node {
        id title price availableForSale image { url }
        product {
          title handle
          featuredMedia { preview { image { url } } }
        }
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

async function queryVariants(env, query, variables) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await shopifyAdmin(env, query, variables)
    } catch (error) {
      if (attempt >= 4 || !/"code"\s*:\s*"THROTTLED"/.test(error.message)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    }
  }
}

export async function shopifyVariantsByIds(env, variantIds) {
  const ids = [...new Set(variantIds)]
  const variants = []
  for (let index = 0; index < ids.length; index += 100) {
    const data = await queryVariants(env, Q_LINKED, {
      ids: ids.slice(index, index + 100).map((id) => `gid://shopify/ProductVariant/${id}`),
    })
    if (!Array.isArray(data.nodes)) throw new Error('Shopify did not return the requested variants')
    for (const variant of data.nodes) {
      if (variant?.id) variants.push(asVariant(variant, variant.product))
    }
  }
  return variants
}

export async function shopifyVariantPage(env, after = null, query = null) {
  const data = await queryVariants(env, Q, { after, query })
  const connection = data.productVariants
  if (!connection) throw new Error('Shopify did not return the variant catalogue')
  return {
    variants: connection.edges.map(({ node }) => asVariant(node, node.product)),
    after: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  }
}

export async function shopifyVariantBatch(env, after = null) {
  const variants = []
  for (let page = 0; page < 5; page++) {
    const result = await shopifyVariantPage(env, after)
    variants.push(...result.variants)
    after = result.after
    if (!after) break
  }
  return { variants, after }
}

export async function listShopifyVariants(env) {
  const variants = []
  let after = null
  do {
    const page = await shopifyVariantPage(env, after)
    variants.push(...page.variants)
    after = page.after
  } while (after)
  return variants
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Configure Shopify before linking billing variants', 409)

  try {
    const params = new URL(request.url).searchParams
    if (params.has('q')) {
      const search = params.get('q').trim()
      if (!search || search.length > 200) return bad('Search must contain 1–200 characters')
      if (/^\d+$/.test(search)) {
        return json({ variants: await shopifyVariantsByIds(env, [search]), after: null }, { headers: cors })
      }
      const terms = search.match(/[\p{L}\p{N}]+/gu) || []
      if (!terms.length) return bad('Enter a product name or variant ID')
      const productQuery = `(${terms.map((term) => `title:${term}*`).join(' AND ')}) OR handle:${terms.join('-')}*`
      const products = await queryVariants(env, `
        query($query: String!) {
          products(first: 50, query: $query) { nodes { id } pageInfo { hasNextPage } }
        }`, { query: productQuery })
      if (!products.products?.nodes) throw new Error('Shopify did not return matching products')
      if (products.products.pageInfo.hasNextPage) return bad('Too many matching products; enter a more specific name')
      const ids = products.products.nodes.map((product) => product.id.split('/').pop())
      if (!ids.length) return json({ variants: [], after: null }, { headers: cors })
      const query = ids.map((id) => `product_id:${id}`).join(' OR ')
      return json(await shopifyVariantPage(env, params.get('after') || null, query), { headers: cors })
    }
    if (params.get('paged') === '1') {
      return json(await shopifyVariantBatch(env, params.get('after') || null), { headers: cors })
    }
    const variants = await listShopifyVariants(env)

    // Some valid charm products, such as "Letters / Initials", do not include
    // "Charm" in their title. Resolve every existing decoration association by
    // ID so saved selections retain their visual label even for unlisted products.
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