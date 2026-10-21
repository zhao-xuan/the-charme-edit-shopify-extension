/**
 * Currency-aware money formatting for the customizer.
 *
 * Catalogue prices are stored in the shop's BASE currency (GBP). When no
 * contextual variant price is available, Shopify injects the active currency +
 * conversion rate client-side as
 * `window.Shopify.currency = { active, rate }` (rate = base → active), and the
 * drop-in Liquid snippet also forwards a `CharmeConfig.currency` context
 * ({ base, active, rate, locale }) so the widget can render buyer-local prices.
 *
 * Confirmed Shopify variant presentment prices take precedence over these
 * estimates in cart mode. `formatMoney(gbp)` therefore: (1) converts the GBP amount to the active
 * currency using that rate, (2) rounds the converted price up to a whole
 * presentment-currency unit, matching the merchant's Shopify Markets round-up
 * policy, then (3) formats it with `Intl.NumberFormat` in the active locale +
 * currency.
 */
import { currentLocale } from './i18n.js'
import { charmChargeLines, toteDiscountRate } from './charmPricing.js'

export function chargeLinePresentmentTotal(line) {
  const marketUnitPrice = line.kind === 'group'
    ? line.rule.presentmentPrice
    : line.items[0]?.presentmentPrice
  if (marketUnitPrice != null && Number.isFinite(Number(marketUnitPrice))) {
    return Number(marketUnitPrice) * line.quantity
  }
  return convert(line.unitPrice) * line.quantity
}

export function designPriceEstimate(product, placed, groups, { applyToteDiscount = true } = {}) {
  const lines = charmChargeLines(placed, groups)
  const rawCharmTotal = lines.reduce((sum, line) => sum + chargeLinePresentmentTotal(line), 0)
  const discountRate = applyToteDiscount && product.kind === 'tote' ? toteDiscountRate(placed.length) : 0
  const discountAmount = +(rawCharmTotal * discountRate).toFixed(2)
  const casePrice = Number(product.presentmentPrice) > 0 ? Number(product.presentmentPrice) : convert(product.basePrice)
  return { rawCharmTotal, discountRate, discountAmount, casePrice, total: +(casePrice + rawCharmTotal - discountAmount).toFixed(2) }
}

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
  const raw = (Number(gbp) || 0) * rate
  return Math.ceil(raw - Number.EPSILON)
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
 */
export function formatMoney(gbp) {
  const { active, locale } = currencyContext()
  const raw = convert(gbp)
  const amount = raw
  return formatCurrency(amount, active, locale)
}

/** Format an amount already supplied by Shopify in the active currency. */
export function formatPresentmentMoney(amount) {
  const { active, locale } = currencyContext()
  return formatCurrency(Number(amount) || 0, active, locale)
}

function formatCurrency(amount, active, locale) {
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: active,
    }).format(amount)
  } catch {
    // Unknown/unsupported currency code → plain number prefixed with the code.
    return `${active} ${amount.toFixed(2)}`
  }
}
