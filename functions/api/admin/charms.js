// Admin charm endpoints (require Bearer ADMIN_TOKEN or a Shopify session token).
//   POST   /api/admin/charms   { charms:[{name,category,tier,type,price,widthMm,heightMm,pxW,pxH,src(dataURL),source,dupOf,dupScore,bundle,bundleMax}] }
//   PATCH  /api/admin/charms   { id, price?, hidden? }
//   DELETE /api/admin/charms   { id }
//
// Storage: when the Shopify backend is configured (SHOPIFY_STORE + creds) the
// catalogue lives in the merchant's own Shopify store — charm metadata in a
// `charme_charm` METAOBJECT and the cut-out PNG in Shopify FILES. Otherwise we
// fall back to the legacy Cloudflare D1 + KV store (local dev / un-migrated).
import { json, bad, requireAdmin, storeImage, makeId, rowToCharm } from '../_lib.js'
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

/** Build the stored charm record from an incoming payload + hosted image. */
function charmRecord(c, id, imageUrl, imageId) {
  const bundle = !!c.bundle
  return {
    id,
    name: c.name || 'Charm',
    collection: c.collection || 'Custom',
    category: c.category || 'gold',
    tier: c.tier || 'midi',
    type: c.type || 2,
    price: c.price ?? 2,
    widthMm: c.widthMm || 16,
    heightMm: c.heightMm || 16,
    pxW: c.pxW || null,
    pxH: c.pxH || null,
    src: imageUrl,
    imageId: imageId || null,
    hidden: !!c.hidden,
    source: c.source || 'custom',
    dupOf: c.dupOf || null,
    dupScore: c.dupScore ?? null,
    bundle,
    bundleMax: bundle ? Math.max(1, Number(c.bundleMax) || 1) : null,
    minScale: 1,
    maxScale: 1,
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = await request.json().catch(() => null)
  const items = body?.charms || (body ? [body] : [])
  if (!items.length) return bad('no charms')

  if (shopifyConfigured(env)) {
    const created = []
    for (const c of items) {
      if (!c.src) return bad(`charm "${c.name}" has no image`)
      const id = c.id || makeId('charm', c.name || 'charm')
      const { url, id: imageId } = await storeImageToFiles(env, c.src, {
        filename: `${id}.png`,
        alt: c.name || 'Charm',
      })
      const rec = charmRecord(c, id, url, imageId)
      await saveRecord(env, TYPES.charm, id, rec, { image: imageId })
      created.push(rec)
    }
    return json({ ok: true, charms: created }, { headers: cors })
  }

  // ---- Legacy Cloudflare D1 + KV fallback ----
  const created = []
  for (const c of items) {
    if (!c.src) return bad(`charm "${c.name}" has no image`)
    const id = c.id || makeId('charm', c.name || 'charm')
    const imageKey = await storeImage(env, id, c.src)
    const bundle = c.bundle ? 1 : 0
    const bundleMax = bundle ? Math.max(1, Number(c.bundleMax) || 1) : null
    await env.DB.prepare(
      `INSERT OR REPLACE INTO charms
       (id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source,dup_of,dup_score,bundle,bundle_max)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, c.name || 'Charm', c.collection || 'Custom', c.category || 'gold', c.tier || 'midi',
      c.type || 2, c.price ?? 2, c.widthMm || 16, c.heightMm || 16, c.pxW || null, c.pxH || null,
      imageKey, c.hidden ? 1 : 0, c.source || 'custom', c.dupOf || null, c.dupScore ?? null,
      bundle, bundleMax,
    ).run()
    const row = await env.DB.prepare('SELECT * FROM charms WHERE id = ?').bind(id).first()
    created.push(rowToCharm(row))
  }
  return json({ ok: true, charms: created }, { headers: cors })
}

export async function onRequestPatch({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id, price, hidden, widthMm, heightMm, name, category, collection, src } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')

  if (shopifyConfigured(env)) {
    const rec = await getRecord(env, TYPES.charm, id)
    if (!rec) return bad('not found', 404)
    if (price != null) rec.price = price
    if (hidden != null) rec.hidden = !!hidden
    if (widthMm != null) rec.widthMm = widthMm
    if (heightMm != null) rec.heightMm = heightMm
    if (name != null) rec.name = name
    if (category != null) rec.category = category
    if (collection != null) rec.collection = collection
    const imageGids = {}
    if (src && /^data:/.test(src)) {
      const { url, id: imageId } = await storeImageToFiles(env, src, { filename: `${id}.png`, alt: name || rec.name })
      rec.src = url
      imageGids.image = imageId
    }
    await saveRecord(env, TYPES.charm, id, rec, imageGids)
    return json({ ok: true }, { headers: cors })
  }

  if (price != null) await env.DB.prepare('UPDATE charms SET price = ? WHERE id = ?').bind(price, id).run()
  if (hidden != null) await env.DB.prepare('UPDATE charms SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, id).run()
  if (widthMm != null) await env.DB.prepare('UPDATE charms SET width_mm = ? WHERE id = ?').bind(widthMm, id).run()
  if (heightMm != null) await env.DB.prepare('UPDATE charms SET height_mm = ? WHERE id = ?').bind(heightMm, id).run()
  if (name != null) await env.DB.prepare('UPDATE charms SET name = ? WHERE id = ?').bind(name, id).run()
  if (category != null) await env.DB.prepare('UPDATE charms SET category = ? WHERE id = ?').bind(category, id).run()
  if (collection != null) await env.DB.prepare('UPDATE charms SET collection = ? WHERE id = ?').bind(collection, id).run()
  if (src && /^data:/.test(src)) {
    const key = await storeImage(env, id, src)
    await env.DB.prepare('UPDATE charms SET image_key = ? WHERE id = ?').bind(key, id).run()
  }
  return json({ ok: true }, { headers: cors })
}

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')

  if (shopifyConfigured(env)) {
    await deleteRecord(env, TYPES.charm, id)
    return json({ ok: true }, { headers: cors })
  }

  const row = await env.DB.prepare('SELECT image_key FROM charms WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM charms WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}
