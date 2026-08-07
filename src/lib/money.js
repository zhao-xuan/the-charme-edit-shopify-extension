/**
 * Currency-aware money formatting for the customizer.
 *
 * Every price in the catalogue is stored in the shop's BASE currency (GBP). On a
 * Shopify storefront the buyer may be shopping in a different presentment
 * currency (driven by Shopify Markets / the store's currency selector). Shopify
 * injects the active currency + conversion rate client-side as
 * `window.Shopify.currency = { active, rate }` (rate = base → active), and the
 * drop-in Liquid snippet also forwards a `CharmeConfig.currency` context
 * ({ base, active, rate, locale }) so the widget can render buyer-local prices.
 *
 * `formatMoney(gbp)` therefore: (1) converts the GBP amount to the active
 * currency using that rate, then (2) formats it with `Intl.NumberFormat` in the
 * active locale + currency (so symbol placement, grouping and the number of
 * decimals — e.g. JPY has none — are all correct for the buyer).
 */
import { currentLocale } from './i18n.js'

/** Resolve the live currency context (base + active + rate + locale). */
function currencyContext() {
  const cfg =
    (typeof window !== 'undefined' && window.CharmeConfig && window.CharmeConfig.currency) || null
  const shopCur =
    (typeof window !== 'undefined' && window.Shopify && window.Shopify.currency) || null

  const base = (cfg && cfg.base) || 'GBP'
  const active = (cfg && cfg.active) || (shopCur && shopCur.active) || base

  let rate = Number(cfg && cfg.rate)
  if (!(rate > 0) && shopCur && shopCur.rate != null) rate = Number(shopCur.rate)
  if (!(rate > 0)) rate = 1

  const locale = (cfg && cfg.locale) || currentLocale()
  return { base, active, rate, locale }
}

/** Convert a base-currency (GBP) amount into the buyer's active currency. */
export function convert(gbp) {
  const { rate } = currencyContext()
  return (Number(gbp) || 0) * rate
}

/** The active presentment currency code (e.g. 'GBP', 'USD', 'EUR', 'JPY'). */
export function activeCurrency() {
  return currencyContext().active
}

/**
 * Format a base-currency (GBP) amount as a localised money string in the buyer's
 * active currency.
 *
 * @param {number} gbp   Amount in the shop base currency (GBP).
 * @param {object} [opts]
 * @param {boolean} [opts.whole]  Drop the minor units (e.g. "£52" for the CTA).
 */
export function formatMoney(gbp, opts = {}) {
  const { active, locale } = currencyContext()
  const raw = convert(gbp)
  const amount = opts.whole ? Math.round(raw) : raw
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: active,
      ...(opts.whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(amount)
  } catch {
    // Unknown/unsupported currency code → plain number prefixed with the code.
    return `${active} ${amount.toFixed(opts.whole ? 0 : 2)}`
  }
}
