/**
 * Resolve a bundled `/assets/...` path to wherever the assets actually live.
 *
 * In the standalone dev/app build, assets are served from /assets by Vite, so
 * paths pass through unchanged. When embedded in a Shopify theme the cut-outs
 * and case renders live (flat) on Shopify's CDN; the app block sets
 * `window.CharmeConfig.assetBase` and we rewrite `/assets/<folder>/<file>` to
 * `<assetBase><file>`.
 */
const ASSET_BASE =
  (typeof window !== 'undefined' && window.CharmeConfig && window.CharmeConfig.assetBase) || ''

export function resolveAsset(src) {
  if (!src || !ASSET_BASE) return src
  // strip the bundled folder prefix; extension assets are stored flat
  return src.replace(/^\/assets\/(charms|cases)\//, ASSET_BASE)
}
