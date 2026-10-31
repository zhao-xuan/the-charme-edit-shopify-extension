// Joins analytics sessions, cart confirmations and paid orders into the
// per-source funnel shown in the admin Analytics tab. Pure: callers load the data.
import { attributionLabel, orderSourceLabel } from './trackingContext.js'

const UNKNOWN_CURRENCY = '(unknown)'

const toCents = (amount) => Math.round((Number(amount) || 0) * 100)

const percentage = (numerator, denominator) =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0

function addRevenue(revenue, currency, amount) {
  const code = currency || UNKNOWN_CURRENCY
  revenue[code] = (revenue[code] || 0) + toCents(amount)
}

function money(revenue) {
  return Object.fromEntries(
    Object.entries(revenue)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cents]) => [code, cents / 100]),
  )
}

const toList = (value) => (Array.isArray(value) ? value : [])

/**
 * - `sessions`: analytics session records.
 * - `links`: `{ designToken, sessionId, confirmedAt }` cart confirmations.
 * - `orders`: summaries from `extractOrderAttribution`.
 *
 * A paid order is credited to the session that confirmed the first of its
 * design tokens to be found among `sessions`; test orders are left out. Revenue
 * is the gross order total, grouped by currency.
 */
export function buildAttributionReport({ sessions, links, orders, ordersConnected = false } = {}) {
  const bySession = new Map()
  for (const record of toList(sessions)) {
    if (record?.startedAt && record.sessionId) bySession.set(record.sessionId, record)
  }

  const tokenOwner = new Map()
  const confirmedSessions = new Set()
  const confirmations = toList(links)
    .filter((link) => link?.designToken && link.sessionId)
    .sort((a, b) => String(a.confirmedAt).localeCompare(String(b.confirmedAt)))
  for (const link of confirmations) {
    if (tokenOwner.has(link.designToken)) continue
    tokenOwner.set(link.designToken, link.sessionId)
    confirmedSessions.add(link.sessionId)
  }

  const rows = new Map()
  const rowFor = (record) => {
    const source = attributionLabel(record.attribution)
    if (!rows.has(source)) {
      rows.set(source, { source, sessions: 0, decoratedSessions: 0, purchaseClicks: 0, cartConfirmed: 0, paidOrders: 0, revenue: {} })
    }
    return rows.get(source)
  }
  for (const record of bySession.values()) {
    const row = rowFor(record)
    row.sessions += 1
    if (Number(record.decorationStartedAt) > 0) row.decoratedSessions += 1
    if (record.purchaseClicked) row.purchaseClicks += 1
    if (confirmedSessions.has(record.sessionId)) row.cartConfirmed += 1
  }

  const shopifySources = new Map()
  const matchedRevenue = {}
  let total = 0
  let matched = 0
  let testExcluded = 0
  for (const order of toList(orders)) {
    if (!order) continue
    if (order.isTest) {
      testExcluded += 1
      continue
    }
    total += 1

    const label = orderSourceLabel(order)
    const shopifyRow = shopifySources.get(label) || { source: label, orders: 0, revenue: {} }
    shopifyRow.orders += 1
    addRevenue(shopifyRow.revenue, order.currency, order.total)
    shopifySources.set(label, shopifyRow)

    const sessionId = (order.designTokens || []).map((token) => tokenOwner.get(token)).find((id) => bySession.has(id))
    if (!sessionId) continue
    matched += 1
    const row = rowFor(bySession.get(sessionId))
    row.paidOrders += 1
    addRevenue(row.revenue, order.currency, order.total)
    addRevenue(matchedRevenue, order.currency, order.total)
  }

  const sourceRows = [...rows.values()]
    .map((row) => ({ ...row, paidRate: percentage(row.paidOrders, row.sessions), revenue: money(row.revenue) }))
    .sort((a, b) => b.sessions - a.sessions || b.paidOrders - a.paidOrders || a.source.localeCompare(b.source))

  return {
    rows: sourceRows,
    totals: {
      cartConfirmedSessions: sourceRows.reduce((sum, row) => sum + row.cartConfirmed, 0),
      paidOrders: matched,
      revenue: money(matchedRevenue),
    },
    orders: {
      connected: !!ordersConnected,
      total,
      testExcluded,
      matched,
      unmatched: total - matched,
      shopifySources: [...shopifySources.values()]
        .map((row) => ({ ...row, revenue: money(row.revenue) }))
        .sort((a, b) => b.orders - a.orders || a.source.localeCompare(b.source)),
    },
  }
}
