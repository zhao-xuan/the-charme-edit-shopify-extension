// Sync the merchant's discount codes + rules to REAL Shopify discounts via the
// Admin API (requires the `write_discounts` scope).
//   POST /api/admin/discounts  → create/update Shopify code + automatic discounts
//
// - Every active discount CODE becomes a Shopify code discount (works at
//   checkout + is applied by the cross-sell popup via /discount/<CODE>).
// - `category` and `product_qty` rules become Shopify AUTOMATIC basic discounts.
// - `item` / `charm_count` rules can't be expressed as a native automatic
//   discount, so they're reported as "create manually" (skipped).
// Created discount GIDs are stored back on the settings so a re-sync updates in
// place instead of creating duplicates.
import { json, bad, requireAdmin, shopifyAdmin } from '../_lib.js'
import { TYPES, shopifyConfigured, getRecord, saveRecord } from '../_shopify-store.js'

const SETTINGS_HANDLE = 'app-settings'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}
export const onRequestOptions = () => new Response(null, { headers: cors })

/** Map a rule/code { discountKind, value } to a Shopify customerGets value. */
function getsValue(d) {
  if ((d.discountKind || 'percent') === 'amount') {
    return { discountAmount: { amount: String(Number(d.value) || 0), appliesOnEachItem: false } }
  }
  return { percentage: Math.max(0, Math.min(1, (Number(d.value) || 0) / 100)) }
}

const CODE_CREATE = `
  mutation($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`
const CODE_UPDATE = `
  mutation($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`
const AUTO_CREATE = `
  mutation($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`
const AUTO_UPDATE = `
  mutation($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`
// `collections(query:"handle:...")` is version-stable (collectionByHandle is deprecated).
const COLLECTION_LOOKUP = `
  query($q: String!) { collections(first: 1, query: $q) { edges { node { id handle } } } }`
const PRODUCT_LOOKUP = `
  query($q: String!) { products(first: 1, query: $q) { edges { node { id handle } } } }`

async function collectionGid(env, handle) {
  if (!handle) return null
  const data = await shopifyAdmin(env, COLLECTION_LOOKUP, { q: `handle:${handle}` })
  const edge = (data.collections?.edges || [])[0]
  return edge && edge.node.handle === handle ? edge.node.id : edge?.node?.id || null
}

async function productGid(env, handle) {
  if (!handle) return null
  const data = await shopifyAdmin(env, PRODUCT_LOOKUP, { q: `handle:${handle}` })
  const edge = (data.products?.edges || [])[0]
  return edge && edge.node.handle === handle ? edge.node.id : null
}

const itemsFor = (colGid) => (colGid ? { collections: { add: [colGid] } } : { all: true })

/** Throw if a mutation payload carried userErrors. */
function assertNoErrors(payload, key) {
  const ue = payload?.[key]?.userErrors
  if (ue && ue.length) throw new Error(ue.map((e) => e.message).join('; '))
}

async function syncCode(env, c, items) {
  const input = {
    title: c.code,
    code: c.code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: { value: getsValue(c), items: items || { all: true } },
    appliesOncePerCustomer: false,
  }
  if (c.shopifyId) {
    const d = await shopifyAdmin(env, CODE_UPDATE, { id: c.shopifyId, basicCodeDiscount: input })
    assertNoErrors(d, 'discountCodeBasicUpdate')
    return c.shopifyId
  }
  const d = await shopifyAdmin(env, CODE_CREATE, { basicCodeDiscount: input })
  assertNoErrors(d, 'discountCodeBasicCreate')
  return d.discountCodeBasicCreate.codeDiscountNode.id
}

async function syncRule(env, r) {
  let colGid = null
  let minQty = null
  if (r.type === 'category') {
    colGid = await collectionGid(env, r.collection)
    if (!colGid) throw new Error(`no Shopify collection for handle "${r.collection || ''}"`)
  } else if (r.type === 'product_qty') {
    minQty = Number(r.minQty) || null
  } else {
    return null // item / charm_count → not natively enforceable
  }
  const input = {
    title: r.name || `Charmé ${r.type}`,
    startsAt: new Date().toISOString(),
    customerGets: { value: getsValue(r), items: itemsFor(colGid) },
  }
  if (minQty) input.minimumRequirement = { quantity: { greaterThanOrEqualToQuantity: String(minQty) } }
  if (r.shopifyAutoId) {
    const d = await shopifyAdmin(env, AUTO_UPDATE, { id: r.shopifyAutoId, automaticBasicDiscount: input })
    assertNoErrors(d, 'discountAutomaticBasicUpdate')
    return r.shopifyAutoId
  }
  const d = await shopifyAdmin(env, AUTO_CREATE, { automaticBasicDiscount: input })
  assertNoErrors(d, 'discountAutomaticBasicCreate')
  return d.discountAutomaticBasicCreate.automaticDiscountNode.id
}

