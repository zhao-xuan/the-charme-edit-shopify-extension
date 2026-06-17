/**
 * Shopify embed entry point.
 * --------------------------------------------------------------------------
 * Built (via `npm run build:shopify`) into a single IIFE bundle that the theme
 * app extension block loads. It mounts the same customizer used by the
 * standalone app, but wires "Add to bag" into the Shopify Cart AJAX API.
 *
 * Configuration is read from `window.CharmeConfig`, which the app block renders
 * as an inline <script> BEFORE this bundle (see blocks/customizer.liquid):
 *
 *   window.CharmeConfig = {
 *     assetBase:  "https://cdn.shopify.com/extensions/<uuid>/<ver>/assets/",
 *     variantMap: { products: {...}, charms: {...} },
 *     uploadEndpoint: "https://your-app.example.com/api/upload-proof", // optional
 *     cartRedirect: "drawer" | "cart" | "none",
 *     mountId: "charme-customizer-root"
 *   }
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import CustomizerPage from '../../src/customizer/CustomizerPage'
import { theme } from '../../src/theme'
import '../../src/styles.css'
import { createCartHandler } from './shopifyCart'

function mount() {
  const cfg = window.CharmeConfig || {}
  const el = document.getElementById(cfg.mountId || 'charme-customizer-root')
  if (!el) {
    console.warn('[Charmé] mount element not found')
    return
  }

  const onPlaceOrder = createCartHandler(cfg)

  createRoot(el).render(
    <React.StrictMode>
      <ConfigProvider theme={theme}>
        <AntApp>
          <div className="app-shell" style={{ height: cfg.height || '88vh' }}>
            <CustomizerPage onPlaceOrder={onPlaceOrder} />
          </div>
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>,
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
