import { verifyShopifySessionToken } from './_lib.js'

export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/
export const INSTALL_SCHEMA = `CREATE TABLE IF NOT EXISTS shopify_installations (
  shop_id TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL, refresh_expires_at INTEGER NOT NULL,
  installed_at TEXT NOT NULL, uninstalled_at TEXT
)`

export function shopFromClaims(claims, env) {
  if (!claims || !env.SHOPIFY_CLIENT_ID || claims.aud !== env.SHOPIFY_CLIENT_ID) return null
  const shop = String(claims.dest || '').replace(/^https:\/\//, '')
  if (!SHOP_DOMAIN.test(shop) || claims.dest !== `https://${shop}` || claims.iss !== `https://${shop}/admin`) return null
  return shop
}

export async function verifiedShop(request, env) {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  return shopFromClaims(await verifyShopifySessionToken(token, env), env)
}

export async function installationsDb(env) {
  if (!env.DB) throw new Error('D1 DB is required')
  await env.DB.prepare(INSTALL_SCHEMA).run()
  return env.DB
}

function encryptionKey(env) {
  const raw = env.SHOPIFY_TOKEN_KEY || ''
  let bytes
  try { bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0)) } catch { /* invalid key */ }
  if (bytes?.length !== 32) throw new Error('SHOPIFY_TOKEN_KEY must be 32 random bytes encoded as base64')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function seal(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(value)))
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...encrypted))}`
}

async function unseal(value, env) {
  const [iv, payload] = String(value).split('.')
  if (!iv || !payload) throw new Error('Stored token is invalid')
  const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(iv), (char) => char.charCodeAt(0)) }, await encryptionKey(env), bytes))
}

async function exchange(shop, env, fields) {
  if (!SHOP_DOMAIN.test(shop) || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) throw new Error('Shopify credentials are missing')
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET, ...fields }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Shopify token exchange failed (${response.status})`)
  const body = await response.json()
  if (!body.access_token || !body.refresh_token || !Number(body.expires_in) || !Number(body.refresh_token_expires_in)) throw new Error('Shopify did not return an expiring offline token')
  return body
}

async function storeTokens(db, shop, body, env, previousRefresh = null) {
  const now = Math.floor(Date.now() / 1000)
  const access = await seal(body.access_token, env), refresh = await seal(body.refresh_token, env)
  if (previousRefresh) {
    const updated = await db.prepare(`UPDATE shopify_installations SET access_token=?,refresh_token=?,token_expires_at=?,refresh_expires_at=?
      WHERE shop_id=? AND refresh_token=? AND uninstalled_at IS NULL`).bind(
      access, refresh, now + Number(body.expires_in), now + Number(body.refresh_token_expires_in), shop, previousRefresh,
    ).run()
    return !!updated.meta?.changes
  }
  await db.prepare(`INSERT INTO shopify_installations (shop_id,access_token,refresh_token,token_expires_at,refresh_expires_at,installed_at,uninstalled_at)
    VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(shop_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,
    token_expires_at=excluded.token_expires_at,refresh_expires_at=excluded.refresh_expires_at,uninstalled_at=NULL`).bind(
    shop, access, refresh, now + Number(body.expires_in), now + Number(body.refresh_token_expires_in), new Date().toISOString(),
  ).run()
  return true
}

export async function installShop(request, env) {
  const shop = await verifiedShop(request, env)
  if (!shop) throw new Error('Invalid Shopify session token')
  const subject_token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') || '')[1]
  const body = await exchange(shop, env, {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  })
  await storeTokens(await installationsDb(env), shop, body, env)
  return shop
}

export async function installedShop(db, shop) {
  if (!SHOP_DOMAIN.test(shop)) return false
  const row = await db.prepare('SELECT shop_id FROM shopify_installations WHERE shop_id=? AND uninstalled_at IS NULL').bind(shop).first()
  return !!row
}

export async function installedShopToken(db, shop, env) {
  const row = await db.prepare('SELECT * FROM shopify_installations WHERE shop_id=? AND uninstalled_at IS NULL').bind(shop).first()
  if (!row) throw new Error('Shopify app is not installed on this store')
  const now = Math.floor(Date.now() / 1000)
  if (row.token_expires_at > now + 60) return unseal(row.access_token, env)
  if (row.refresh_expires_at <= now + 60) throw new Error('Shopify installation needs renewed authorization')
  try {
    const body = await exchange(shop, env, { grant_type: 'refresh_token', refresh_token: await unseal(row.refresh_token, env) })
    if (await storeTokens(db, shop, body, env, row.refresh_token)) return body.access_token
  } catch (error) {
    const latest = await db.prepare('SELECT * FROM shopify_installations WHERE shop_id=? AND uninstalled_at IS NULL').bind(shop).first()
    if (!latest || latest.refresh_token === row.refresh_token || latest.token_expires_at <= now + 60) throw error
    return unseal(latest.access_token, env)
  }
  const latest = await db.prepare('SELECT * FROM shopify_installations WHERE shop_id=? AND uninstalled_at IS NULL').bind(shop).first()
  if (!latest || latest.token_expires_at <= now + 60) throw new Error('Shopify installation was removed during token refresh')
  return unseal(latest.access_token, env)
}
