// Tote patch catalogue writes. Images are persisted to Shopify Files when
// configured; the D1/KV path remains available for local and legacy installs.
import { json, bad, requireAdmin, storeImage, makeId, rowToCharm } from '../_lib.js'
import { TYPES, shopifyConfigured, saveRecord, getRecord, deleteRecord, storeImageToFiles } from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

const patchRecord = (patch, id, src) => ({
  id,
  name: patch.name || 'Patch',
  collection: patch.collection || 'Custom patches',
  category: patch.category || 'unique',
  tier: patch.tier || 'midi',
  type: patch.type || 2,
  price: Number(patch.price) || 0,
  widthMm: Number(patch.widthMm) || 16,
  heightMm: Number(patch.heightMm) || 16,
  pxW: patch.pxW || null,
  pxH: patch.pxH || null,
  src,
  hidden: false,
  source: 'extracted',
  minScale: 1,
  maxScale: 1,
  ...(patch.shopifyVariantId ? { shopifyVariantId: String(patch.shopifyVariantId) } : {}),
})

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = await request.json().catch(() => null)
  const items = body?.patches || (body ? [body] : [])
  if (!items.length) return bad('no patches')
  const created = []
  for (const patch of items) {
    if (!patch.src) return bad(`patch "${patch.name}" has no image`)
    const id = patch.id || makeId('patch', patch.name || 'patch')
    if (shopifyConfigured(env)) {
      const { url } = await storeImageToFiles(env, patch.src, { filename: `${id}.png`, alt: patch.name || 'Patch' })
      const record = patchRecord(patch, id, url)
      await saveRecord(env, TYPES.patch, id, record)
      created.push(record)
    } else {
      const imageKey = await storeImage(env, id, patch.src)
      await env.DB.prepare(
        `INSERT INTO patches (id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, patch.name || 'Patch', patch.collection || 'Custom patches', patch.category || 'unique', patch.tier || 'midi', patch.type || 2, Number(patch.price) || 0, Number(patch.widthMm) || 16, Number(patch.heightMm) || 16, patch.pxW || null, patch.pxH || null, imageKey, 0, 'extracted').run()
      const row = await env.DB.prepare('SELECT * FROM patches WHERE id = ?').bind(id).first()
      created.push(rowToCharm(row))
    }
  }
  return json({ ok: true, patches: created }, { headers: cors })
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = (await request.json().catch(() => ({}))) || {}
  const { id, price, hidden, widthMm, heightMm, name, category, collection, src, shopifyVariantId } = body
  if (!id) return bad('id required')
  if (
    Object.prototype.hasOwnProperty.call(body, 'shopifyVariantId') &&
    shopifyVariantId != null &&
    !/^\d+$/.test(String(shopifyVariantId))
  ) return bad('shopifyVariantId must be a Shopify variant ID or null')
  if (shopifyConfigured(env)) {
    const record = await getRecord(env, TYPES.patch, id)
    if (!record) return bad('not found', 404)
    if (price != null) record.price = price
    if (hidden != null) record.hidden = !!hidden
    if (widthMm != null) record.widthMm = widthMm
    if (heightMm != null) record.heightMm = heightMm
    if (name != null) record.name = name
    if (category != null) record.category = category
    if (collection != null) record.collection = collection
    if (Object.prototype.hasOwnProperty.call(body, 'shopifyVariantId')) {
      record.shopifyVariantId = shopifyVariantId == null ? null : String(shopifyVariantId)
    }
    if (src && /^data:/.test(src)) {
      const image = await storeImageToFiles(env, src, { filename: `${id}.png`, alt: name || record.name })
      record.src = image.url
    }
    await saveRecord(env, TYPES.patch, id, record)
    return json({ ok: true }, { headers: cors })
  }
  if (price != null) await env.DB.prepare('UPDATE patches SET price = ? WHERE id = ?').bind(price, id).run()
  if (hidden != null) await env.DB.prepare('UPDATE patches SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, id).run()
  if (widthMm != null) await env.DB.prepare('UPDATE patches SET width_mm = ? WHERE id = ?').bind(widthMm, id).run()
  if (heightMm != null) await env.DB.prepare('UPDATE patches SET height_mm = ? WHERE id = ?').bind(heightMm, id).run()
  if (name != null) await env.DB.prepare('UPDATE patches SET name = ? WHERE id = ?').bind(name, id).run()
  if (category != null) await env.DB.prepare('UPDATE patches SET category = ? WHERE id = ?').bind(category, id).run()
  if (collection != null) await env.DB.prepare('UPDATE patches SET collection = ? WHERE id = ?').bind(collection, id).run()
  if (src && /^data:/.test(src)) {
    const imageKey = await storeImage(env, id, src)
    await env.DB.prepare('UPDATE patches SET image_key = ? WHERE id = ?').bind(imageKey, id).run()
  }
  return json({ ok: true }, { headers: cors })
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')
  if (shopifyConfigured(env)) {
    await deleteRecord(env, TYPES.patch, id)
    return json({ ok: true }, { headers: cors })
  }
  const row = await env.DB.prepare('SELECT image_key FROM patches WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM patches WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}