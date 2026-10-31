import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAttributionReport } from './attributionReport.js'
import { UNATTRIBUTED_LABEL } from './trackingContext.js'

const session = (id, extra = {}) => ({
  sessionId: id,
  startedAt: '2026-06-09T10:00:00.000Z',
  decorationStartedAt: 0,
  purchaseClicked: false,
  attribution: null,
  ...extra,
})
const instagram = { source: 'instagram', medium: 'paid_social', campaign: '', clickIds: [], referrerHost: '', landingPath: '/' }
const link = (designToken, sessionId, confirmedAt = '2026-06-09T11:00:00.000Z') => ({ designToken, sessionId, confirmedAt })
const order = (orderId, designTokens, extra = {}) => ({
  orderId: String(orderId), orderName: `#${orderId}`, paidAt: '2026-06-09T12:00:00.000Z', currency: 'GBP', total: 30,
  isTest: false, sourceName: 'web', utmSource: '', utmMedium: '', utmCampaign: '', referringHost: '', designTokens, ...extra,
})

test('sessions are grouped by their recorded source with the funnel counted per source', () => {
  const report = buildAttributionReport({
    sessions: [
      session('session-ig-1', { attribution: instagram, decorationStartedAt: 5, purchaseClicked: true }),
      session('session-ig-2', { attribution: instagram, decorationStartedAt: 7 }),
      session('session-ig-3', { attribution: instagram }),
      session('session-direct', { purchaseClicked: true }),
    ],
    links: [link('d1', 'session-ig-1')],
  })
  assert.deepEqual(report.rows.map((row) => [row.source, row.sessions, row.decoratedSessions, row.purchaseClicks, row.cartConfirmed]), [
    ['instagram / paid_social', 3, 2, 1, 1],
    [UNATTRIBUTED_LABEL, 1, 0, 1, 0],
  ])
  assert.equal(report.totals.cartConfirmedSessions, 1)
})

test('a paid order is credited to the source of the session that confirmed its design', () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram }), session('session-ig-2', { attribution: instagram }), session('session-direct')],
    links: [link('d1', 'session-ig-1'), link('d2', 'session-direct')],
    orders: [
      order(1001, ['d1'], { total: 47.98, utmSource: '', referringHost: 'design.thecharmeedit.com' }),
      order(1002, ['d2'], { total: 20 }),
    ],
    ordersConnected: true,
  })
  const [ig, direct] = report.rows
  assert.deepEqual([ig.source, ig.paidOrders, ig.revenue, ig.paidRate], ['instagram / paid_social', 1, { GBP: 47.98 }, 50])
  assert.deepEqual([direct.source, direct.paidOrders, direct.revenue], [UNATTRIBUTED_LABEL, 1, { GBP: 20 }])
  assert.deepEqual(report.totals, { cartConfirmedSessions: 2, paidOrders: 2, revenue: { GBP: 67.98 } })
  assert.deepEqual(
    { connected: report.orders.connected, total: report.orders.total, matched: report.orders.matched, unmatched: report.orders.unmatched },
    { connected: true, total: 2, matched: 2, unmatched: 0 },
  )
})

test("Shopify's own source for each order is reported next to ours", () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram })],
    links: [link('d1', 'session-ig-1')],
    orders: [
      order(1, ['d1'], { referringHost: 'design.thecharmeedit.com' }),
      order(2, ['nobody'], { referringHost: 'design.thecharmeedit.com', total: 10.5 }),
      order(3, ['other'], { utmSource: 'google', utmMedium: 'cpc', total: 15.25 }),
      order(4, ['more']),
    ],
    ordersConnected: true,
  })
  assert.deepEqual(report.orders.shopifySources, [
    { source: 'design.thecharmeedit.com / referral', orders: 2, revenue: { GBP: 40.5 } },
    { source: '(direct / none)', orders: 1, revenue: { GBP: 30 } },
    { source: 'google / cpc', orders: 1, revenue: { GBP: 15.25 } },
  ])
  assert.equal(report.orders.total, 4)
  assert.equal(report.orders.matched, 1)
  assert.equal(report.orders.unmatched, 3)
})

