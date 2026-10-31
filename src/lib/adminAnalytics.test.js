import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet } from '../../functions/api/admin/analytics.js'
import { analyticsDb, recordDesignLinks, recordOrder } from '../../functions/api/_analytics-store.js'
import { createSqliteD1 } from './testing/sqliteD1.js'

const probe = await createSqliteD1()
const sqlTest = probe ? test : test.skip

const HOUR = 3_600_000
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()
const instagram = { source: 'instagram', medium: 'paid_social', campaign: '', clickIds: [], referrerHost: '', landingPath: '/' }

const session = (id, extra = {}) => ({
  sessionId: id, startedAt: iso(-2 * HOUR), lastSeenAt: iso(-HOUR), productKind: 'phone',
  decorationStartedAt: 0, purchaseClicked: false, checkoutSucceeded: false, attribution: null, ...extra,
})
const order = (orderId, designTokens, extra = {}) => ({
  orderId: String(orderId), orderName: `#${orderId}`, paidAt: iso(-HOUR), currency: 'GBP', total: 30, isTest: false,
  sourceName: 'web', utmSource: '', utmMedium: '', utmCampaign: '', referringHost: '', designTokens, ...extra,
})

const call = (env, { days = 7, token = 'admin-secret' } = {}) => onRequestGet({
  request: new Request(`https://design.example/api/admin/analytics?days=${days}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
  env,
})

async function d1Env() {
  const DB = await createSqliteD1()
  await DB.prepare('CREATE TABLE analytics_sessions (session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, data TEXT NOT NULL)').run()
  return { ADMIN_TOKEN: 'admin-secret', DB }
}
const putSession = (DB, record) => DB.prepare('INSERT INTO analytics_sessions (session_id, started_at, last_seen_at, data) VALUES (?, ?, ?, ?)')
  .bind(record.sessionId, record.startedAt, record.lastSeenAt, JSON.stringify(record)).run()

// Serves `records` newest-first through the metaobject pagination contract.
// `failOnPage` makes that page request (1-based) answer with a GraphQL error.
function fakeShopify(records, pageSize = 100, failOnPage = 0) {
  const nodes = records.map((record) => ({
    id: `gid://shopify/Metaobject/${record.sessionId}`, handle: record.sessionId, updatedAt: record.lastSeenAt,
    fields: [{ key: 'data', value: JSON.stringify(record) }],
  }))
  const original = globalThis.fetch
  const state = { pages: 0 }
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    if (query.includes('metaobjectDefinitionByType')) {
      return Response.json({ data: { metaobjectDefinitionByType: { id: 'gid://shopify/MetaobjectDefinition/1', type: variables.type, fieldDefinitions: [{ key: 'data' }] } } })
    }
    state.pages++
    if (state.pages === failOnPage) return Response.json({ errors: [{ message: 'Shopify is unavailable' }] })
    const start = variables.after ? Number(variables.after) : 0
    const slice = nodes.slice(start, start + pageSize)
    const end = start + slice.length
    return Response.json({ data: { metaobjects: { edges: slice.map((node) => ({ node })), pageInfo: { hasNextPage: end < nodes.length, endCursor: String(end) } } } })
  }
  return { state, restore: () => { globalThis.fetch = original } }
}

sqlTest('only an admin can read the report', async () => {
  const env = await d1Env()
  assert.equal((await call(env, { token: '' })).status, 401)
  assert.equal((await call(env, { token: 'wrong' })).status, 401)
  assert.equal((await call(env)).status, 200)
})

sqlTest('the existing report keys stay and the per-source attribution is added beside them', async () => {
  const env = await d1Env()
  await putSession(env.DB, session('session-ig-0001', { attribution: instagram, decorationStartedAt: 5, purchaseClicked: true, checkoutSucceeded: true }))
  await putSession(env.DB, session('session-direct-01'))
  await putSession(env.DB, session('session-too-old-1', { startedAt: iso(-20 * 24 * HOUR), lastSeenAt: iso(-20 * 24 * HOUR) }))
  const db = await analyticsDb(env)
  await recordDesignLinks(db, 'session-ig-0001', ['cd_ig'], Date.now() - HOUR)
  await recordOrder(db, order(1001, ['cd_ig'], { total: 47.98, referringHost: 'design.thecharmeedit.com' }))
  await recordOrder(db, order(1002, ['cd_ig'], { isTest: true, total: 500 }))

  const response = await call(env)
  assert.equal(response.status, 200)
  const body = await response.json()
  for (const key of ['days', 'generatedAt', 'totals', 'byDay', 'byKind', 'devices', 'interactions', 'topDecorations']) assert.ok(key in body, key)
  assert.equal(body.totals.sessions, 2)
  assert.equal(body.totals.checkoutSuccesses, 1)
  assert.equal(body.truncated, false)
  assert.equal(body.recordsScanned, 2)

  const { attribution } = body
  assert.deepEqual(attribution.rows.map((row) => [row.source, row.sessions, row.cartConfirmed, row.paidOrders, row.revenue]), [
    ['instagram / paid_social', 1, 1, 1, { GBP: 47.98 }],
    ['(direct / unknown)', 1, 0, 0, {}],
  ])
  assert.deepEqual(attribution.totals, { cartConfirmedSessions: 1, paidOrders: 1, revenue: { GBP: 47.98 } })
  assert.deepEqual(
    { connected: attribution.orders.connected, total: attribution.orders.total, testExcluded: attribution.orders.testExcluded, matched: attribution.orders.matched },
    { connected: true, total: 1, testExcluded: 1, matched: 1 },
  )
  assert.equal(attribution.orders.shopifySources[0].source, 'design.thecharmeedit.com / referral')
  assert.equal(attribution.truncated, false)
})

