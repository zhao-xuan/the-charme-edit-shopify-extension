/**
 * settings.js — merchant-configurable storefront settings (cross-sell prompt,
 * discounts, grouped charm pricing and product selector), loaded once from the
 * `/api/settings` and cached globally.
 *
 * Mirrors remoteCatalog.js: main.jsx / entry.jsx awaits loadSettings() before
 * the app module graph evaluates, so the customizer sees the live config on
 * first render. Falls back to sensible defaults when the API is unreachable.
 */
import { API_BASE } from './apiBase'
import { DEFAULT_CHARM_PRICING_GROUPS, normalizeCharmPricingGroups } from './charmPricing'

export const DEFAULT_SETTINGS = {
  // Prompt shown under "Add my custom … to cart".
  crossSellHint: 'Customise your second product',
  // Cross-sell popup shown on the cart after add-to-cart.
  crossSell: {
    enabled: true,
    title: 'Would you like to customise your second product?',
    discountCode: '',
    // Each option deep-links into the customizer for a product group/model.
    options: [
      { label: 'Phone case', buttonLabel: 'Customise phone case', group: 'apple', productId: '' },
      { label: 'Photo frame', buttonLabel: 'Customise photo frame', group: 'frame', productId: '' },
    ],
  },
  // Discount rules + issued codes (enforced Shopify-side; see functions/api).
  discounts: { rules: [], codes: [], bundles: [] },
  // Customizer taxonomy display order (managed in Admin → Categories & order).
  //   categoryOrder — order of the category TABS (by category key)
  //   subOrder[cat] — order of the sub-category SECTIONS within a tab (by collection)
  //   charmOrder["<cat>::<collection>"] — order of the charms within a section (by id)
  // Anything not listed keeps its natural (first-seen) order after the listed ones.
  taxonomy: { categoryOrder: [], subOrder: {}, charmOrder: {} },
  // Quantity-tier pricing shared across different charm styles in a category.
  // Each started quantity block is billed once (for example, 7 filling stones
  // at 6 per block are billed as two £1.50 blocks).
  charmPricingGroups: DEFAULT_CHARM_PRICING_GROUPS,
  // Storefront product-page variant selector (the new brand → model picker).
  //   style — look & feel, controlled from Admin → Products → Variant selector.
  //   tree  — arbitrary-depth category nodes; leaves carry `models` (the
  //           product's "iPhone Model" option values). Empty → the storefront
  //           falls back to grouping models by brand automatically.
  variantSelector: {
    enabled: true,
    style: {
      accent: '#12261d',
      accentInk: '#ffffff',
      buttonBg: '#ffffff',
      buttonInk: '#1f2a24',
      border: '#d9d4c7',
      radius: 10,
      layout: 'buttons', // 'buttons' | 'dropdown'
      heading: '1. Select your case',
      brandLabel: 'Brand',
      modelLabel: 'Model',
      showPrice: true,
    },
    tree: [],
  },
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
  const storedPricingGroups = normalizeCharmPricingGroups(
    Array.isArray(d.charmPricingGroups) ? d.charmPricingGroups : DEFAULT_SETTINGS.charmPricingGroups,
  )
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    crossSell: { ...DEFAULT_SETTINGS.crossSell, ...(d.crossSell || {}) },
    discounts: { ...DEFAULT_SETTINGS.discounts, ...(d.discounts || {}) },
    taxonomy: { ...DEFAULT_SETTINGS.taxonomy, ...(d.taxonomy || {}) },
    charmPricingGroups: storedPricingGroups,
    variantSelector: {
      ...DEFAULT_SETTINGS.variantSelector,
      ...(d.variantSelector || {}),
      style: { ...DEFAULT_SETTINGS.variantSelector.style, ...((d.variantSelector || {}).style || {}) },
      tree: (d.variantSelector || {}).tree || [],
    },
  }
}
