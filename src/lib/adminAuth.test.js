import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestGet } from '../../functions/api/admin/auth.js'
import { AdminAuthenticationError, adminAuthHeaders, saveSettings, syncDecorations } from './adminApi.js'

globalThis.localStorage = { getItem: () => '' }
globalThis.window = undefined

test('admin access check distinguishes a valid token from a missing or invalid token', async () => {
  const env = { ADMIN_TOKEN: 'test-admin-token' }
  const valid = await onRequestGet({
    request: new Request('https://example.test/api/admin/auth', {
      headers: { authorization: 'Bearer test-admin-token' },
    }),
    env,
  })
  assert.equal(valid.status, 200)
  assert.deepEqual(await valid.json(), { ok: true })

  for (const authorization of ['', 'Bearer wrong-token']) {
    const invalid = await onRequestGet({
      request: new Request('https://example.test/api/admin/auth', {
        headers: authorization ? { authorization } : {},
      }),
      env,
    })
    assert.equal(invalid.status, 401)
    assert.deepEqual(await invalid.json(), { error: 'unauthorized' })
  }
})

test('settings writes are serialized so overlapping order saves cannot race', async (t) => {
  t.mock.property(globalThis, 'localStorage', { getItem: () => 'test-admin-token' })
  const calls = []
  let releaseFirst
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(JSON.parse(options.body))
    if (calls.length === 1) await new Promise((resolve) => { releaseFirst = resolve })
    return Response.json({ ok: true })
  })

  const first = saveSettings({ taxonomy: { categoryOrder: ['Gold'] } })
  const second = saveSettings({ patchTaxonomy: { categoryOrder: ['Tote'] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1)
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(calls, [
    { taxonomy: { categoryOrder: ['Gold'] } },
    { patchTaxonomy: { categoryOrder: ['Tote'] } },
  ])
})

test('standalone scan fails before fetching when the admin token is missing', async (t) => {
  t.mock.property(globalThis, 'localStorage', { getItem: () => '' })
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unauthenticated scan must not reach Shopify'))
  await assert.rejects(() => syncDecorations({ kind: 'charm', action: 'preview' }), (error) => {
    assert.ok(error instanceof AdminAuthenticationError)
    assert.equal(error.status, 401)
    assert.match(error.message, /existing admin token/)
    return true
  })
})

test('standalone authentication trims accidental whitespace without changing the saved token', async (t) => {
  t.mock.property(globalThis, 'localStorage', { getItem: () => '  existing-token \n' })
  const headers = await adminAuthHeaders()
  assert.equal(headers.authorization, 'Bearer existing-token')
})

test('rejected scan authentication is actionable and the existing token can be retried', async (t) => {
  let token = 'expired-token'
  t.mock.property(globalThis, 'localStorage', { getItem: () => token })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(options.headers.authorization)
    return calls.length === 1
      ? Response.json({ error: 'unauthorized' }, { status: 401 })
      : Response.json({ variants: [], records: [], after: null })
  })
  const body = { kind: 'charm', action: 'preview' }
  await assert.rejects(() => syncDecorations(body), AdminAuthenticationError)
  token = 'valid-existing-token'
  assert.deepEqual(await syncDecorations(body), { variants: [], records: [], after: null })
  assert.deepEqual(calls, ['Bearer expired-token', 'Bearer valid-existing-token'])
})

test('embedded scans use fresh App Bridge tokens instead of a saved standalone token', async (t) => {
  let counter = 0
  t.mock.property(globalThis, 'window', {
    __charmeEmbedded: true,
    shopify: { idToken: async () => `session-${++counter}` },
  })
  t.mock.property(globalThis, 'localStorage', { getItem: () => 'standalone-token' })
  assert.equal((await adminAuthHeaders()).authorization, 'Bearer session-1')
  assert.equal((await adminAuthHeaders()).authorization, 'Bearer session-2')
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'unauthorized' }, { status: 401 }))
  await assert.rejects(() => syncDecorations({ kind: 'patch', action: 'preview' }), /Reopen this app from Shopify Admin/)
})