sqlTest('before any order arrives the attribution reports that orders are not connected', async () => {
  const env = await d1Env()
  await putSession(env.DB, session('session-ig-0001', { attribution: instagram }))
  const { attribution } = await (await call(env)).json()
  assert.equal(attribution.orders.connected, false)
  assert.equal(attribution.rows[0].sessions, 1)
  assert.deepEqual(attribution.totals, { cartConfirmedSessions: 0, paidOrders: 0, revenue: {} })
})

sqlTest('a failing attribution read never hides the rest of the report', async () => {
  const env = await d1Env()
  await putSession(env.DB, session('session-ig-0001', { attribution: instagram }))
  env.DB.batch = async () => { throw new Error('d1 unavailable') }
  const logged = console.error
  console.error = () => {}
  try {
    const response = await call(env)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.totals.sessions, 1)
    assert.deepEqual(body.attribution, { unavailable: true })
  } finally { console.error = logged }
})

sqlTest('reading from Shopify metaobjects uses the bounded newest-first read and joins the same data', async () => {
  const env = { ...(await d1Env()), SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-token' }
  const records = [
    session('session-ig-0001', { attribution: instagram, lastSeenAt: iso(-10 * 60_000) }),
    session('session-direct-01', { lastSeenAt: iso(-20 * 60_000) }),
    session('session-old-0001', { startedAt: iso(-40 * 24 * HOUR), lastSeenAt: iso(-40 * 24 * HOUR) }),
  ]
  const db = await analyticsDb(env)
  await recordDesignLinks(db, 'session-ig-0001', ['cd_ig'], Date.now() - HOUR)
  await recordOrder(db, order(7, ['cd_ig']))
  const shopify = fakeShopify(records, 2)
  try {
    const body = await (await call(env)).json()
    assert.equal(body.totals.sessions, 2)
    assert.equal(body.recordsScanned, 2, 'the read stops at the first record older than the window')
    assert.equal(body.truncated, false)
    assert.equal(shopify.state.pages, 2, 'the second page holds the record that ends the read')
    assert.equal(body.attribution.totals.paidOrders, 1)
  } finally { shopify.restore() }
})

sqlTest('a window larger than the page budget is flagged instead of silently incomplete', async () => {
  const env = { ...(await d1Env()), SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-token' }
  const records = Array.from({ length: 60 }, (_, index) => session(`session-bulk-${String(index).padStart(4, '0')}`, { lastSeenAt: iso(-(index + 1) * 60_000) }))
  const shopify = fakeShopify(records, 1)
  try {
    const body = await (await call(env, { days: 30 })).json()
    assert.equal(body.truncated, true)
    assert.equal(body.recordsScanned, 44)
    assert.equal(body.totals.sessions, 44)
    assert.equal(shopify.state.pages, 44)
  } finally { shopify.restore() }
})

sqlTest('a Shopify read that fails part-way still serves the newest sessions, flagged as truncated', async () => {
  const env = { ...(await d1Env()), SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-token' }
  const records = Array.from({ length: 6 }, (_, index) => session(`session-bulk-${String(index).padStart(4, '0')}`, { lastSeenAt: iso(-(index + 1) * 60_000) }))
  const shopify = fakeShopify(records, 2, 2)
  const logged = console.error
  console.error = () => {}
  try {
    const response = await call(env, { days: 30 })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.truncated, true)
    assert.equal(body.recordsScanned, 2, 'the page read before the failure is kept')
    assert.equal(body.totals.sessions, 2)
    assert.equal(shopify.state.pages, 2, 'the read stops at the failure')
    assert.ok(body.attribution.rows, 'the attribution still builds from the sessions that were read')
  } finally {
    console.error = logged
    shopify.restore()
  }
})

sqlTest('without Shopify or D1 the report cannot be served', async () => {
  const response = await call({ ADMIN_TOKEN: 'admin-secret' })
  assert.equal(response.status, 503)
})
