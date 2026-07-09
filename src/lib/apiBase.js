/**
 * Resolve the base URL for the Cloudflare Pages API + assets.
 *
 * Priority:
 *  1. An explicit `window.CharmeConfig.apiBase` set by the Shopify drop-in
 *     snippet/section (wins — lets a merchant point at a preview deploy).
 *  2. Empty string when the widget is served from the Pages deployment itself
 *     (standalone app, `*.pages.dev`) or local dev — `/api` + `/assets` are then
 *     same-origin and need no prefix.
 *  3. Otherwise (embedded in a storefront with no explicit config) fall back to
 *     the production Pages URL, so the widget still reaches the live catalogue
 *     and art even when the theme snippet forgot to set `apiBase`. Without this
 *     the storefront silently fetches `<store>/api/catalog` → 404 → bundled
 *     fallback, and merchant edits (price / size / hide) never appear.
 */
const PROD_API_BASE = 'https://charme-customizer.pages.dev'

export function resolveApiBase() {
  if (typeof window === 'undefined') return ''
  const explicit = window.CharmeConfig && window.CharmeConfig.apiBase
  if (explicit) return String(explicit).replace(/\/$/, '')
  const host = (window.location && window.location.hostname) || ''
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '' ||
    host.endsWith('.pages.dev')
  ) {
    return ''
  }
  return PROD_API_BASE
}

export const API_BASE = resolveApiBase()
