/**
 * adminApi.js — client for the Cloudflare-backed catalog admin API.
 * Writes require the admin token (stored in localStorage; the merchant enters it
 * once in the Admin header). Reads (catalog) are public.
 */
const TOKEN_KEY = 'charme.admin.token'
import { API_BASE } from './apiBase.js'

// Admin writes and storefront reads must target the same catalogue, including
// branch previews and an explicit CharmeConfig.apiBase.
const url = (path) => `${API_BASE}${path}`

export const getToken = () =>
  (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem(TOKEN_KEY)) || ''
export const setToken = (t) => {
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function' && typeof localStorage.removeItem === 'function') {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }
}

/** True when running embedded inside Shopify Admin (App Bridge context). */
export const isShopifyEmbedded = () =>
  typeof window !== 'undefined' && window.__charmeEmbedded === true

export class AdminAuthenticationError extends Error {
  constructor() {
    super(isShopifyEmbedded()
      ? 'Shopify authentication expired or was rejected. Reopen this app from Shopify Admin, then retry. No items were saved by this request.'
      : 'Admin authentication is required. Enter your existing admin token, then retry. No items were saved by this request.')
    this.name = 'AdminAuthenticationError'
    this.status = 401
  }
}

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
    } catch { /* fail closed below */ }
    throw new AdminAuthenticationError()
  }
  const token = getToken().trim()
  if (!token) throw new AdminAuthenticationError()
  return token
}

const authHeaders = async () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${await bearer()}`,
})

// Reuse the established App Bridge / internal admin authentication for new tools.
export const adminAuthHeaders = authHeaders

export const verifyAdminAccess = async () =>
  handle(await fetch(url('/api/admin/auth'), {
    headers: await authHeaders(),
    cache: 'no-store',
  }))

async function handle(res) {
  if (!res.ok) {
    if (res.status === 401) throw new AdminAuthenticationError()
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

/** Fresh catalog snapshot from D1 (products, charms, overrides). */
export async function fetchCatalog() {
  const res = await fetch(url('/api/catalog?fresh=1'), { headers: { accept: 'application/json' }, cache: 'no-store' })
  return handle(res)
}

export const addCharms = async (charms) =>
  handle(await fetch(url('/api/admin/charms'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ charms }) }))

export const addPatches = async (patches) =>
  handle(await fetch(url('/api/admin/patches'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ patches }) }))

export const patchPatch = async (id, patch) =>
  handle(await fetch(url('/api/admin/patches'), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id, ...patch }) }))

export const deletePatch = async (id) =>
  handle(await fetch(url('/api/admin/patches'), { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) }))

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

let settingsSaveQueue = Promise.resolve()
export function saveSettings(settings) {
  const pending = settingsSaveQueue.catch(() => {}).then(async () =>
    handle(await fetch(url('/api/settings'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(settings),
    })),
  )
  settingsSaveQueue = pending.then(() => undefined, () => undefined)
  return pending
}

/** Aggregated customizer usage stored in private Shopify metaobjects. */
export const fetchAnalytics = async (days = 30) =>
  handle(await fetch(url(`/api/admin/analytics?days=${encodeURIComponent(days)}`), {
    headers: await authHeaders(),
    cache: 'no-store',
  }))

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

// The store has tens of thousands of variants, so a full listing takes minutes
// and exhausts the Admin API rate limit shared with saves. Every caller shares
// one in-flight/cached crawl; failures are not cached so a retry starts afresh.
let allVariantsPromise = null
const VARIANT_ID_BATCH = 250
const variantById = new Map()

/** List every Shopify variant. Expensive: prefer fetchShopifyVariantsByIds or search. */
export function fetchShopifyVariants({ refresh = false } = {}) {
  if (refresh || !allVariantsPromise) {
    const pending = (async () => {
      const variants = []
      let after = null
      do {
        const page = await handle(await fetch(url(`/api/admin/shopify-variants?paged=1${after ? `&after=${encodeURIComponent(after)}` : ''}`), {
          headers: await authHeaders(),
          cache: 'no-store',
        }))
        variants.push(...page.variants)
        after = page.after
      } while (after)
      for (const variant of variants) variantById.set(String(variant.id), variant)
      return { variants }
    })()
    allVariantsPromise = pending
    pending.catch(() => { if (allVariantsPromise === pending) allVariantsPromise = null })
  }
  return allVariantsPromise
}

/** Resolve specific (e.g. already-linked) Shopify variants by numeric ID. */
export async function fetchShopifyVariantsByIds(ids) {
  const wanted = [...new Set([...ids].map((id) => String(id ?? '').trim()).filter((id) => /^\d+$/.test(id)))]
  const missing = wanted.filter((id) => !variantById.has(id))
  for (let index = 0; index < missing.length; index += VARIANT_ID_BATCH) {
    const batch = missing.slice(index, index + VARIANT_ID_BATCH)
    const page = await handle(await fetch(url(`/api/admin/shopify-variants?ids=${batch.join(',')}`), {
      headers: await authHeaders(),
      cache: 'no-store',
    }))
    for (const variant of page.variants || []) variantById.set(String(variant.id), variant)
  }
  return { variants: wanted.map((id) => variantById.get(id)).filter(Boolean) }
}

/** Forget cached variants (e.g. after prices change in Shopify). Test hook too. */
export function resetShopifyVariantCache() {
  allVariantsPromise = null
  variantById.clear()
}

export async function searchShopifyVariants(query) {
  const variants = []
  let after = null
  do {
    const params = new URLSearchParams({ q: query, ...(after ? { after } : {}) })
    const page = await handle(await fetch(url(`/api/admin/shopify-variants?${params}`), {
      headers: await authHeaders(), cache: 'no-store',
    }))
    variants.push(...page.variants)
    after = page.after
  } while (after)
  return { variants }
}

export const syncDecorations = async (body) =>
  handle(await fetch(url('/api/admin/sync-decorations'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  }))

/** List the store's Shopify collections (for the bundle "whole collection" picker). */
export const fetchShopifyCollections = async (q) =>
  handle(await fetch(url(`/api/admin/shopify-collections${q ? `?q=${encodeURIComponent(q)}` : ''}`), { headers: await authHeaders() }))

/** The REAL sellable phone-case variants (model × gel colour) on Shopify. */
export const fetchCaseVariants = async (h) =>
  handle(await fetch(url(`/api/admin/case-variants${h ? `?handle=${encodeURIComponent(h)}` : ''}`), { headers: await authHeaders() }))

/** Preview or apply automatic model-to-real-case-variant bindings for all phones. */
export const bindPhoneProducts = async (apply = false) =>
  handle(await fetch(url('/api/admin/bind-phone-products'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ apply }),
  }))

/** Update a real phone-case variant's price / availability on Shopify. */
export const updateCaseVariant = async (patch) =>
  handle(await fetch(url('/api/admin/case-variants'), { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(patch) }))

/** Structural variant actions: addModel/deleteModel/addColour/deleteColour. */
export const caseVariantAction = async (body) =>
  handle(await fetch(url('/api/admin/case-variants'), { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) }))
