// List the store's Shopify collections for the admin bundle "whole collection" picker.
//   GET /api/admin/shopify-collections?q=<search>  → { collections: [{id,title,handle,count}] }
// Uses the Admin GraphQL API (read_products scope covers collections).
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
    collections(first: $first, query: $query, sortKey: TITLE) {
      edges { node { id title handle productsCount { count } } }
    }
  }`

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return json({ collections: [] }, { headers: cors })
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || undefined
  try {
    const data = await shopifyAdmin(env, Q, { first: 100, query })
    const collections = (data.collections?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      count: e.node.productsCount?.count ?? null,
    }))
    return json({ collections }, { headers: cors })
  } catch (e) {
    return bad(`Shopify collections query failed: ${e.message}`, 502)
  }
}
