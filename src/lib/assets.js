/**
 * Resolve a root-relative image path (`/assets/...` cut-outs & case renders, or
 * `/api/image/...` KV images) to wherever it is actually served.
 *
 * In the standalone dev/app build there is no `CharmeConfig`, so paths pass
 * through unchanged and Vite / Cloudflare Pages serves them from the same
 * origin. When embedded in a Shopify theme the widget runs on the *storefront*
 * origin, which has none of these paths — so the drop-in section sets
 * `window.CharmeConfig.apiBase` to the Cloudflare Pages URL
 * (e.g. https://charme-customizer.pages.dev) and we prefix every root-relative
 * asset/image URL with it, serving the art + KV images straight from that CDN.
 */
const API_BASE = (
  (typeof window !== 'undefined' && window.CharmeConfig && window.CharmeConfig.apiBase) || ''
).replace(/\/$/, '')

export function resolveAsset(src) {
  if (!src) return src
  // Only rewrite root-relative paths; absolute URLs (already on a CDN) pass through.
  if (API_BASE && src.charAt(0) === '/') return API_BASE + src
  return src
}