test('test orders are counted apart and never reach revenue or the match totals', () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram })],
    links: [link('d1', 'session-ig-1')],
    orders: [order(1, ['d1'], { isTest: true, total: 999 })],
    ordersConnected: true,
  })
  assert.equal(report.orders.testExcluded, 1)
  assert.equal(report.orders.total, 0)
  assert.equal(report.orders.matched, 0)
  assert.deepEqual(report.orders.shopifySources, [])
  assert.deepEqual(report.totals.revenue, {})
  assert.equal(report.rows[0].paidOrders, 0)
})

test('orders whose design was confirmed by a session outside the period stay unmatched', () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram })],
    links: [link('old-design', 'session-from-last-quarter')],
    orders: [order(1, ['old-design', 'unknown'])],
    ordersConnected: true,
  })
  assert.equal(report.orders.matched, 0)
  assert.equal(report.orders.unmatched, 1)
  assert.deepEqual(report.totals, { cartConfirmedSessions: 0, paidOrders: 0, revenue: {} })
})

test('the first confirmation of a design token owns it, and an order matches its first known token', () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram }), session('session-direct')],
    links: [
      link('shared', 'session-direct', '2026-06-09T12:30:00.000Z'),
      link('shared', 'session-ig-1', '2026-06-09T11:00:00.000Z'),
      link('second', 'session-direct', '2026-06-09T12:30:00.000Z'),
    ],
    orders: [order(1, ['missing', 'shared', 'second'])],
    ordersConnected: true,
  })
  assert.equal(report.rows.find((row) => row.source === 'instagram / paid_social').paidOrders, 1)
  assert.equal(report.rows.find((row) => row.source === UNATTRIBUTED_LABEL).paidOrders, 0)
})

test('revenue is summed in whole pence per currency without floating point drift', () => {
  const report = buildAttributionReport({
    sessions: [session('session-ig-1', { attribution: instagram })],
    links: [link('a', 'session-ig-1'), link('b', 'session-ig-1'), link('c', 'session-ig-1')],
    orders: [
      order(1, ['a'], { total: 0.1 }),
      order(2, ['b'], { total: 0.2 }),
      order(3, ['c'], { total: 12, currency: 'EUR' }),
      order(4, ['c'], { total: 1, currency: '' }),
    ],
    ordersConnected: true,
  })
  assert.deepEqual(report.rows[0].revenue, { '(unknown)': 1, EUR: 12, GBP: 0.3 })
  assert.deepEqual(report.totals.revenue, { '(unknown)': 1, EUR: 12, GBP: 0.3 })
})

test('with no data, or before orders are connected, the report is empty but well formed', () => {
  const empty = { rows: [], totals: { cartConfirmedSessions: 0, paidOrders: 0, revenue: {} }, orders: { connected: false, total: 0, testExcluded: 0, matched: 0, unmatched: 0, shopifySources: [] } }
  assert.deepEqual(buildAttributionReport(), empty)
  assert.deepEqual(buildAttributionReport({ sessions: null, links: [], orders: [] }), empty)
  const report = buildAttributionReport({ sessions: [session('session-ig-1', { attribution: instagram })] })
  assert.equal(report.orders.connected, false)
  assert.equal(report.rows[0].sessions, 1)
  assert.equal(report.rows[0].paidRate, 0)
})

test('malformed rows are ignored instead of breaking the report', () => {
  const report = buildAttributionReport({
    sessions: [null, {}, { sessionId: 'no-start' }, session('session-ig-1', { attribution: instagram })],
    links: [null, { designToken: 'x' }, { sessionId: 'y' }, link('a', 'session-ig-1')],
    orders: [null, order(1, ['a']), { orderId: '2', total: 'abc' }],
    ordersConnected: true,
  })
  assert.equal(report.rows.length, 1)
  assert.equal(report.orders.total, 2)
  assert.equal(report.orders.matched, 1)
  assert.deepEqual(report.totals.revenue, { GBP: 30 })
})

test('the inputs are not modified', () => {
  const links = [link('b', 'session-ig-1', '2026-06-09T12:00:00.000Z'), link('a', 'session-ig-1', '2026-06-09T11:00:00.000Z')]
  const copy = JSON.parse(JSON.stringify(links))
  buildAttributionReport({ sessions: [session('session-ig-1', { attribution: instagram })], links })
  assert.deepEqual(links, copy)
})
