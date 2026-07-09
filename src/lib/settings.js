/**
 * settings.js — merchant-configurable storefront settings (cross-sell prompt +
 * discount rules + codes), loaded once at startup from the Cloudflare-backed
 * `/api/settings` and cached globally.
 *
 * Mirrors remoteCatalog.js: main.jsx / entry.jsx awaits loadSettings() before
 * the app module graph evaluates, so the customizer sees the live config on
 * first render. Falls back to sensible defaults when the API is unreachable.
 */
import { API_BASE } from './apiBase'

export const DEFAULT_SETTINGS = {
  // Prompt shown under "Add my custom … to cart".
  crossSellHint: 'Customise your second product for extra 10% off',
  // Cross-sell popup shown on the cart after add-to-cart.
  crossSell: {
    enabled: true,
    title: 'Would you like to customise your second product (extra 10% off)?',
    discountCode: '',
    // Each option deep-links into the customizer for a product group/model.
    options: [
      { label: 'Phone case', group: 'apple', productId: '' },
      { label: 'Photo frame', group: 'frame', productId: '' },
    ],
  },
  // Discount rules + issued codes (enforced Shopify-side; see functions/api).
  discounts: { rules: [], codes: [], bundles: [] },
}

let cache = null

export async function loadSettings() {
  if (typeof fetch === 'undefined') return DEFAULT_SETTINGS
  try {
    const res = await fetch(`${API_BASE}/api/settings`, { headers: { accept: 'application/json' } })
    if (res.ok) {
      const data = await res.json()
      cache = mergeDefaults(data)
      if (typeof globalThis !== 'undefined') globalThis.__CHARME_SETTINGS__ = cache
    }
  } catch {
    /* offline / no Functions → defaults */
  }
  return cache || DEFAULT_SETTINGS
}

/** The loaded settings, or defaults if not loaded yet. */
export function settings() {
  if (cache) return cache
  if (typeof globalThis !== 'undefined' && globalThis.__CHARME_SETTINGS__) return globalThis.__CHARME_SETTINGS__
  return DEFAULT_SETTINGS
}

/** Shallow-merge stored settings over the defaults so missing keys are safe. */
function mergeDefaults(data) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    crossSell: { ...DEFAULT_SETTINGS.crossSell, ...(d.crossSell || {}) },
    discounts: { ...DEFAULT_SETTINGS.discounts, ...(d.discounts || {}) },
  }
}
