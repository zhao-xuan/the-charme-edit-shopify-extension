// List the store's Shopify products for the admin bundle/product pickers.
//   GET /api/admin/shopify-products?q=<search>  → { products: [{id,title,handle,image}] }
// Uses the Admin GraphQL API (read_products scope).
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { shopifyConfigured } from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const Q = `
  query($first: Int!, $query: String) {
    products(first: $first, query: $query, sortKey: TITLE) {
      edges { node { id title handle status featuredImage { url } } }
    }
  }`

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return json({ products: [] }, { headers: cors })
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || undefined
  try {
    const data = await shopifyAdmin(env, Q, { first: 100, query })
    const products = (data.products?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      status: e.node.status,
      image: e.node.featuredImage?.url || null,
    }))
    return json({ products }, { headers: cors })
  } catch (e) {
    return bad(`Shopify products query failed: ${e.message}`, 502)
  }
}
