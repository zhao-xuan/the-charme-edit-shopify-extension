// GET /api/image/:key — serve a charm/product image stored in KV (binding IMAGES)
// as base64 under `img:<key>`. Long-cached & immutable (keys are content-stable).
export async function onRequestGet({ params, env }) {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key
  if (!env.IMAGES || !key) return new Response('Not found', { status: 404 })
  const rec = await env.IMAGES.getWithMetadata(`img:${key}`, { type: 'arrayBuffer' })
  if (!rec || !rec.value) return new Response('Not found', { status: 404 })
  const ct = (rec.metadata && rec.metadata.contentType) || 'image/png'
  return new Response(rec.value, {
    headers: {
      'content-type': ct,
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  })
}
