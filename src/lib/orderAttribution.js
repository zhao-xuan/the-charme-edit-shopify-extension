// Reduces a Shopify `orders/paid` payload to the non-personal facts the
// attribution report needs. Names, addresses, e-mail, phone and customer ids are
// never read, so none of them can reach storage or logs.
import { sanitizeAttribution } from './trackingContext.js'

const DESIGN_TOKEN = /^[A-Za-z0-9_-]{1,128}$/
export const MAX_ORDER_DESIGN_TOKENS = 50

function host(value) {
  try {
    const name = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '')
    return name.slice(0, 80)
  } catch {
    return ''
  }
}

function landingParams(value) {
  try {
    return new URL(String(value || ''), 'https://shop.invalid').searchParams
  } catch {
    return new URLSearchParams()
  }
}

export function designTokensOf(order) {
  const tokens = new Set()
  for (const line of Array.isArray(order?.line_items) ? order.line_items : []) {
    const properties = Array.isArray(line?.properties) ? line.properties : []
    for (const property of properties) {
      if (property?.name !== '_design_token') continue
      const value = String(property.value ?? '')
      if (DESIGN_TOKEN.test(value)) tokens.add(value)
    }
  }
  return [...tokens].slice(0, MAX_ORDER_DESIGN_TOKENS)
}

/** The stored summary of a paid designer order, or null for any other order. */
export function extractOrderAttribution(order, now = Date.now()) {
  const orderId = String(order?.id ?? '')
  if (!/^\d{1,20}$/.test(orderId)) return null
  const designTokens = designTokensOf(order)
  if (!designTokens.length) return null

  const paidMs = Date.parse(order.processed_at || order.created_at)
  const params = landingParams(order.landing_site)
  const tags = sanitizeAttribution({
    source: params.get('utm_source'),
    medium: params.get('utm_medium'),
    campaign: params.get('utm_campaign'),
  })
  const total = Number(order.total_price)
  return {
    orderId,
    orderName: String(order.name ?? '').slice(0, 40),
    paidAt: new Date(Number.isFinite(paidMs) ? paidMs : now).toISOString(),
    currency: /^[A-Za-z]{3}$/.test(order.currency || '') ? order.currency.toUpperCase() : '',
    total: Number.isFinite(total) ? Math.round(total * 100) / 100 : 0,
    isTest: order.test === true,
    sourceName: String(order.source_name ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40),
    utmSource: tags?.source || '',
    utmMedium: tags?.medium || '',
    utmCampaign: tags?.campaign || '',
    referringHost: host(order.referring_site),
    designTokens,
  }
}
