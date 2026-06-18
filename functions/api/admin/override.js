// Admin override endpoint — re-price / hide a BUNDLED base-catalogue item.
//   POST /api/admin/override  { scope:'product'|'charm', refId, price?, hidden? }
import { json, bad, requireAdmin } from '../_lib.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!requireAdmin(request, env)) return bad('unauthorized', 401)
  const { scope, refId, price, hidden } = (await request.json().catch(() => ({}))) || {}
  if (!scope || !refId) return bad('scope and refId required')
  await env.DB.prepare(
    `INSERT INTO overrides (scope, ref_id, price, hidden) VALUES (?,?,?,?)
     ON CONFLICT(scope, ref_id) DO UPDATE SET
       price = COALESCE(excluded.price, overrides.price),
       hidden = COALESCE(excluded.hidden, overrides.hidden)`,
  ).bind(scope, refId, price ?? null, hidden == null ? null : hidden ? 1 : 0).run()
  return json({ ok: true }, { headers: cors })
}
