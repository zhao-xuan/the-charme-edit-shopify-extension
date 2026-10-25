import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyShopifySessionToken, requireAdmin } from '../../functions/api/_lib.js'
import { shopFromClaims, installShop, installedShopToken } from '../../functions/api/_shopify_install.js'
import { studioShop, studioAdmin, StudioError } from '../../functions/api/_studio.js'
import { verifyWebhook } from '../../functions/webhooks/shopify.js'
import { studioPath } from './api.js'
import { studioCartPermalink } from '../lib/storefrontCart.js'

const env = { SHOPIFY_CLIENT_ID: 'public-app', SHOPIFY_CLIENT_SECRET: 'secret', SHOPIFY_STORE: 'owner.myshopify.com' }
const now = () => Math.floor(Date.now() / 1000)
function jwt(shop = 'other.myshopify.com', fields = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ aud: env.SHOPIFY_CLIENT_ID, dest: `https://${shop}`, iss: `https://${shop}/admin`, nbf: now() - 5, exp: now() + 60, ...fields })).toString('base64url')
  const body = `${header}.${payload}`
  return `${body}.${createHmac('sha256', env.SHOPIFY_CLIENT_SECRET).update(body).digest('base64url')}`
}
const request = (shop, token) => new Request(`https://example.com/api/admin/studio/templates?shop=${shop}`, { headers: { authorization: `Bearer ${token}` } })
const db = { prepare: () => ({ bind: (shop) => ({ first: async () => shop === 'other.myshopify.com' ? { shop_id: shop } : null }) }) }

test('Shopify session tokens require a valid signature, audience, expiry and store origin', async () => {
  const token = jwt()
  assert.equal(shopFromClaims(await verifyShopifySessionToken(token, env), env), 'other.myshopify.com')
  assert.equal(await verifyShopifySessionToken(`${token}x`, env), null)
  assert.equal(await verifyShopifySessionToken(jwt(undefined, { aud: 'different-app' }), env), null)
  assert.equal(await verifyShopifySessionToken(jwt(undefined, { exp: now() - 1 }), env), null)
  assert.equal(shopFromClaims(await verifyShopifySessionToken(jwt('other.myshopify.com', { iss: 'https://evil.example/admin' }), env), env), null)
})

test('legacy catalogue admin rejects a valid session belonging to another merchant', async () => {
  assert.equal(await requireAdmin(request('other.myshopify.com', jwt()), env), false)
  assert.equal(await requireAdmin(request('owner.myshopify.com', jwt('owner.myshopify.com')), env), true)
})

test('Studio resolves installed tenants and rejects cross-shop admin access', async () => {
  assert.equal(await studioShop(env, request('other.myshopify.com', jwt()), db), 'other.myshopify.com')
  await assert.rejects(studioShop(env, request('missing.myshopify.com', jwt()), db), (error) => error instanceof StudioError && error.status === 403)
  assert.equal(await studioAdmin(request('other.myshopify.com', jwt()), env, db), 'other.myshopify.com')
  await assert.rejects(studioAdmin(request('owner.myshopify.com', jwt()), env, db), (error) => error instanceof StudioError && error.status === 403)
})

test('webhook HMAC authenticates the raw body', async () => {
  const raw = new TextEncoder().encode('{"shop_id":42}')
  const signature = createHmac('sha256', env.SHOPIFY_CLIENT_SECRET).update(raw).digest('base64')
  assert.equal(await verifyWebhook(raw, signature, env.SHOPIFY_CLIENT_SECRET), true)
  assert.equal(await verifyWebhook(new TextEncoder().encode('{}'), signature, env.SHOPIFY_CLIENT_SECRET), false)
})

test('Studio API keeps shop context through pagination and review requests', () => {
  assert.equal(studioPath('/api/admin/studio/requests?before=cursor', '?shop=other.myshopify.com'), '/api/admin/studio/requests?before=cursor&shop=other.myshopify.com')
})

test('reviewed design opens a native Shopify cart permalink with its design reference', () => {
  const link = new URL(studioCartPermalink('https://other.myshopify.com', { id: '123456789012', quantity: 1, properties: { 'Design ID': 'abc' } }))
  assert.equal(link.pathname, '/cart/123456789012:1')
  assert.equal(link.searchParams.get('storefront'), 'true')
  assert.deepEqual(JSON.parse(Buffer.from(link.searchParams.get('properties'), 'base64url').toString()), { 'Design ID': 'abc' })
  assert.throws(() => studioCartPermalink('https://evil.example', { id: '123456789012' }))
})

test('installation exchanges a session for encrypted expiring offline credentials and refreshes them', async () => {
  const rows = new Map(), calls = []
  const fakeDb = { prepare(sql) { return {
    bind(...args) { return {
      async run() {
        if (sql.includes('INSERT INTO shopify_installations')) rows.set(args[0], { shop_id: args[0], access_token: args[1], refresh_token: args[2], token_expires_at: args[3], refresh_expires_at: args[4], uninstalled_at: null })
        if (sql.includes('UPDATE shopify_installations SET access_token=')) {
          const row = rows.get(args[4])
          if (!row || row.refresh_token !== args[5] || row.uninstalled_at) return { meta: { changes: 0 } }
          Object.assign(row, { access_token: args[0], refresh_token: args[1], token_expires_at: args[2], refresh_expires_at: args[3] })
        }
        return { meta: { changes: 1 } }
      },
      async first() { return rows.get(args[0]) || null },
    } },
    async run() { return { meta: { changes: 0 } } },
  } } }
  const installEnv = { ...env, DB: fakeDb, SHOPIFY_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') }
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, fields: new URLSearchParams(options.body) })
    const n = calls.length
    return Response.json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, refresh_token_expires_in: 86400 })
  }
  try {
    assert.equal(await installShop(request('other.myshopify.com', jwt()), installEnv), 'other.myshopify.com')
    assert.equal(calls[0].url, 'https://other.myshopify.com/admin/oauth/access_token')
    assert.equal(calls[0].fields.get('requested_token_type'), 'urn:shopify:params:oauth:token-type:offline-access-token')
    assert.equal(calls[0].fields.get('expiring'), '1')
    assert.equal(rows.get('other.myshopify.com').access_token.includes('access-1'), false)
    assert.equal(await installedShopToken(fakeDb, 'other.myshopify.com', installEnv), 'access-1')
    rows.get('other.myshopify.com').token_expires_at = 0
    assert.equal(await installedShopToken(fakeDb, 'other.myshopify.com', installEnv), 'access-2')
    assert.equal(await installedShopToken(fakeDb, 'other.myshopify.com', installEnv), 'access-2')
    assert.equal(calls[1].fields.get('grant_type'), 'refresh_token')
    assert.equal(calls[1].fields.get('refresh_token'), 'refresh-1')
  } finally { globalThis.fetch = oldFetch }
})
