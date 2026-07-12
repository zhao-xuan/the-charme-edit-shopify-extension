// Admin taxonomy endpoint — bulk-rename a charm category or sub-category so the
// change cascades to every charm that used the old name (used by both "rename"
// and "delete → merge into" in Admin → Categories & order).
//
//   POST /api/admin/taxonomy
//     { scope:'category',    from:'gold',   to:'Golden' }
//     { scope:'subcategory', from:'Bows',   to:'Ribbons', within?:'gold' }
//   → updates all matching charms' `category` / `collection` field. `within`
//     (optional, subcategory only) limits the rename to one parent category.
//
// Storage: Shopify metaobjects (charme_charm) when configured, else legacy D1.
import { json, bad, requireAdmin } from '../_lib.js'
import { TYPES, shopifyConfigured, listRecords, updateRecordFields } from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const { scope, from, to, within } = (await request.json().catch(() => ({}))) || {}
  if (scope !== 'category' && scope !== 'subcategory') return bad('scope must be category|subcategory')
  if (!from || !to) return bad('from and to are required')
  if (from === to && !(scope === 'subcategory' && within)) return json({ ok: true, updated: 0 }, { headers: cors })

  const field = scope === 'category' ? 'category' : 'collection'

  if (shopifyConfigured(env)) {
    const charms = await listRecords(env, TYPES.charm)
    let updated = 0
    for (const c of charms) {
      const match =
        scope === 'category'
          ? c.category === from
          : c.collection === from && (!within || c.category === within)
      if (!match || !c._gid) continue
      await updateRecordFields(env, c._gid, [{ key: field, value: to }])
      updated++
    }
    return json({ ok: true, updated }, { headers: cors })
  }

  // ---- Legacy Cloudflare D1 fallback ----
  if (env.DB) {
    if (scope === 'category') {
      const r = await env.DB.prepare('UPDATE charms SET category = ? WHERE category = ?').bind(to, from).run()
      return json({ ok: true, updated: r.meta?.changes ?? 0 }, { headers: cors })
    }
    const stmt = within
      ? env.DB.prepare('UPDATE charms SET collection = ? WHERE collection = ? AND category = ?').bind(to, from, within)
      : env.DB.prepare('UPDATE charms SET collection = ? WHERE collection = ?').bind(to, from)
    const r = await stmt.run()
    return json({ ok: true, updated: r.meta?.changes ?? 0 }, { headers: cors })
  }
  return bad('no storage configured', 500)
}
