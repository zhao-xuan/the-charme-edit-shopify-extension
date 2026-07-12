// Merchant settings endpoint — cross-sell prompt + discount rules & codes.
//   GET  /api/settings            → public, returns the settings JSON (or {})
//   POST /api/settings  { ... }   → admin, saves the settings JSON
//
// Storage: Shopify `charme_override` metaobject (handle `app-settings`, an
// app-owned record holding a `data` JSON blob) when configured; else KV.
import { json, bad, requireAdmin } from './_lib.js'
import { TYPES, shopifyConfigured, saveRecord, getRecord } from './_shopify-store.js'

const SETTINGS_HANDLE = 'app-settings'
const KV_KEY = 'settings:app'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

/** Strip storage-internal keys before returning to the client. */
function clean(rec) {
  if (!rec || typeof rec !== 'object') return {}
  const { _gid, _handle, ...rest } = rec
  return rest
}

export async function onRequestGet({ env }) {
  try {
    if (shopifyConfigured(env)) {
      const rec = await getRecord(env, TYPES.override, SETTINGS_HANDLE)
      return json(clean(rec) || {}, { headers: cors })
    }
    if (env.IMAGES) {
      const raw = await env.IMAGES.get(KV_KEY)
      return json(raw ? JSON.parse(raw) : {}, { headers: cors })
    }
  } catch {
    /* fall through to empty */
  }
  return json({}, { headers: cors })
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const body = (await request.json().catch(() => ({}))) || {}
  // Merge only the known top-level keys that were actually provided onto the
  // existing settings, so a partial save (e.g. the Discount tab) never wipes
  // another tab's data (e.g. the taxonomy order).
  const KNOWN = ['crossSellHint', 'crossSell', 'discounts', 'taxonomy']
  const patch = {}
  for (const k of KNOWN) if (k in body) patch[k] = body[k]

  const DEFAULTS = {
    crossSellHint: '',
    crossSell: {},
    discounts: { rules: [], codes: [], bundles: [] },
    taxonomy: { categoryOrder: [], subOrder: {}, charmOrder: {} },
  }

  if (shopifyConfigured(env)) {
    const existing = clean(await getRecord(env, TYPES.override, SETTINGS_HANDLE)) || {}
    const settings = { ...DEFAULTS, ...existing, ...patch }
    await saveRecord(env, TYPES.override, SETTINGS_HANDLE, { scope: 'settings', ...settings })
    return json({ ok: true }, { headers: cors })
  }
  if (env.IMAGES) {
    let existing = {}
    try { const raw = await env.IMAGES.get(KV_KEY); existing = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
    const settings = { ...DEFAULTS, ...existing, ...patch }
    await env.IMAGES.put(KV_KEY, JSON.stringify(settings))
    return json({ ok: true }, { headers: cors })
  }
  return bad('no storage configured', 500)
}
