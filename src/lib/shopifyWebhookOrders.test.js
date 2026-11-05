import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequestPost } from '../../functions/webhooks/shopify.js'
import { analyticsDb, listOrders, recordDesignLinks, recordOrder, listDesignLinks } from '../../functions/api/_analytics-store.js'
import { studioDb } from '../../functions/api/_studio.js'
import { createSqliteD1 } from './testing/sqliteD1.js'

const probe = await createSqliteD1()
const sqlTest = probe ? test : test.skip

const SHOP = 'example.myshopify.com'
const SECRET = 'webhook-secret'
const SINCE = '1970-01-01T00:00:00.000Z'

async function sign(body, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64')
}

let deliveries = 0
async function deliver(env, topic, payload, { shop = SHOP, secret = SECRET, id = `delivery-${++deliveries}` } = {}) {
  const body = JSON.stringify(payload)
  const request = new Request('https://design.thecharmeedit.com/webhooks/shopify', {
    method: 'POST',
    headers: {
      'x-shopify-hmac-sha256': await sign(body, secret),
      'x-shopify-topic': topic,
      'x-shopify-shop-domain': shop,
      'x-shopify-webhook-id': id,
    },
    body,
  })
  return onRequestPost({ request, env })
}

const environment = async () => ({ DB: await createSqliteD1(), SHOPIFY_STORE: SHOP, SHOPIFY_CLIENT_SECRET: SECRET })

const paid = (id, tokens, extra = {}) => ({
  id,
  name: `#${id}`,
  processed_at: '2026-06-09T18:30:00Z',
  currency: 'GBP',
  total_price: '47.98',
  test: false,
  source_name: 'web',
  landing_site: '/?utm_source=instagram&utm_medium=paid_social',
  referring_site: 'https://design.thecharmeedit.com/',
  email: 'buyer@example.com',
  customer: { id: 7, first_name: 'Ada' },
  line_items: tokens.map((token) => ({ id: 1, properties: [{ name: '_design_token', value: token }] })),
  ...extra,
})

sqlTest('a paid designer order is stored without any customer data and a redelivery is ignored', async () => {
  const env = await environment()
  assert.equal((await deliver(env, 'orders/paid', paid(1001, ['cd_one']), { id: 'same-delivery' })).status, 200)
  assert.equal((await deliver(env, 'orders/paid', paid(1001, ['cd_one'], { total_price: '1.00' }), { id: 'same-delivery' })).status, 200)
  const orders = await listOrders(await analyticsDb(env), SINCE)
  assert.equal(orders.length, 1)
  assert.equal(orders[0].total, 47.98)
  assert.equal(orders[0].utmSource, 'instagram')
  assert.equal(orders[0].referringHost, 'design.thecharmeedit.com')
  assert.deepEqual(orders[0].designTokens, ['cd_one'])
  const raw = await env.DB.prepare('SELECT data FROM analytics_orders').first()
  for (const secret of ['buyer@example.com', 'Ada']) assert.equal(raw.data.includes(secret), false)
})

sqlTest('orders without a design token, orders from other shops and bad signatures store nothing', async () => {
  const env = await environment()
  assert.equal((await deliver(env, 'orders/paid', paid(1, []))).status, 200)
  assert.equal((await deliver(env, 'orders/paid', paid(2, ['cd_two']), { shop: 'other.myshopify.com' })).status, 200)
  assert.equal((await deliver(env, 'orders/paid', paid(3, ['cd_three']), { secret: 'wrong-secret' })).status, 401)
  assert.deepEqual(await listOrders(await analyticsDb(env), SINCE), [])
})

sqlTest('a malformed paid-order payload is acknowledged without storing anything', async () => {
  const env = await environment()
  assert.equal((await deliver(env, 'orders/paid', { id: 'abc', line_items: 'nope' })).status, 200)
  assert.deepEqual(await listOrders(await analyticsDb(env), SINCE), [])
})

sqlTest('a customer redaction drops only the listed orders', async () => {
  const env = await environment()
  const db = await analyticsDb(env)
  for (const id of [11, 12, 13]) await recordOrder(db, { orderId: String(id), paidAt: '2026-06-09T00:00:00.000Z', designTokens: ['t'] })
  const response = await deliver(env, 'customers/redact', { shop_domain: SHOP, customer: { id: 5 }, orders_to_redact: [11, '13', 'x; DROP TABLE analytics_orders', null] })
  assert.equal(response.status, 200)
  assert.deepEqual((await listOrders(db, SINCE)).map((order) => order.orderId), ['12'])
})

sqlTest('a customer redaction with many orders stays within D1 parameter limits', async () => {
  const env = await environment()
  const db = await analyticsDb(env)
  const ids = Array.from({ length: 250 }, (_, index) => 1000 + index)
  for (const id of ids) await recordOrder(db, { orderId: String(id), paidAt: '2026-06-09T00:00:00.000Z', designTokens: ['t'] })
  const response = await deliver(env, 'customers/redact', { shop_domain: SHOP, customer: { id: 5 }, orders_to_redact: ids })
  assert.equal(response.status, 200)
  assert.equal((await listOrders(db, SINCE)).length, 0)
})

sqlTest('a shop redaction erases the stored links and orders of this store only', async () => {
  const env = await environment()
  await studioDb(env)
  const db = await analyticsDb(env)
  await db.prepare('INSERT INTO studio_tracking_settings (shop_id, ga_measurement_id, meta_pixel_id, updated_at) VALUES (?, ?, ?, ?)')
    .bind(SHOP, 'G-TEST123', '123456789012345', new Date().toISOString()).run()
  await recordDesignLinks(db, 'session-12345678', ['cd_one'])
  await recordOrder(db, { orderId: '1', paidAt: '2026-06-09T00:00:00.000Z', designTokens: ['cd_one'] })

  assert.equal((await deliver(env, 'shop/redact', { shop_domain: 'other.myshopify.com' }, { shop: 'other.myshopify.com' })).status, 200)
  assert.equal((await listDesignLinks(db, SINCE)).length, 1, 'another shop being redacted leaves this store alone')
  assert.ok(await db.prepare('SELECT shop_id FROM studio_tracking_settings WHERE shop_id=?').bind(SHOP).first())

  assert.equal((await deliver(env, 'shop/redact', { shop_domain: SHOP })).status, 200)
  assert.equal((await listDesignLinks(db, SINCE)).length, 0)
  assert.equal((await listOrders(db, SINCE)).length, 0)
  assert.equal(await db.prepare('SELECT shop_id FROM studio_tracking_settings WHERE shop_id=?').bind(SHOP).first(), null)
})

sqlTest('the existing uninstall topic still works', async () => {
  const env = await environment()
  await studioDb(env)
  await env.DB.prepare('INSERT INTO studio_tracking_settings (shop_id, ga_measurement_id, meta_pixel_id, updated_at) VALUES (?, ?, ?, ?)')
    .bind(SHOP, 'G-TEST123', '123456789012345', new Date().toISOString()).run()
  assert.equal((await deliver(env, 'app/uninstalled', { shop_domain: SHOP })).status, 200)
  assert.equal(await env.DB.prepare('SELECT shop_id FROM studio_tracking_settings WHERE shop_id=?').bind(SHOP).first(), null)
})
