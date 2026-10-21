import { fetchPriceJson } from './contextualPrice.js'
import { charmPricingGroupFor } from './charmPricing.js'

const PRICE_BATCH_SIZE = 250
const PRICE_ENDPOINT = '/api/shopify/contextual-prices'

export function asShopifyVariantId(value) {
  if (value == null) return null
  const match = String(value).trim().match(/(\d{8,20})$/)
  return match ? match[1] : null
}

export function decorationVariantId(item, variantMap = {}) {
  return asShopifyVariantId(
    variantMap.charms?.[item?.charmId || item?.id] || item?.shopifyVariantId,
  )
}

export function decorationPriceRequestKey(items, pricingGroups, variantMap = {}) {
  const ids = [
    ...items.map((item) => decorationVariantId(item, variantMap)),
    ...pricingGroups.map((group) =>
      asShopifyVariantId(variantMap.charmPricingGroups?.[group.id] || group.shopifyVariantId),
    ),
  ]
  return [...new Set(ids.filter(Boolean))].sort().join('|')
}

export function chargeLineVariantId(line, variantMap = {}) {
  if (line?.kind === 'group') {
    return asShopifyVariantId(
      variantMap.charmPricingGroups?.[line.rule.id] || line.rule.shopifyVariantId,
    )
  }
  return decorationVariantId(line?.items?.[0], variantMap)
}

export function productVariantId(product, caseId, gelId, variantMap = {}, baseVariants = {}) {
  const products = { ...baseVariants, ...variantMap.products }
  return asShopifyVariantId(
    products[`${product.id}:${gelId || caseId}`] ||
    products[`${product.id}:${caseId}`] ||
    products[product.id] ||
    product.shopifyVariantId ||
    products[`other:${gelId || caseId}`],
  )
}

export function hasUnavailablePrices({ productFailed, decorationStatus, items, pricingGroups, prices, variantMap }) {
  if (productFailed || decorationStatus === 'error') return true
  if (decorationStatus !== 'ready') return false
  return items.some((item) => {
    const group = charmPricingGroupFor(item, pricingGroups)
    const id = group
      ? asShopifyVariantId(variantMap.charmPricingGroups?.[group.id] || group.shopifyVariantId)
      : decorationVariantId(item, variantMap)
    return !id || prices[id] == null
  })
}

export async function fetchContextualVariantPrices({
  apiBase,
  country,
  currency,
  variantIds,
  fetchImpl = fetch,
  signal,
  timeoutMs,
}) {
  const ids = [...new Set((variantIds || []).map(asShopifyVariantId).filter(Boolean))]
  const prices = {}
  for (let offset = 0; offset < ids.length; offset += PRICE_BATCH_SIZE) {
    if (signal?.aborted) throw new Error('market_price_cancelled')
    const data = await fetchPriceJson(new URL(PRICE_ENDPOINT, apiBase), {
      fetchImpl,
      timeoutMs,
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        country,
        variantIds: ids.slice(offset, offset + PRICE_BATCH_SIZE),
      }),
      signal,
    })
    if (!data?.prices || typeof data.prices !== 'object' || Array.isArray(data.prices)) {
      throw new Error('market_price_invalid')
    }
    for (const [id, quote] of Object.entries(data.prices || {})) {
      const amount = Number(quote?.amount)
      if (!ids.includes(id) || quote?.amount == null || !Number.isFinite(amount) || amount < 0) {
        throw new Error('market_price_invalid')
      }
      if (quote.currency !== currency) {
        const error = new Error('market_price_currency_mismatch')
        // Shopify's currency for the country wins over a stale link/cart currency.
        if (/^[A-Z]{3}$/.test(quote?.currency || '')) error.actualCurrency = quote.currency
        throw error
      }
      prices[id] = amount
    }
  }
  return prices
}
