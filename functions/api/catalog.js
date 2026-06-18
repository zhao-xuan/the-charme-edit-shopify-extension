// GET /api/catalog — merchant-managed products, charms and base-catalogue
// overrides from D1. The storefront merges this on top of its bundled catalogue.
import { json, rowToCharm, rowToProduct } from './_lib.js'

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ products: [], charms: [], overrides: {} })
  const [products, charms, overrides] = await Promise.all([
    env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM charms ORDER BY created_at DESC').all(),
    env.DB.prepare('SELECT * FROM overrides').all(),
  ])
  const ov = { productPrices: {}, charmPrices: {}, charmHidden: {} }
  for (const o of overrides.results || []) {
    if (o.scope === 'product' && o.price != null) ov.productPrices[o.ref_id] = o.price
    if (o.scope === 'charm' && o.price != null) ov.charmPrices[o.ref_id] = o.price
    if (o.scope === 'charm' && o.hidden) ov.charmHidden[o.ref_id] = true
  }
  return json({
    products: (products.results || []).map(rowToProduct),
    charms: (charms.results || []).map(rowToCharm),
    overrides: ov,
  })
}
