// GET  /api/preset/:handle — the digitised design layout for a storefront
//   "custom phone case" design, keyed by its Shopify product handle. Returns
//   { handle, title, layout } where `layout` is the seedable customizer
//   arrangement, or 404 when there is no active preset for that handle.
// POST /api/preset/:handle — upsert a preset (admin bearer token). Body:
//   { title?, layout } where layout = { productId, caseColourId, gelColourId,
//   charms:[...] }. Used by the seeding tool.
import { json, bad, requireAdmin } from '../_lib.js'

export async function onRequestGet({ params, env }) {
  const handle = String(params.handle || '').trim()
  if (!handle) return bad('missing handle', 400)
  if (!env.DB) return json({ error: 'not found' }, { status: 404 })
  const row = await env.DB.prepare(
    'SELECT handle, title, product_id, case_colour, gel_colour, layout FROM presets WHERE handle = ? AND active = 1',
  )
    .bind(handle)
    .first()
  if (!row) return json({ error: 'not found' }, { status: 404 })
  let layout
  try {
    layout = JSON.parse(row.layout)
  } catch {
    return json({ error: 'corrupt preset' }, { status: 500 })
  }
  // Belt-and-braces: ensure the finish/product fields are present even if the
  // stored JSON predates them.
  layout.productId = layout.productId || row.product_id
  layout.caseColourId = layout.caseColourId || row.case_colour
  layout.gelColourId = layout.gelColourId || row.gel_colour
  return json({ handle: row.handle, title: row.title, layout })
}

export async function onRequestPost({ request, params, env }) {
  if (!requireAdmin(request, env)) return bad('unauthorized', 401)
  const handle = String(params.handle || '').trim()
  if (!handle) return bad('missing handle', 400)
  if (!env.DB) return bad('no database bound', 500)
  let body
  try {
    body = await request.json()
  } catch {
    return bad('invalid JSON body', 400)
  }
  const layout = body.layout
  if (!layout || !Array.isArray(layout.charms)) return bad('layout.charms required', 400)
  const productId = layout.productId || 'iphone-16-pro-max'
  const caseColour = layout.caseColourId || 'white'
  const gelColour = layout.gelColourId || 'glitter'
  await env.DB.prepare(
    `INSERT INTO presets (handle, title, product_id, case_colour, gel_colour, layout, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET
       title = excluded.title,
       product_id = excluded.product_id,
       case_colour = excluded.case_colour,
       gel_colour = excluded.gel_colour,
       layout = excluded.layout,
       active = 1,
       updated_at = datetime('now')`,
  )
    .bind(handle, body.title || null, productId, caseColour, gelColour, JSON.stringify(layout))
    .run()
  return json({ ok: true, handle })
}
