import { bad, json, shopifyAdmin } from '../_lib.js'

const QUERY = `
  query ContextualVariantPrice($id: ID!, $country: CountryCode!) {
    productVariant(id: $id) {
      contextualPricing(context: { country: $country }) {
        price { amount currencyCode }
      }
    }
  }
`

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url)
  const variantId = String(url.searchParams.get('variant') || '')
  const country = String(url.searchParams.get('country') || '').toUpperCase()
  if (!/^\d{8,20}$/.test(variantId) || !/^[A-Z]{2}$/.test(country)) {
    return bad('variant and country are required')
  }

  try {
    const data = await shopifyAdmin(env, QUERY, {
      id: `gid://shopify/ProductVariant/${variantId}`,
      country,
    })
    const price = data.productVariant?.contextualPricing?.price
    const amount = Number(price?.amount)
    if (!(amount > 0) || !price?.currencyCode) return bad('No contextual price found', 404)
    return json({ amount, currency: price.currencyCode })
  } catch (error) {
    console.error('[Charmé] contextual price lookup failed', error)
    return bad('Could not load contextual price', 502)
  }
}