/**
 * Sync a bundle to Shopify. RECOMMENDED default: a product-scoped AUTOMATIC
 * discount (no code needed — applies whenever the bundle's products are in the
 * cart, can't be shared/hunted). If the merchant set a code, we make a
 * product-scoped CODE discount instead (so the code can't discount the whole
 * cart). Only percentage bundles map to a native basic discount; a fixed bundle
 * PRICE needs Shopify Bundles / a Discount Function, so it's reported for manual
 * setup. Returns { autoId?, codeId? } or null (skipped).
 */
async function syncBundle(env, b) {
  if ((b.discountKind || 'percent') !== 'percent') return { skip: 'fixed-price bundle — use Shopify Bundles / a Discount Function' }
  const handles = (b.items || []).map((it) => (it.handle || '').trim()).filter(Boolean)
  if (!handles.length) return { skip: 'no products in the bundle' }
  const gids = []
  for (const h of handles) {
    const gid = await productGid(env, h)
    if (gid) gids.push(gid)
  }
  if (!gids.length) throw new Error('none of the bundle products were found in Shopify')
  const items = { products: { productsToAdd: gids } }
  const value = getsValue({ discountKind: 'percent', value: b.value })
  const title = (b.blockTitle || b.name || 'Charmé bundle') + ' (Charmé)'

  const code = (b.code || '').trim()
  if (code) {
    const codeId = await syncCode(env, { code, discountKind: 'percent', value: b.value, shopifyId: b.shopifyCodeId }, items)
    return { codeId }
  }
  // Automatic, product-scoped.
  const input = { title, startsAt: new Date().toISOString(), customerGets: { value, items } }
  if (b.shopifyAutoId) {
    const d = await shopifyAdmin(env, AUTO_UPDATE, { id: b.shopifyAutoId, automaticBasicDiscount: input })
    assertNoErrors(d, 'discountAutomaticBasicUpdate')
    return { autoId: b.shopifyAutoId }
  }
  const d = await shopifyAdmin(env, AUTO_CREATE, { automaticBasicDiscount: input })
  assertNoErrors(d, 'discountAutomaticBasicCreate')
  return { autoId: d.discountAutomaticBasicCreate.automaticDiscountNode.id }
}

function cleanSettings(rec) {
  const { _gid, _handle, scope, ...rest } = rec
  return rest
}

export async function onRequestPost({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  if (!shopifyConfigured(env)) return bad('Shopify not configured', 400)

  const rec = await getRecord(env, TYPES.override, SETTINGS_HANDLE)
  const settings = rec ? cleanSettings(rec) : { discounts: { rules: [], codes: [] } }
  settings.discounts = settings.discounts || { rules: [], codes: [] }
  const codes = settings.discounts.codes || []
  const rules = settings.discounts.rules || []
  const bundles = settings.discounts.bundles || []
  const report = []

  for (const c of codes) {
    if (!c.code) continue
    if (c.active === false) {
      report.push({ type: 'code', name: c.code, skipped: 'inactive' })
      continue
    }
    try {
      c.shopifyId = await syncCode(env, c)
      report.push({ type: 'code', name: c.code, ok: true })
    } catch (e) {
      report.push({ type: 'code', name: c.code, error: e.message })
    }
  }
  for (const r of rules) {
    if (r.active === false) {
      report.push({ type: 'rule', name: r.name, skipped: 'inactive' })
      continue
    }
    try {
      const gid = await syncRule(env, r)
      if (gid) {
        r.shopifyAutoId = gid
        report.push({ type: 'rule', name: r.name, ok: true })
      } else {
        report.push({ type: 'rule', name: r.name, skipped: 'not auto-enforceable — issue a code instead' })
      }
    } catch (e) {
      report.push({ type: 'rule', name: r.name, error: e.message })
    }
  }
  // Bundles → a product-scoped AUTOMATIC discount (recommended) or, if a code is
  // set, a product-scoped code discount. Fixed-price bundles are reported for
  // manual setup (need Shopify Bundles / a Discount Function).
  for (const b of bundles) {
    if (b.active === false) {
      report.push({ type: 'bundle', name: b.name || b.blockTitle, skipped: 'inactive' })
      continue
    }
    try {
      const res = await syncBundle(env, b)
      if (!res || res.skip) {
        report.push({ type: 'bundle', name: b.name || b.blockTitle, skipped: (res && res.skip) || 'skipped' })
      } else {
        if (res.autoId) { b.shopifyAutoId = res.autoId; b.shopifyCodeId = undefined }
        if (res.codeId) { b.shopifyCodeId = res.codeId; b.shopifyAutoId = undefined }
        report.push({ type: 'bundle', name: b.name || b.blockTitle, ok: true, mode: res.autoId ? 'automatic' : 'code' })
      }
    } catch (e) {
      report.push({ type: 'bundle', name: b.name || b.blockTitle, error: e.message })
    }
  }

  await saveRecord(env, TYPES.override, SETTINGS_HANDLE, { scope: 'settings', ...settings })
  return json({ ok: true, report, settings }, { headers: cors })
}
