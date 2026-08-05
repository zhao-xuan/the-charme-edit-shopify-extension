/**
 * Resolve a root-relative image path (`/assets/...` cut-outs & case renders, or
 * `/api/image/...` KV images) to wherever it is actually served.
 *
 * In the standalone dev/app build there is no `CharmeConfig`, so paths pass
 * through unchanged and Vite / Cloudflare Pages serves them from the same
 * origin. When embedded in a Shopify theme the widget runs on the *storefront*
 * origin, which has none of these paths — so we prefix every root-relative
 * asset/image URL with the Pages base URL (explicit `CharmeConfig.apiBase`, or
 * the production Pages URL as a fallback), serving the art + KV images straight
 * from that CDN.
 */
import { ASSET_BASE } from './apiBase.js'

export function resolveAsset(src) {
  if (!src) return src
  // Only rewrite root-relative paths; absolute URLs (already on a CDN) pass through.
  if (ASSET_BASE && src.charAt(0) === '/') return ASSET_BASE + src
  return src
}
