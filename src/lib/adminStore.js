/**
 * Merchant override store.
 *
 * The customizer ships with a built-in catalogue (products.js + catalog.json).
 * The Admin page (/admin) lets a merchant layer *overrides* on top of that
 * catalogue — re-price models & charms, hide charms, and add brand-new custom
 * products and charms (with uploaded artwork stored as data URLs).
 *
 * Overrides live in localStorage and are merged into the catalogue at module
 * load time (see products.js + catalog.js), so the customer-facing storefront
 * reflects every saved change on its next load.
 *
 * NOTE ON PERSISTENCE: localStorage is per-browser/per-device. These overrides
 * are perfect for previewing a merchant's exact storefront on the device where
 * they were authored. To publish changes to *every* visitor you would persist
 * the same JSON to a shared backend (e.g. Cloudflare KV/D1 + R2 for the images)
 * and hydrate it here instead — the merge layer below would not change.
 */

const KEY = 'charme.admin.v1'

export function defaultAdmin() {
  return {
    // { [productId]: number } — overrides a model's base price.
    productPrices: {},
    // Brand-new merchant products (full, render-ready product objects sans the
    // derived geometry, which buildCustomProduct fills in).
    customProducts: [],
    // { [charmId]: number } — overrides a catalogue charm's price.
    charmPrices: {},
    // { [charmId]: true } — hide a catalogue charm from the tray.
    charmHidden: {},
    // Brand-new merchant charms (uploaded cut-outs).
    customCharms: [],
  }
}

const hasLS = () => typeof window !== 'undefined' && !!window.localStorage

export function loadAdmin() {
  if (!hasLS()) return defaultAdmin()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultAdmin()
    return { ...defaultAdmin(), ...JSON.parse(raw) }
  } catch {
    return defaultAdmin()
  }
}

export function saveAdmin(data) {
  if (!hasLS()) return
  window.localStorage.setItem(KEY, JSON.stringify(data))
}

export function clearAdmin() {
  if (!hasLS()) return
  window.localStorage.removeItem(KEY)
}
