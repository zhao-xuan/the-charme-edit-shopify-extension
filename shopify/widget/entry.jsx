/**
 * Shopify embed entry point.
 * --------------------------------------------------------------------------
 * Built (via `npm run build:shopify`) into a single IIFE bundle that the
 * drop-in theme section loads from the Cloudflare Pages CDN. It mounts the same
 * customizer used by the standalone app, but wires "Add to bag" into the
 * Shopify Cart AJAX API so checkout, payment and orders stay 100% native
 * Shopify (the widget runs on the storefront page, not an iframe).
 *
 * Configuration is read from `window.CharmeConfig`, which the drop-in section
 * renders as an inline <script> BEFORE this bundle (see
 * shopify/theme-section/charme-customizer.liquid):
 *
 *   window.CharmeConfig = {
 *     apiBase:    "https://charme-customizer.pages.dev", // catalogue + art CDN
 *     variantMap: { products: {...}, charms: {...} },     // id → Shopify variant
 *     uploadEndpoint: "https://your-app.example.com/api/upload-proof", // optional
 *     cartRedirect: "cart" | "drawer" | "none",
 *     height: "88vh",
 *     mountId: "charme-customizer-root"
 *   }
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import { theme } from '../../src/theme'
import '../../src/styles.css'
import { loadRemoteCatalog } from '../../src/lib/remoteCatalog'
import { createCartHandler } from './shopifyCart'

let mounted = false

/**
 * Mount the customizer into its container. Idempotent — calling it again is a
 * no-op (the button-popup mode calls this on first open). Exposed on the IIFE
 * global as `window.CharmeCustomizer.mount()`.
 */
export async function mount() {
  if (mounted) return
  const cfg = window.CharmeConfig || {}
  const el = document.getElementById(cfg.mountId || 'charme-customizer-root')
  if (!el) {
    console.warn('[Charmé] mount element not found')
    return
  }
  mounted = true

  // Pull the live Cloudflare-backed catalogue (latest charms + case renders)
  // BEFORE the customizer module graph evaluates, so the bundled merge folds it
  // in on first render. Best-effort: falls back to the bundled catalogue if the
  // API is unreachable, so the widget always renders.
  await loadRemoteCatalog()
  const { default: CustomizerPage } = await import('../../src/customizer/CustomizerPage')

  const onPlaceOrder = createCartHandler(cfg)

  // Digitised design preset: if this placement maps to a saved design (by Shopify
  // product handle), load it so the customer opens onto that arrangement and can
  // refine it. Best-effort — any failure just opens the empty customizer.
  const initialLayout = await loadPreset(cfg)

  createRoot(el).render(
    <React.StrictMode>
      <ConfigProvider theme={theme}>
        <AntApp>
          <div className="app-shell" style={{ height: cfg.height || '88vh' }}>
            <CustomizerPage
              onPlaceOrder={onPlaceOrder}
              initialGroupKey={cfg.defaultGroup || undefined}
              initialProductId={cfg.defaultProductId || undefined}
              initialLayout={initialLayout || undefined}
            />
          </div>
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>,
  )
}

/**
 * Fetch the digitised layout for this placement's design, keyed by Shopify
 * product handle (`cfg.presetHandle`). Returns the seedable layout object
 * ({ productId, caseColourId, gelColourId, charms }) or null when there is no
 * preset / no handle / the request fails.
 */
async function loadPreset(cfg) {
  const handle = cfg.presetHandle
  const apiBase = cfg.apiBase || ''
  if (!handle) return null
  try {
    const res = await fetch(`${apiBase}/api/preset/${encodeURIComponent(handle)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && data.layout && (data.layout.charms || []).length ? data.layout : null
  } catch {
    return null
  }
}

// Inline mode mounts immediately; button/popup mode sets `lazy` and mounts on
// the first click (see the drop-in section) to keep the product page light.
function autoBoot() {
  if ((window.CharmeConfig || {}).lazy) return
  mount()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoBoot)
} else {
  autoBoot()
}
