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

/** Require the admin bearer token (Pages secret ADMIN_TOKEN). */
export function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return false
  return true
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

