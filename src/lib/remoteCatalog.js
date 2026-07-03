/**
 * remoteCatalog.js — best-effort loader for the Cloudflare-backed catalogue.
 *
 * At startup main.jsx awaits loadRemoteCatalog(), which fetches /api/catalog
 * (served by the Pages Function from D1 + KV) and stashes it globally. The
 * bundled catalogue merge (data/products.js + lib/catalog.js) then folds in the
 * remote merchant products / charms / price overrides. If the API is missing or
 * fails (e.g. local `vite` dev with no Functions), we silently fall back to the
 * bundled data, so the storefront always renders.
 */
let cache = null

// When embedded in a Shopify theme the widget runs on the storefront origin,
// which has no `/api/catalog`. The drop-in section sets `CharmeConfig.apiBase`
// to the Cloudflare Pages URL so we fetch the live D1/KV catalogue cross-origin
// (the API replies with `access-control-allow-origin: *`). Empty in the
// standalone app, where `/api/catalog` is same-origin.
const API_BASE = (
  (typeof window !== 'undefined' && window.CharmeConfig && window.CharmeConfig.apiBase) || ''
).replace(/\/$/, '')

export async function loadRemoteCatalog() {
  if (typeof fetch === 'undefined') return null
  try {
    const res = await fetch(`${API_BASE}/api/catalog`, { headers: { accept: 'application/json' } })
    if (res.ok) {
      cache = await res.json()
      if (typeof globalThis !== 'undefined') globalThis.__CHARME_REMOTE__ = cache
    }
  } catch {
    /* offline / no Functions → bundled fallback */
  }
  return cache
}

/** The remote catalogue snapshot, or null if not loaded. */
export function remoteCatalog() {
  if (cache) return cache
  if (typeof globalThis !== 'undefined' && globalThis.__CHARME_REMOTE__) return globalThis.__CHARME_REMOTE__
  return null
}
