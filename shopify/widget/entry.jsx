/**
 * Shopify embed entry point.
 * --------------------------------------------------------------------------
 * Built (via `npm run build:shopify`) into a single IIFE bundle that the
 * drop-in theme section loads from the Cloudflare Pages CDN. It mounts the same
 * customizer used by the standalone app, but wires "Add to bag" into the
 * Shopify Cart AJAX API so checkout, payment and orders stay 100% native
 * Shopify (the widget runs on the storefront page, not an iframe).
 *
 * Configuration is read from `window.CharmeConfig`, which the drop-in snippet
 * renders as an inline <script> BEFORE this bundle (see
 * shopify/snippets/charme-customizer.liquid):
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
  // TEMPORARILY DISABLED (commented out, not removed) — presets are hidden for
  // now. Re-enable by restoring the loadPreset() call below.
  // const initialLayout = await loadPreset(cfg)
  let initialLayout = null

  // Edit an existing cart design: ?charme_edit=<cart line key> reloads that
  // design's saved layout so the customer can keep tweaking; re-ordering then
  // replaces the original cart group (see shopifyCart.js cfg.editKey).
  const editKey = new URLSearchParams(location.search).get('charme_edit')
  if (editKey) {
    cfg.editKey = editKey
    initialLayout = await loadEditLayout(editKey)
  }

  createRoot(el).render(
    <React.StrictMode>
      <ConfigProvider theme={theme}>
        <AntApp className="charme-embed-app" style={{ height: '100%', minHeight: 0 }}>
          <div className="app-shell" style={{ height: cfg.height || '88vh' }}>
            <CustomizerPage
              onPlaceOrder={onPlaceOrder}
              initialGroupKey={cfg.defaultGroup || undefined}
              initialProductId={(initialLayout && initialLayout.productId) || cfg.defaultProductId || undefined}
              initialCaseColourId={(initialLayout && initialLayout.caseColourId) || cfg.caseColourId || undefined}
              initialGelColourId={(initialLayout && initialLayout.gelColourId) || cfg.gelColourId || undefined}
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

/**
 * Load a design saved on a cart line (its `_layout` property) back into the
 * seedable layout shape, so ?charme_edit reopens the customizer on it. Reads
 * the live cart and finds the line by its key.
 */
async function loadEditLayout(key) {
  try {
    const cart = await fetch('/cart.js', { headers: { Accept: 'application/json' } }).then((r) => r.json())
    const item = (cart.items || []).find((i) => i.key === key)
    if (!item || !item.properties || !item.properties._layout) return null
    const L = JSON.parse(item.properties._layout)
    const p = L.product || {}
    return {
      productId: p.id,
      caseColourId: (p.caseColour && p.caseColour.id) || p.colorId,
      gelColourId: p.gelId || (p.gelColour && p.gelColour.id) || undefined,
      charms: (L.charms || []).map((c) => ({
        charmId: c.charmId,
        src: c.src,
        name: c.name,
        category: c.category,
        type: c.type,
        price: c.price,
        bundle: c.bundle,
        cxMm: c.xMm,
        cyMm: c.yMm,
        wMm: c.wMm,
        hMm: c.hMm,
        rot: c.rotDeg,
        scale: c.scale,
      })),
    }
  } catch {
    return null
  }
}
function autoBoot() {
  if ((window.CharmeConfig || {}).lazy) return
  mount()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoBoot)
} else {
  autoBoot()
}
