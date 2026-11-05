import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decryptTrackingCredential,
  encryptTrackingCredential,
} from '../../functions/api/_tracking-credentials.js'
import {
  onRequestOptions,
  onRequestGet,
  onRequestPut,
} from '../../functions/api/admin/studio/tracking-settings.js'

const SHOP = 'owner.myshopify.com'
const ADMIN_TOKEN = 'test-admin-token'
const KEY = Buffer.alloc(32, 9).toString('base64')

function fakeD1() {
  let settings = null
  return {
    async batch() {},
    prepare(sql) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async run() {
          if (sql.includes('INSERT INTO studio_tracking_settings')) {
            const [shop, ga_measurement_id, ga_api_secret_enc, meta_pixel_id, meta_access_token_enc, updated_at] = params
            settings = { shop_id: shop, ga_measurement_id, ga_api_secret_enc, meta_pixel_id, meta_access_token_enc, updated_at }
          }
          return { meta: { changes: 1 } }
        },
        async first() {
          return sql.includes('studio_tracking_settings') ? settings : null
        },
      }
    },
    getSettings: () => settings,
  }
}

function adminRequest(method, body, shop = SHOP) {
  return new Request(`https://admin.example/api/admin/studio/tracking-settings?shop=${shop}`, {
    method,
    headers: {
      origin: `https://${shop}`,
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const envFor = (DB, key = KEY) => ({
  DB,
  SHOPIFY_STORE: SHOP,
  ADMIN_TOKEN,
  SHOPIFY_CLIENT_ID: 'test-app',
  SHOPIFY_CLIENT_SECRET: 'test-secret',
  TRACKING_CREDENTIALS_KEY: key,
})

test('tracking credentials are encrypted and bound to their shop and provider', async () => {
  const env = { TRACKING_CREDENTIALS_KEY: KEY }
  const encrypted = await encryptTrackingCredential('meta-token-secret', SHOP, 'meta', env)
  assert.equal(encrypted.includes('meta-token-secret'), false)
  assert.equal(await decryptTrackingCredential(encrypted, SHOP, 'meta', env), 'meta-token-secret')
  await assert.rejects(decryptTrackingCredential(encrypted, 'other.myshopify.com', 'meta', env))
  await assert.rejects(decryptTrackingCredential(encrypted, SHOP, 'ga4', env))
  await assert.rejects(encryptTrackingCredential('secret', SHOP, 'meta', {}), /encryption is not configured/)
})

test('Tracking Admin stores secrets encrypted and never returns their values', async () => {
  const DB = fakeD1()
  const env = envFor(DB)
  const saved = await onRequestPut({
    request: adminRequest('PUT', {
      measurementId: 'G-TEST123',
      gaApiSecret: 'google-api-secret-value',
      pixelId: '123456789012345',
      metaAccessToken: 'meta-access-token-value',
    }),
    env,
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json()
  assert.deepEqual(savedBody.settings, {
    measurementId: 'G-TEST123',
    pixelId: '123456789012345',
    gaSecretConfigured: true,
    metaTokenConfigured: true,
    updatedAt: savedBody.settings.updatedAt,
  })
  assert.equal(JSON.stringify(savedBody).includes('google-api-secret-value'), false)
  assert.equal(JSON.stringify(savedBody).includes('meta-access-token-value'), false)
  assert.notEqual(DB.getSettings().ga_api_secret_enc, 'google-api-secret-value')
  assert.notEqual(DB.getSettings().meta_access_token_enc, 'meta-access-token-value')

  const loaded = await onRequestGet({ request: adminRequest('GET'), env })
  const loadedBody = await loaded.json()
  assert.equal(loaded.status, 200)
  assert.deepEqual(loadedBody.settings, savedBody.settings)
  assert.equal(JSON.stringify(loadedBody).includes('google-api-secret-value'), false)
  assert.equal(JSON.stringify(loadedBody).includes('meta-access-token-value'), false)
})

test('secret updates preserve existing values unless the merchant explicitly clears them', async () => {
  const DB = fakeD1()
  const env = envFor(DB)
  await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'G-TEST123', gaApiSecret: 'google-api-secret-value' }),
    env,
  })
  const originalCiphertext = DB.getSettings().ga_api_secret_enc
  await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'G-TEST456', pixelId: '' }),
    env,
  })
  assert.equal(DB.getSettings().ga_api_secret_enc, originalCiphertext)
  assert.equal(DB.getSettings().ga_measurement_id, 'G-TEST456')

  const cleared = await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'G-TEST456', clearGaSecret: true }),
    env,
  })
  assert.equal(DB.getSettings().ga_api_secret_enc, null)
  assert.equal((await cleared.json()).settings.gaSecretConfigured, false)
})

test('tracking settings reject cross-shop access and missing encryption keys', async () => {
  const DB = fakeD1()
  const unauthorized = await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'G-TEST123' }, 'other.myshopify.com'),
    env: envFor(DB),
  })
  assert.equal(unauthorized.status, 403)

  const missingKey = await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'G-TEST123', gaApiSecret: 'google-api-secret-value' }),
    env: envFor(DB, ''),
  })
  assert.equal(missingKey.status, 503)
  assert.equal(DB.getSettings(), null)
})

test('tracking settings validate identifiers and reject non-object requests', async () => {
  const DB = fakeD1()
  const invalidId = await onRequestPut({
    request: adminRequest('PUT', { measurementId: 'not-ga4', pixelId: 'not-numeric' }),
    env: envFor(DB),
  })
  assert.equal(invalidId.status, 400)
  const invalidBody = await onRequestPut({
    request: new Request(`https://admin.example/api/admin/studio/tracking-settings?shop=${SHOP}`, {
      method: 'PUT',
      headers: {
        origin: `https://${SHOP}`,
        authorization: `Bearer ${ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: 'null',
    }),
    env: envFor(DB),
  })
  assert.equal(invalidBody.status, 400)
})

test('tracking settings preflight permits authenticated PUT requests from the shop', async () => {
  const response = await onRequestOptions({
    request: new Request('https://admin.example/api/admin/studio/tracking-settings', {
      method: 'OPTIONS',
      headers: {
        origin: `https://${SHOP}`,
        'access-control-request-method': 'PUT',
      },
    }),
    env: envFor(fakeD1()),
  })
  assert.equal(response.status, 204)
  assert.match(response.headers.get('access-control-allow-methods'), /\bPUT\b/)
  assert.equal(response.headers.get('access-control-allow-origin'), `https://${SHOP}`)
})
