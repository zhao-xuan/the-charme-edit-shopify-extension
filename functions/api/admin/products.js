// Admin product endpoints (require Bearer ADMIN_TOKEN).
//   POST   /api/admin/products  { name,kind,basePrice,widthMm,heightMm,src(dataURL),colourLabel }
//   DELETE /api/admin/products  { id }
import { json, bad, requireAdmin, storeImage, makeId, rowToProduct } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const p = (await request.json().catch(() => null)) || {}
  if (!p.src) return bad('product needs a body image')
  const id = p.id || makeId('prod', p.name || 'product')
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

export async function onRequestDelete({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { id } = (await request.json().catch(() => ({}))) || {}
  if (!id) return bad('id required')
  const row = await env.DB.prepare('SELECT image_key FROM products WHERE id = ?').bind(id).first()
  if (row?.image_key) await env.IMAGES.delete(`img:${row.image_key}`)
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run()
  return json({ ok: true }, { headers: cors })
}
