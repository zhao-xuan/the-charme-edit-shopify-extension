import { SHOP_DOMAIN } from '../api/_shopify_install.js'
import { studioDb } from '../api/_studio.js'

const TOPICS = new Set(['customers/data_request', 'customers/redact', 'shop/redact', 'app/uninstalled'])

export async function verifyWebhook(body, signature, secret) {
  if (!signature || !secret) return false
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    return await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)), body)
  } catch { return false }
}

export async function onRequestPost({ request, env }) {
  const raw = await request.arrayBuffer()
  if (raw.byteLength > 256_000) return new Response('Webhook too large', { status: 413 })
  if (!await verifyWebhook(raw, request.headers.get('x-shopify-hmac-sha256'), env.SHOPIFY_CLIENT_SECRET)) return new Response('Invalid HMAC', { status: 401 })
  const topic = request.headers.get('x-shopify-topic')
  const shop = request.headers.get('x-shopify-shop-domain')
  const id = request.headers.get('x-shopify-webhook-id')
  if (!TOPICS.has(topic) || !SHOP_DOMAIN.test(shop || '') || !id || id.length > 128) return new Response('Invalid webhook metadata', { status: 400 })
  let payload
  try { payload = JSON.parse(new TextDecoder().decode(raw)) } catch { return new Response('Invalid webhook JSON', { status: 400 }) }
  const bodyShop = payload.shop_domain || payload.myshopify_domain
  if ((bodyShop && bodyShop !== shop) || (topic === 'shop/redact' && bodyShop !== shop)) return new Response('Shop mismatch', { status: 400 })
  try {
    // All Shopify callbacks are retryable. This log also records privacy requests.
    const db = await studioDb(env)
    await db.prepare('CREATE TABLE IF NOT EXISTS shopify_webhook_events (id TEXT PRIMARY KEY, topic TEXT NOT NULL, processed_at TEXT NOT NULL)').run()
    if (await db.prepare('SELECT id FROM shopify_webhook_events WHERE id=?').bind(id).first()) return new Response(null, { status: 200 })
    if (topic === 'app/uninstalled') {
      await db.prepare("UPDATE shopify_installations SET access_token='',refresh_token='',token_expires_at=0,refresh_expires_at=0,uninstalled_at=? WHERE shop_id=?").bind(new Date().toISOString(), shop).run()
    } else if (topic === 'shop/redact') {
      await db.batch([
        db.prepare('DELETE FROM studio_designs WHERE shop_id=?').bind(shop),
        db.prepare('DELETE FROM studio_templates WHERE shop_id=?').bind(shop),
        db.prepare('DELETE FROM shopify_installations WHERE shop_id=?').bind(shop),
      ])
    }
    await db.prepare('INSERT OR IGNORE INTO shopify_webhook_events (id,topic,processed_at) VALUES (?,?,?)').bind(id, topic, new Date().toISOString()).run()
    // Designs are anonymous and have no Shopify customer ID/email. Customer
    // data requests/redactions therefore have no identifiable rows to export.
    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('[shopify-webhook]', error.message)
    return new Response('Retry later', { status: 500 })
  }
}
