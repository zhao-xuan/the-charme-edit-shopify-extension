import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPES, listRecordsSince } from '../../functions/api/_shopify-store.js'

const env = { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-token' }
const NOW = Date.parse('2026-06-10T12:00:00Z')
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString()

// Serves `nodes` (already newest-first) in pages of `pageSize` through the same
// cursor contract Shopify uses. `failOnPage` makes that page request (1-based)
// answer with a GraphQL error, which shopifyAdmin throws on without retrying.
function fakeShopify(nodes, { pageSize = 3, failOnPage = 0 } = {}) {
  const calls = { definition: 0, pages: [] }
  const original = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    if (query.includes('metaobjectDefinitionByType')) {
      calls.definition++
      return Response.json({ data: { metaobjectDefinitionByType: { id: 'gid://shopify/MetaobjectDefinition/1', type: variables.type, fieldDefinitions: [{ key: 'data' }] } } })
    }
    assert.match(query, /sortKey:"updated_at", reverse:true/, 'the report must read newest-first')
    calls.pages.push(variables.after)
    if (calls.pages.length === failOnPage) return Response.json({ errors: [{ message: 'Shopify is unavailable' }] })
    const start = variables.after ? Number(variables.after) : 0
    const slice = nodes.slice(start, start + pageSize)
    const end = start + slice.length
    return Response.json({
      data: {
        metaobjects: {
          edges: slice.map((node) => ({ node })),
          pageInfo: { hasNextPage: end < nodes.length, endCursor: String(end) },
        },
      },
    })
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const node = (id, updatedMinutesAgo) => ({
  id: `gid://shopify/Metaobject/${id}`,
  handle: `session-${id}`,
  updatedAt: minutesAgo(updatedMinutesAgo),
  fields: [{ key: 'data', value: JSON.stringify({ sessionId: `session-${id}`, startedAt: minutesAgo(updatedMinutesAgo) }) }],
})

test('stops at the window start instead of reading every record', async () => {
  const nodes = [node(1, 5), node(2, 60), node(3, 120), node(4, 24 * 60), node(5, 48 * 60), node(6, 72 * 60), node(7, 96 * 60)]
  const shopify = fakeShopify(nodes)
  try {
    const result = await listRecordsSince(env, TYPES.analytics, NOW - 3 * 3_600_000)
    assert.deepEqual(result.records.map((record) => record.sessionId), ['session-1', 'session-2', 'session-3'])
    assert.equal(result.truncated, false)
    assert.equal(result.pages, 2, 'the second page contains the first record outside the window')
    assert.deepEqual(shopify.calls.pages, [null, '3'], 'the cursor of page one is sent for page two')
    assert.equal(result.records[0]._gid, 'gid://shopify/Metaobject/1')
  } finally { shopify.restore() }
})

test('reports a truncated window when the page budget runs out before the window start', async () => {
  const nodes = Array.from({ length: 9 }, (_, i) => node(i + 1, i + 1))
  const shopify = fakeShopify(nodes)
  try {
    const result = await listRecordsSince(env, TYPES.analytics, NOW - 30 * 86_400_000, { maxPages: 2 })
    assert.equal(result.records.length, 6)
    assert.equal(result.truncated, true)
    assert.equal(result.pages, 2)
    assert.deepEqual(result.records.map((record) => record.sessionId), nodes.slice(0, 6).map((_, i) => `session-${i + 1}`), 'the newest records are the ones kept')
  } finally { shopify.restore() }
})

test('a failure after the first page keeps the newest records and reports the window as truncated', async () => {
  const nodes = Array.from({ length: 9 }, (_, i) => node(i + 1, i + 1))
  const shopify = fakeShopify(nodes, { failOnPage: 3 })
  const logged = []
  const originalError = console.error
  console.error = (...args) => logged.push(args.join(' '))
  try {
    const result = await listRecordsSince(env, TYPES.analytics, NOW - 30 * 86_400_000)
    assert.deepEqual(result.records.map((record) => record.sessionId), nodes.slice(0, 6).map((_, i) => `session-${i + 1}`), 'the pages read before the failure are kept, newest first')
    assert.equal(result.truncated, true)
    assert.equal(result.pages, 2, 'only the pages that were actually read are counted')
    assert.equal(shopify.calls.pages.length, 3, 'the read stops at the failure instead of continuing')
    assert.equal(logged.length, 1)
    assert.match(logged[0], /Shopify is unavailable/)
  } finally {
    console.error = originalError
    shopify.restore()
  }
})

test('a failure on the first page is still an error because there is nothing to report', async () => {
  const shopify = fakeShopify([node(1, 5), node(2, 10)], { failOnPage: 1 })
  try {
    await assert.rejects(() => listRecordsSince(env, TYPES.analytics, NOW - 86_400_000), /Shopify is unavailable/)
  } finally { shopify.restore() }
})

test('a window that holds every record is complete and not truncated', async () => {
  const nodes = [node(1, 10), node(2, 20), node(3, 30), node(4, 40)]
  const shopify = fakeShopify(nodes)
  try {
    const result = await listRecordsSince(env, TYPES.analytics, NOW - 7 * 86_400_000)
    assert.equal(result.records.length, 4)
    assert.equal(result.truncated, false)
    assert.equal(result.pages, 2)
  } finally { shopify.restore() }
})

test('records updated slightly before the window start are kept so clock skew cannot drop a session', async () => {
  const sinceMs = NOW - 60 * 60_000
  // updatedAt of 70 minutes ago is 10 minutes before the window start: inside the 15 minute margin.
  const nodes = [node(1, 30), node(2, 70), node(3, 90)]
  const shopify = fakeShopify(nodes, { pageSize: 10 })
  try {
    const result = await listRecordsSince(env, TYPES.analytics, sinceMs)
    assert.deepEqual(result.records.map((record) => record.sessionId), ['session-1', 'session-2'])
    assert.equal(result.truncated, false)
  } finally { shopify.restore() }
})

test('an empty store returns an empty, complete window and looks the definition up once per type', async () => {
  const shopify = fakeShopify([])
  try {
    const first = await listRecordsSince(env, TYPES.analytics, NOW - 86_400_000)
    const second = await listRecordsSince(env, TYPES.analytics, NOW - 86_400_000)
    assert.deepEqual(first, { records: [], truncated: false, pages: 1 })
    assert.deepEqual(second, { records: [], truncated: false, pages: 1 })
    assert.ok(shopify.calls.definition <= 1, 'two reads share one definition lookup')
  } finally { shopify.restore() }
})
