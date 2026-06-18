// Admin charm endpoints (require Bearer ADMIN_TOKEN).
//   POST   /api/admin/charms   { charms:[{name,category,tier,type,price,widthMm,heightMm,pxW,pxH,src(dataURL),source,dupOf,dupScore}] }
//   PATCH  /api/admin/charms   { id, price?, hidden? }   (edit a custom charm)
//   DELETE /api/admin/charms   { id }
import { json, bad, requireAdmin, storeImage, makeId, rowToCharm } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!requireAdmin(request, env)) return bad('unauthorized', 401)
  const body = await request.json().catch(() => null)
  const items = body?.charms || (body ? [body] : [])
  if (!items.length) return bad('no charms')
  const created = []
  for (const c of items) {
    if (!c.src) return bad(`charm "${c.name}" has no image`)
    const id = c.id || makeId('charm', c.name || 'charm')
    const imageKey = await storeImage(env, id, c.src)
    await env.DB.prepare(
      `INSERT OR REPLACE INTO charms
       (id,name,collection,category,tier,type,price,width_mm,height_mm,px_w,px_h,image_key,hidden,source,dup_of,dup_score)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, c.name || 'Charm', c.collection || 'Custom', c.category || 'gold', c.tier || 'midi',
      c.type || 2, c.price ?? 2, c.widthMm || 16, c.heightMm || 16, c.pxW || null, c.pxH || null,
      imageKey, c.hidden ? 1 : 0, c.source || 'custom', c.dupOf || null, c.dupScore ?? null,
    ).run()
    const row = await env.DB.prepare('SELECT * FROM charms WHERE id = ?').bind(id).first()
    created.push(rowToCharm(row))
  }
  return json({ ok: true, charms: created }, { headers: cors })
}

export async function onRequestPatch({ request, env }) {
  if (!requireAdmin(request, env)) return bad('unauthorized', 401)
  const { id, price, hidden } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')
  if (price != null) await env.DB.prepare('UPDATE charms SET price = ? WHERE id = ?').bind(price, id).run()
  if (hidden != null) await env.DB.prepare('UPDATE charms SET hidden = ? WHERE id = ?').bind(hidden ? 1 : 0, id).run()
  return json({ ok: true }, { headers: cors })
}

export async function onRequestDelete({ request, env }) {
  if (!requireAdmin(request, env)) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')
  const row = await env.DB.prepare('SELECT image_key FROM charms WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM charms WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}
