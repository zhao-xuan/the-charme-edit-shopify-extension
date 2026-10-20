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
let failed = false
const EMPTY_REMOTE = {
  products: [],
  charms: [],
  patches: [],
  overrides: {},
}

// When embedded in a Shopify theme the widget runs on the storefront origin,
// which has no `/api/catalog`. We fetch the live catalogue from the Cloudflare
// Pages base URL (explicit `CharmeConfig.apiBase`, else the production Pages URL
// as a fallback; empty when the widget is already served from Pages). The API
// replies with `access-control-allow-origin: *` so the cross-origin fetch works.
import { API_BASE, PROD_API_BASE } from './apiBase'
import { fetchPriceJson } from './contextualPrice.js'

function catalogUrls() {
  const primary = `${API_BASE}/api/catalog`
  if (API_BASE || typeof location === 'undefined') return [primary]
  const host = String(location.hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
    ? [primary, `${PROD_API_BASE}/api/catalog`]
    : [primary]
}

function authoritativeRuntime() {
  if (API_BASE) return true
  if (typeof location === 'undefined') return false
  const host = String(location.hostname || '').toLowerCase()
  return host === 'charme-customizer.pages.dev' || host.endsWith('.charme-customizer.pages.dev')
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function loadRemoteCatalog() {
  if (typeof fetch === 'undefined') return null
  const retryDelays = [0, 150, 500]
  for (const delay of retryDelays) {
    if (delay) await wait(delay)
    for (const url of catalogUrls()) {
      try {
        const data = await fetchPriceJson(url, { attempts: 1 })
        if (!Array.isArray(data?.products) || !Array.isArray(data?.charms) || !Array.isArray(data?.patches)) {
          throw new Error('catalog_invalid')
        }
        cache = data
        failed = false
        if (typeof globalThis !== 'undefined') globalThis.__CHARME_REMOTE__ = cache
        return cache
      } catch (error) {
        console.warn('charme_catalog_load_failed', { url, reason: error.message })
      }
    }
  }
  if (authoritativeRuntime()) {
    failed = true
    cache = EMPTY_REMOTE
    if (typeof globalThis !== 'undefined') globalThis.__CHARME_REMOTE__ = cache
    return cache
  }

  return null
}

export function remoteCatalogFailed() {
  return failed
}

/** The remote catalogue snapshot, or null if not loaded. */
export function remoteCatalog() {
  if (cache) return cache
  if (typeof globalThis !== 'undefined' && globalThis.__CHARME_REMOTE__) return globalThis.__CHARME_REMOTE__
  return null
}
