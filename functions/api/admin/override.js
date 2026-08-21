// Admin override endpoint — re-price / resize / hide a BUNDLED base-catalogue item.
//   POST /api/admin/override  { scope:'product'|'charm', refId, price?, hidden?, sizeScale?, patchCategory?, patchCollection? }
//
// Storage: Shopify `charme_override` METAOBJECT when configured; else D1.
import { json, bad, requireAdmin } from '../_lib.js'
import {
  TYPES,
  shopifyConfigured,
  saveRecord,
  getRecord,
  overrideHandle,
} from '../_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = (await request.json().catch(() => ({}))) || {}
  const { scope, refId, price, hidden, sizeScale, shopifyVariantId, patchCategory, patchCollection } = body
  if (!scope || !refId) return bad('scope and refId required')
  if (
    Object.prototype.hasOwnProperty.call(body, 'shopifyVariantId') &&
    shopifyVariantId != null &&
    !/^\d+$/.test(String(shopifyVariantId))
  ) return bad('shopifyVariantId must be a Shopify variant ID or null')

  if (shopifyConfigured(env)) {
    const handle = overrideHandle(scope, refId)
    // Merge onto the existing override so unspecified fields are preserved
    // (mirrors the COALESCE upsert of the D1 path).
    const rec = (await getRecord(env, TYPES.override, handle)) || { scope, refId }
    rec.scope = scope
    rec.refId = refId
    if (price != null) rec.price = price
    if (hidden != null) rec.hidden = !!hidden
    if (sizeScale != null) rec.sizeScale = sizeScale
    if (patchCategory != null) rec.patchCategory = patchCategory
    if (patchCollection != null) rec.patchCollection = patchCollection
    if (Object.prototype.hasOwnProperty.call(body, 'shopifyVariantId')) {
      rec.shopifyVariantId = shopifyVariantId == null ? null : String(shopifyVariantId)
    }
    await saveRecord(env, TYPES.override, handle, rec)
    return json({ ok: true }, { headers: cors })
  }

  await env.DB.prepare(
    `INSERT INTO overrides (scope, ref_id, price, hidden, size_scale, patch_category, patch_collection) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(scope, ref_id) DO UPDATE SET
       price = COALESCE(excluded.price, overrides.price),
       hidden = COALESCE(excluded.hidden, overrides.hidden),
       size_scale = COALESCE(excluded.size_scale, overrides.size_scale),
       patch_category = COALESCE(excluded.patch_category, overrides.patch_category),
       patch_collection = COALESCE(excluded.patch_collection, overrides.patch_collection)`,
  ).bind(scope, refId, price ?? null, hidden == null ? null : hidden ? 1 : 0, sizeScale ?? null, patchCategory ?? null, patchCollection ?? null).run()
  return json({ ok: true }, { headers: cors })
}
