// Admin product endpoints (require Bearer ADMIN_TOKEN or a Shopify session token).
//   POST   /api/admin/products  { name,kind,basePrice,widthMm,heightMm,src(dataURL),colourLabel }
//   PATCH  /api/admin/products  { id, basePrice?, name? }
//   DELETE /api/admin/products  { id }
//
// Storage: Shopify `charme_product` METAOBJECT + Shopify FILES when configured;
// otherwise the legacy Cloudflare D1 + KV fallback.
import { json, bad, requireAdmin, storeImage, makeId, rowToProduct } from '../_lib.js'
import {
  TYPES,
  shopifyConfigured,
  saveRecord,
  getRecord,
  deleteRecord,
  storeImageToFiles,
} from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const p = (await request.json().catch(() => null)) || {}
  if (!p.src) return bad('product needs a body image')
  const id = p.id || makeId('prod', p.name || 'product')

  if (shopifyConfigured(env)) {
    const { url, id: imageId } = await storeImageToFiles(env, p.src, {
      filename: `${id}.png`,
      alt: p.name || 'Product',
    })
    const rec = {
      id,
      name: p.name || 'Custom product',
      kind: p.kind === 'tote' ? 'tote' : 'phone',
      basePrice: p.basePrice ?? 26,
      widthMm: p.widthMm || 75,
      heightMm: p.heightMm || 150,
      src: url,
      imageId: imageId || null,
      colourLabel: p.colourLabel || 'Default',
      active: true,
    }
    await saveRecord(env, TYPES.product, id, rec, { image: imageId })
    const { imageId: _drop, active: _a, ...product } = rec
    return json({ ok: true, product }, { headers: cors })
  }

  // ---- Legacy Cloudflare D1 + KV fallback ----
  const imageKey = await storeImage(env, id, p.src)
  await env.DB.prepare(
    `INSERT OR REPLACE INTO products
     (id,name,kind,base_price,width_mm,height_mm,image_key,colour_label,active)
     VALUES (?,?,?,?,?,?,?,?,1)`,
  ).bind(
    id, p.name || 'Custom product', p.kind === 'tote' ? 'tote' : 'phone',
    p.basePrice ?? 26, p.widthMm || 75, p.heightMm || 150, imageKey, p.colourLabel || 'Default',
  ).run()
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()
  return json({ ok: true, product: rowToProduct(row) }, { headers: cors })
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id, basePrice, name, widthMm, heightMm, src } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')

  if (shopifyConfigured(env)) {
    const rec = await getRecord(env, TYPES.product, id)
    if (!rec) return bad('not found', 404)
    if (basePrice != null) rec.basePrice = basePrice
    if (name != null) rec.name = name
    if (widthMm != null) rec.widthMm = widthMm
    if (heightMm != null) rec.heightMm = heightMm
    const imageGids = {}
    if (src && /^data:/.test(src)) {
      const { url, id: imageId } = await storeImageToFiles(env, src, { filename: `${id}.png`, alt: name || rec.name })
      rec.src = url
      imageGids.image = imageId
    }
    await saveRecord(env, TYPES.product, id, rec, imageGids)
    return json({ ok: true }, { headers: cors })
  }

  if (basePrice != null) await env.DB.prepare('UPDATE products SET base_price = ? WHERE id = ?').bind(basePrice, id).run()
  if (name != null) await env.DB.prepare('UPDATE products SET name = ? WHERE id = ?').bind(name, id).run()
  if (widthMm != null) await env.DB.prepare('UPDATE products SET width_mm = ? WHERE id = ?').bind(widthMm, id).run()
  if (heightMm != null) await env.DB.prepare('UPDATE products SET height_mm = ? WHERE id = ?').bind(heightMm, id).run()
  if (src && /^data:/.test(src)) {
    const key = await storeImage(env, id, src)
    await env.DB.prepare('UPDATE products SET image_key = ? WHERE id = ?').bind(key, id).run()
  }
  return json({ ok: true }, { headers: cors })
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')

  if (shopifyConfigured(env)) {
    await deleteRecord(env, TYPES.product, id)
    return json({ ok: true }, { headers: cors })
  }

  const row = await env.DB.prepare('SELECT image_key FROM products WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}
