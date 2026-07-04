// Shared helpers for the Charmé catalog API (Cloudflare Pages Functions).

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...(init.headers || {}),
    },
  })

export const bad = (msg, status = 400) => json({ error: msg }, { status })

/** Decode a base64url string to bytes. */
function b64urlToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Verify a Shopify App Bridge session token (a JWT signed HS256 with the app's
 * client secret). Returns the decoded payload if valid, else null.
 * See https://shopify.dev/docs/apps/auth/session-tokens.
 */
export async function verifyShopifySessionToken(token, env) {
  const secret = env.SHOPIFY_CLIENT_SECRET
  if (!secret || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  let payload
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify(
      'HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
    )
    if (!ok) return null
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now >= Number(payload.exp)) return null
  if (payload.nbf && now < Number(payload.nbf) - 5) return null
  // aud must be this app's API key (client id) when we know it.
  if (env.SHOPIFY_CLIENT_ID && payload.aud && payload.aud !== env.SHOPIFY_CLIENT_ID) return null
  return payload
}

/**
 * Require an admin bearer token. Accepts EITHER the static ADMIN_TOKEN secret
 * (external admin subdomain / API clients) OR a valid Shopify App Bridge session
 * token (the embedded Shopify Admin app). Async because JWT verification is.
 */
export async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return false
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true
  if (await verifyShopifySessionToken(token, env)) return true
  return false
}

/** Map a D1 charm row to the catalogue shape the client expects. */
export const rowToCharm = (r) => ({
  id: r.id,
  name: r.name,
  collection: r.collection,
  category: r.category,
  tier: r.tier,
  type: r.type,
  price: r.price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  pxW: r.px_w,
  pxH: r.px_h,
  src: `/api/image/${r.image_key}`,
  hidden: !!r.hidden,
  source: r.source,
  dupOf: r.dup_of,
  dupScore: r.dup_score,
  bundle: !!r.bundle,
  bundleMax: r.bundle_max ?? null,
  minScale: 1,
  maxScale: 1,
})

export const rowToProduct = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  basePrice: r.base_price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  src: r.image_key ? `/api/image/${r.image_key}` : null,
  colourLabel: r.colour_label,
})

/** Decode a data: URL and store the bytes in KV under `img:<key>`. Returns key. */
export async function storeImage(env, key, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '')
  if (!m) throw new Error('expected a base64 data URL')
  const contentType = m[1]
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType } })
  return key
}

const slug = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item'
const rid = () => Math.random().toString(36).slice(2, 7)
export const makeId = (prefix, name) => `${prefix}-${slug(name)}-${rid()}`

