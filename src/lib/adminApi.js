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

const authHeaders = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${getToken()}`,
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

export const addCharms = (charms) =>
  fetch(url('/api/admin/charms'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ charms }) }).then(handle)

export const patchCharm = (id, patch) =>
  fetch(url('/api/admin/charms'), { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ id, ...patch }) }).then(handle)

export const deleteCharm = (id) =>
  fetch(url('/api/admin/charms'), { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) }).then(handle)

export const addProduct = (product) =>
  fetch(url('/api/admin/products'), { method: 'POST', headers: authHeaders(), body: JSON.stringify(product) }).then(handle)

export const deleteProduct = (id) =>
  fetch(url('/api/admin/products'), { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) }).then(handle)

export const setOverride = (scope, refId, patch) =>
  fetch(url('/api/admin/override'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ scope, refId, ...patch }) }).then(handle)
