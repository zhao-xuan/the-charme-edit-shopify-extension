import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestOptions, onRequestPost } from '../../functions/api/analytics/confirm.js'
import { DAILY_LINK_BUDGET, analyticsDb, listDesignLinks, reserveLinkBudget } from '../../functions/api/_analytics-store.js'
import { createSqliteD1 } from './testing/sqliteD1.js'

const probe = await createSqliteD1()
const sqlTest = probe ? test : test.skip

const URL = 'https://design.thecharmeedit.com/api/analytics/confirm'
const STORE_ORIGIN = 'https://thecharmeedit.com'
const SINCE = '1970-01-01T00:00:00.000Z'

async function environment() {
  return { DB: await createSqliteD1(), SHOPIFY_STORE: 'example.myshopify.com' }
}

const beacon = (body, { origin = STORE_ORIGIN, ip = '203.0.113.5', type = 'text/plain;charset=UTF-8' } = {}) =>
  new Request(URL, {
    method: 'POST',
    headers: { ...(origin ? { origin } : {}), 'content-type': type, 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const stored = async (env) => {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS analytics_design_links (design_token TEXT PRIMARY KEY, session_id TEXT NOT NULL, confirmed_at TEXT NOT NULL)').run()
  return (await listDesignLinks(env.DB, SINCE)).sort((a, b) => a.designToken.localeCompare(b.designToken))
}

// Nothing in this endpoint may reach Shopify or any other service.
async function offline(run) {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('unexpected network call') }
  try { return await run() } finally { globalThis.fetch = original }
}

sqlTest('stores the confirmation exactly as the storefront beacon sends it', async () => {
  const env = await environment()
  const response = await offline(() => onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: ['cd_one', 'cd_two'] }), env }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(response.headers.get('access-control-allow-origin'), STORE_ORIGIN)
  assert.match(response.headers.get('vary'), /Origin/)
  assert.deepEqual((await stored(env)).map(({ designToken, sessionId }) => [designToken, sessionId]), [['cd_one', 'session-12345678'], ['cd_two', 'session-12345678']])
})

sqlTest('refuses other origins and a missing origin without writing anything', async () => {
  const env = await environment()
  for (const origin of ['https://evil.example', 'https://thecharmeedit.com.evil.example', 'null', '']) {
    const response = await onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: ['cd_one'] }, { origin }), env })
    assert.equal(response.status, 403, origin || '(no origin)')
  }
  assert.deepEqual(await stored(env), [])
})

sqlTest('rejects malformed, empty and oversized bodies', async () => {
  const env = await environment()
  const cases = [
    ['not json', 400],
    ['[]', 400],
    [JSON.stringify({ designTokens: ['cd_one'] }), 400],
    [JSON.stringify({ sessionId: 'short', designTokens: ['cd_one'] }), 400],
    [JSON.stringify({ sessionId: 'session-12345678' }), 400],
    [JSON.stringify({ sessionId: 'session-12345678', designTokens: [] }), 400],
    [JSON.stringify({ sessionId: 'session-12345678', designTokens: ['../bad', '', 'has space', 7, null, 'x'.repeat(129)] }), 400],
    [JSON.stringify({ sessionId: 'session-12345678', designTokens: ['cd_one'], padding: 'x'.repeat(9_000) }), 413],
  ]
  for (const [body, status] of cases) {
    const response = await onRequestPost({ request: beacon(body), env })
    assert.equal(response.status, status, body.slice(0, 60))
  }
  assert.deepEqual(await stored(env), [])
})

sqlTest('keeps only valid unique design tokens and at most twenty', async () => {
  const env = await environment()
  const tokens = ['cd_one', 'cd_one', '../bad', ...Array.from({ length: 70 }, (_, index) => `bulk-${index}`)]
  const response = await onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: tokens }), env })
  assert.equal(response.status, 200)
  const links = await stored(env)
  assert.equal(links.length, 20)
  assert.equal(new Set(links.map((link) => link.designToken)).size, 20)
  assert.equal(links.some((link) => link.designToken === '../bad'), false)
})

sqlTest('a repeated confirmation never moves a design to another session', async () => {
  const env = await environment()
  await onRequestPost({ request: beacon({ sessionId: 'session-aaaaaaaa', designTokens: ['cd_one'] }), env })
  await onRequestPost({ request: beacon({ sessionId: 'session-bbbbbbbb', designTokens: ['cd_one'] }), env })
  assert.deepEqual((await stored(env)).map((link) => link.sessionId), ['session-aaaaaaaa'])
})

sqlTest('every address together shares one daily budget, a request that does not fit is refused whole, and the next day starts afresh', async () => {
  const env = await environment()
  await analyticsDb(env)
  const realNow = Date.now
  const noon = Date.parse('2026-06-10T12:00:00Z')
  Date.now = () => noon
  try {
    const post = (count, tag, ip = '203.0.113.5') => onRequestPost({
      request: beacon({ sessionId: 'session-12345678', designTokens: Array.from({ length: count }, (_, index) => `${tag}-${index}`) }, { ip }),
      env,
    })
    assert.equal(await reserveLinkBudget(env.DB, DAILY_LINK_BUDGET - 15), true)

    assert.equal((await post(10, 'first')).status, 200)
    const refused = await post(10, 'second', '198.51.100.7')
    assert.equal(refused.status, 429)
    assert.equal((await refused.json()).error, 'rate limited')
    assert.equal((await stored(env)).length, 10, 'a refused request stores nothing, not even the part that would have fit')

    assert.equal((await post(5, 'third')).status, 200, 'a smaller request that still fits is accepted')
    assert.equal((await post(1, 'fourth')).status, 429, 'the day is now full')

    Date.now = () => noon + 86_400_000
    assert.equal((await post(1, 'fifth')).status, 200)
    assert.equal((await stored(env)).length, 16)
  } finally {
    Date.now = realNow
  }
})

sqlTest('one address is rate limited without affecting another', async () => {
  const env = await environment()
  const realNow = Date.now
  const fixed = Date.parse('2026-06-10T12:00:10Z')
  Date.now = () => fixed
  try {
    const statuses = []
    for (let index = 0; index < 32; index++) {
      const response = await onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: [`cd_${index}`] }), env })
      statuses.push(response.status)
    }
    assert.equal(statuses.filter((status) => status === 200).length, 30)
    assert.deepEqual(statuses.slice(30), [429, 429])
    assert.equal((await stored(env)).length, 30)
    const other = await onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: ['cd_other'] }, { ip: '198.51.100.7' }), env })
    assert.equal(other.status, 200)
  } finally {
    Date.now = realNow
  }
})

test('without a D1 database the beacon is refused instead of crashing', async () => {
  const response = await onRequestPost({ request: beacon({ sessionId: 'session-12345678', designTokens: ['cd_one'] }), env: {} })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'storage unavailable')
})

test('the preflight answers allowed origins only', () => {
  const preflight = (origin) => new Request(URL, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } })
  const allowed = onRequestOptions({ request: preflight(STORE_ORIGIN), env: {} })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), STORE_ORIGIN)
  assert.match(allowed.headers.get('access-control-allow-methods'), /POST/)
  assert.equal(onRequestOptions({ request: preflight('https://evil.example'), env: {} }).status, 403)
})
