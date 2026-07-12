/**
 * adminApi.js — client for the Cloudflare-backed catalog admin API.
 * Writes require the admin token (stored in localStorage; the merchant enters it
 * once in the Admin header). Reads (catalog) are public.
 */
const TOKEN_KEY = 'charme.admin.token'

// Writes need the ADMIN_TOKEN secret, which lives in the PRODUCTION Pages
// environment. The dedicated admin subdomain is a preview deployment without it,
// so when we're on `admin.<host>` we send API calls to the bare production
// origin (CORS is enabled on the Functions). Elsewhere we use the same origin.
function apiBase() {
  if (typeof window === 'undefined') return ''
  const h = window.location.hostname
  if (/^admin\./i.test(h)) return `${window.location.protocol}//${h.replace(/^admin\./i, '')}`
  return ''
}
const url = (path) => `${apiBase()}${path}`

export const getToken = () =>
  (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || ''
export const setToken = (t) => {
  if (typeof localStorage !== 'undefined') {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }
}

/** True when running embedded inside Shopify Admin (App Bridge context). */
export const isShopifyEmbedded = () =>
  typeof window !== 'undefined' && window.__charmeEmbedded === true

/** Wait briefly for the App Bridge CDN script to define window.shopify. */
async function waitForAppBridge(ms = 4000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (window.shopify?.idToken) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !!window.shopify?.idToken
}

/**
 * Bearer credential for admin writes. Inside Shopify Admin we use the fresh
 * App Bridge session token (JWT the backend verifies with the app secret);
 * otherwise we fall back to the manually-entered ADMIN_TOKEN.
 */
async function bearer() {
  if (isShopifyEmbedded()) {
    await waitForAppBridge()
    try {
      if (window.shopify?.idToken) return await window.shopify.idToken()
    } catch { /* fall through to manual token */ }
  }
  return getToken()
}

const authHeaders = async () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${await bearer()}`,
})

async function handle(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

/** Fresh catalog snapshot from D1 (products, charms, overrides). */
export async function fetchCatalog() {
  const res = await fetch(url('/api/catalog'), { headers: { accept: 'application/json' }, cache: 'no-store' })
  return handle(res)
}

export const addCharms = async (charms) =>
  handle(await fetch(url('/api/admin/charms'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ charms }) }))

export const patchCharm = async (id, patch) =>
  handle(await fetch(url('/api/admin/charms'), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id, ...patch }) }))

export const deleteCharm = async (id) =>
  handle(await fetch(url('/api/admin/charms'), { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) }))

export const addProduct = async (product) =>
  handle(await fetch(url('/api/admin/products'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify(product) }))

export const patchProduct = async (id, patch) =>
  handle(await fetch(url('/api/admin/products'), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id, ...patch }) }))

export const deleteProduct = async (id) =>
  handle(await fetch(url('/api/admin/products'), { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) }))

export const setOverride = async (scope, refId, patch) =>
  handle(await fetch(url('/api/admin/override'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ scope, refId, ...patch }) }))

/** Merchant settings (cross-sell prompt + discount rules & codes). */
export const fetchSettings = async () =>
  handle(await fetch(url('/api/settings'), { headers: { accept: 'application/json' }, cache: 'no-store' }))

export const saveSettings = async (settings) =>
  handle(await fetch(url('/api/settings'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify(settings) }))

/**
 * Bulk-rename a charm category or sub-category so the change cascades to every
 * charm that used the old name. `scope` = 'category' | 'subcategory'; `within`
 * (optional, subcategory only) limits it to one parent category.
 */
export const renameTaxonomy = async (scope, from, to, within) =>
  handle(await fetch(url('/api/admin/taxonomy'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ scope, from, to, ...(within ? { within } : {}) }),
  }))

/** Create/update real Shopify discounts from the saved codes + rules. */
export const syncDiscounts = async () =>
  handle(await fetch(url('/api/admin/discounts'), { method: 'POST', headers: await authHeaders(), body: '{}' }))

/** List the store's Shopify products (for bundle / product pickers). */
export const fetchShopifyProducts = async (q) =>
  handle(await fetch(url(`/api/admin/shopify-products${q ? `?q=${encodeURIComponent(q)}` : ''}`), { headers: await authHeaders() }))

/** List the store's Shopify collections (for the bundle "whole collection" picker). */
export const fetchShopifyCollections = async (q) =>
  handle(await fetch(url(`/api/admin/shopify-collections${q ? `?q=${encodeURIComponent(q)}` : ''}`), { headers: await authHeaders() }))

/** The REAL sellable phone-case variants (model × gel colour) on Shopify. */
export const fetchCaseVariants = async (h) =>
  handle(await fetch(url(`/api/admin/case-variants${h ? `?handle=${encodeURIComponent(h)}` : ''}`), { headers: await authHeaders() }))

/** Update a real phone-case variant's price / availability on Shopify. */
export const updateCaseVariant = async (patch) =>
  handle(await fetch(url('/api/admin/case-variants'), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(patch) }))

/** Structural variant actions: addModel/deleteModel/addColour/deleteColour. */
export const caseVariantAction = async (body) =>
  handle(await fetch(url('/api/admin/case-variants'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) }))
