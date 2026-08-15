import { bad, json, shopifyAdmin } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const QUERY = `
  query ContextualVariantPrices($ids: [ID!]!, $country: CountryCode!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        contextualPricing(context: { country: $country }) {
          price { amount currencyCode }
        }
      }
    }
  }
`

export async function onRequestPost({ request, env }) {
  const body = (await request.json().catch(() => ({}))) || {}
  const country = String(body.country || '').toUpperCase()
  const variantIds = [...new Set((body.variantIds || []).map(String))]
  if (!/^[A-Z]{2}$/.test(country)) return bad('country is required')
  if (!variantIds.length || variantIds.length > 250 || variantIds.some((id) => !/^\d{8,20}$/.test(id))) {
    return bad('variantIds must contain 1-250 Shopify variant IDs')
  }

  try {
    const data = await shopifyAdmin(env, QUERY, {
      ids: variantIds.map((id) => `gid://shopify/ProductVariant/${id}`),
      country,
    })
    const prices = {}
    for (const node of data.nodes || []) {
      const price = node?.contextualPricing?.price
      const amount = Number(price?.amount)
      if (!node?.id || !(amount > 0) || !price?.currencyCode) continue
      prices[node.id.split('/').pop()] = { amount, currency: price.currencyCode }
    }
    return json({ prices }, { headers: cors })
  } catch (error) {
    console.error('[Charmé] contextual prices lookup failed', error)
    return bad('Could not load contextual prices', 502)
  }
}