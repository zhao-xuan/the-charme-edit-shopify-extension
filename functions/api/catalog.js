// GET /api/catalog — merchant-managed products, charms and base-catalogue
// overrides. The storefront merges this on top of its bundled catalogue.
//
// Source: the merchant's own Shopify store (metaobjects + Files) when the
// Shopify backend is configured; otherwise the legacy Cloudflare D1 store. The
// JSON response shape is identical either way, so the widget is agnostic.
import { json, rowToCharm, rowToProduct, shopifyAdmin } from './_lib.js'
import {
  TYPES,
  shopifyConfigured,
  listRecords,
  cleanCharm,
  cleanProduct,
} from './_shopify-store.js'

const EMPTY_OV = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {}, patchCategories: {}, patchCollections: {} }

const Q_PATCH_VARIANTS = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        product { title }
      }
    }
  }`

async function fillPatchTitles(env, patches) {
  const pending = patches.filter((patch) =>
    /^default title$/i.test(String(patch.name || '').trim()) && /^\d+$/.test(String(patch.shopifyVariantId || '')),
  )
  const titles = new Map()
  for (let index = 0; index < pending.length; index += 100) {
    const ids = pending.slice(index, index + 100).map((patch) => `gid://shopify/ProductVariant/${patch.shopifyVariantId}`)
    const data = await shopifyAdmin(env, Q_PATCH_VARIANTS, { ids })
    for (const variant of data.nodes || []) {
      if (!variant?.id) continue
      const id = variant.id.split('/').pop()
      const title = !/^default title$/i.test(variant.title || '') ? variant.title : variant.product?.title
      if (title) titles.set(id, title)
    }
  }
  return patches.map((patch) => {
    const title = titles.get(String(patch.shopifyVariantId || ''))
    return title ? { ...patch, name: title } : patch
  })
}

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
      const ov = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {}, patchCategories: {}, patchCollections: {} }
      for (const o of overrides) {
        if (o.scope === 'product' && o.price != null) ov.productPrices[o.refId] = o.price
        if (o.scope === 'charm' && o.price != null) ov.charmPrices[o.refId] = o.price
        if (o.scope === 'charm' && o.hidden) ov.charmHidden[o.refId] = true
        if (o.scope === 'charm' && o.sizeScale != null) ov.charmSizes[o.refId] = o.sizeScale
        if (o.scope === 'charm' && o.shopifyVariantId) ov.charmVariantIds[o.refId] = o.shopifyVariantId
        if (o.scope === 'charm' && o.patchCategory) ov.patchCategories[o.refId] = o.patchCategory
        if (o.scope === 'charm' && o.patchCollection) ov.patchCollections[o.refId] = o.patchCollection
      }
      const cleanPatches = patches.map(({ _gid, _handle, ...patch }) => patch)
      const namedPatches = await fillPatchTitles(env, cleanPatches)
      return json({
        products: products.filter((p) => p.active !== false).map(cleanProduct),
        charms: charms.map(cleanCharm),
        patches: namedPatches,
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
  const ov = { productPrices: {}, charmPrices: {}, charmHidden: {}, charmSizes: {}, charmVariantIds: {}, patchCategories: {}, patchCollections: {} }
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
