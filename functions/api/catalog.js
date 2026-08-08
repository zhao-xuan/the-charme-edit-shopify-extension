// GET /api/catalog — merchant-managed products, charms and base-catalogue
// overrides. The storefront merges this on top of its bundled catalogue.
//
// Source: the merchant's own Shopify store (metaobjects + Files) when the
// Shopify backend is configured; otherwise the legacy Cloudflare D1 store. The
// JSON response shape is identical either way, so the widget is agnostic.
import { json, rowToCharm, rowToProduct } from './_lib.js'
import {
  TYPES,
  shopifyConfigured,
  listRecords,
  cleanCharm,
  cleanProduct,
} from './_shopify-store.js'

const EMPTY_OV = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {} }

export async function onRequestGet({ env }) {
  // ---- Shopify-native store (metaobjects) ----
  if (shopifyConfigured(env)) {
    try {
      const [products, charms, overrides, patches] = await Promise.all([
        listRecords(env, TYPES.product),
        listRecords(env, TYPES.charm),
        listRecords(env, TYPES.override),
        listRecords(env, TYPES.patch),
      ])
      const ov = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {} }
      for (const o of overrides) {
        if (o.scope === 'product' && o.price != null) ov.productPrices[o.refId] = o.price
        if (o.scope === 'charm' && o.price != null) ov.charmPrices[o.refId] = o.price
        if (o.scope === 'charm' && o.hidden) ov.charmHidden[o.refId] = true
        if (o.scope === 'charm' && o.sizeScale != null) ov.charmSizes[o.refId] = o.sizeScale
        if (o.scope === 'charm' && o.shopifyVariantId) ov.charmVariantIds[o.refId] = o.shopifyVariantId
      }
      return json({
        products: products.filter((p) => p.active !== false).map(cleanProduct),
        charms: charms.map(cleanCharm),
        patches: patches.map(({ _gid, _handle, ...patch }) => patch),
        overrides: ov,
      })
    } catch (e) {
      // Never let a Shopify hiccup break the storefront — fall back to bundled.
      console.warn('[Charmé] catalog metaobject read failed', e && e.message)
      return json({ products: [], charms: [], patches: [], overrides: EMPTY_OV })
    }
  }

  // ---- Legacy Cloudflare D1 fallback ----
  if (!env.DB) return json({ products: [], charms: [], patches: [], overrides: EMPTY_OV })
  const [products, charms, patches, overrides] = await Promise.all([
    env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM charms ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM patches ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM overrides').all(),
  ])
  const ov = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {} }
  for (const o of overrides.results || []) {
    if (o.scope === 'product' && o.price != null) ov.productPrices[o.ref_id] = o.price
    if (o.scope === 'charm' && o.price != null) ov.charmPrices[o.ref_id] = o.price
    if (o.scope === 'charm' && o.hidden) ov.charmHidden[o.ref_id] = true
    if (o.scope === 'charm' && o.size_scale != null) ov.charmSizes[o.ref_id] = o.size_scale
  }
  return json({
    products: (products.results || []).map(rowToProduct),
    charms: (charms.results || []).map(rowToCharm),
    patches: (patches.results || []).map(rowToCharm),
    overrides: ov,
  })
}
