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

async function collectionGid(env, handle) {
  if (!handle) return null
  const data = await shopifyAdmin(env, COLLECTION_LOOKUP, { q: `handle:${handle}` })
  const edge = (data.collections?.edges || [])[0]
  return edge && edge.node.handle === handle ? edge.node.id : edge?.node?.id || null
}

const itemsFor = (colGid) => (colGid ? { collections: { add: [colGid] } } : { all: true })

/** Throw if a mutation payload carried userErrors. */
function assertNoErrors(payload, key) {
  const ue = payload?.[key]?.userErrors
  if (ue && ue.length) throw new Error(ue.map((e) => e.message).join('; '))
}

async function syncCode(env, c) {
  const input = {
    title: c.code,
    code: c.code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: { value: getsValue(c), items: { all: true } },
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

  await saveRecord(env, TYPES.override, SETTINGS_HANDLE, { scope: 'settings', ...settings })
  return json({ ok: true, report, settings }, { headers: cors })
}
