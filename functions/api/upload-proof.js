// POST /api/upload-proof  { designToken, image: "data:image/png;base64,..." }
// ---------------------------------------------------------------------------
// Stores the customizer's design preview (proof) PNG so it can ride along on the
// cart line items (property `Proof`) and be seen in the cart / order.
//
// It is stored in TWO places:
//   1. Shopify Files (Content → Files) — the durable, merchant-visible copy,
//      served from Shopify's own CDN. This URL is preferred and returned when
//      available, so proofs live in the merchant's own store (no Cloudflare
//      dependency for the merchant to view them).
//   2. Cloudflare KV (IMAGES) as img:proof-<token> — an instant fallback URL
//      (/api/image/proof-<token>) used if Shopify upload isn't configured or is
//      still processing.
// Used by shopifyCart.js (cfg.uploadEndpoint) in cart mode.

import { uploadImageToShopifyFiles } from './_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  })

export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(body.image || '')
  if (!m) return json({ error: 'expected a data:image;base64 payload' }, 400)

  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

  const token = String(body.designToken || Math.random().toString(36).slice(2)).replace(
    /[^a-z0-9_-]/gi,
    '',
  )
  const key = `proof-${token}`

  // 1) Keep an instant KV copy (fallback + backwards-compatible /api/image URL).
  let kvUrl = null
  if (env.IMAGES) {
    await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType: m[1] } })
    kvUrl = `${new URL(request.url).origin}/api/image/${key}`
  }

  // 2) Upload to the merchant's Shopify Files so the proof lives in their store.
  let shopifyUrl = null
  try {
    shopifyUrl = await uploadImageToShopifyFiles(env, bytes, {
      contentType: m[1],
      filename: `charme-proof-${token}.png`,
      alt: `Charmé design proof ${token}`,
    })
  } catch (e) {
    console.warn('[Charmé] Shopify Files upload failed, using KV URL', e && e.message)
  }

  const url = shopifyUrl || kvUrl
  if (!url) return json({ error: 'no proof storage configured' }, 503)
  return json({ url, shopifyUrl, kvUrl, source: shopifyUrl ? 'shopify' : 'kv' })
}

