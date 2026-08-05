/**
 * Resolve the base URL for the Cloudflare Pages API.
 *
 * Priority:
 *  1. An explicit `window.CharmeConfig.apiBase` set by the Shopify drop-in
 *     snippet/section (wins — lets a merchant point at a preview deploy).
 *  2. Empty string on the canonical production Pages domain or local dev, where
 *     `/api` + `/assets` are correctly served from the same origin.
 *  3. Otherwise (including immutable/branch Pages previews) use the production
 *     Pages URL. Preview Functions can have stale D1 data and do not share the
 *     production Shopify secrets; reading their same-origin `/api/catalog`
 *     silently restores deleted bundled charms and old taxonomy.
 */
export const PROD_API_BASE = 'https://charme-customizer.pages.dev'

export function apiBaseFor(hostname, explicit) {
  if (explicit) return String(explicit).replace(/\/$/, '')
  const host = String(hostname || '').toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '' || host === 'charme-customizer.pages.dev') {
    return ''
  }
  return PROD_API_BASE
}

export function assetBaseFor(hostname, explicit) {
  if (explicit) return String(explicit).replace(/\/$/, '')
  const host = String(hostname || '').toLowerCase()
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === ''
    || host === 'charme-customizer.pages.dev'
    || host.endsWith('.charme-customizer.pages.dev')
  ) {
    return ''
  }
  return PROD_API_BASE
}

export function resolveApiBase() {
  if (typeof window === 'undefined') return ''
  const explicit = window.CharmeConfig && window.CharmeConfig.apiBase
  const host = (window.location && window.location.hostname) || ''
  return apiBaseFor(host, explicit)
}

export const API_BASE = resolveApiBase()

export function resolveAssetBase() {
  if (typeof window === 'undefined') return ''
  const explicit = window.CharmeConfig && window.CharmeConfig.apiBase
  const host = (window.location && window.location.hostname) || ''
  return assetBaseFor(host, explicit)
}

export const ASSET_BASE = resolveAssetBase()
