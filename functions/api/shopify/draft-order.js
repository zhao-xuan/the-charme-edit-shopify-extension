// POST /api/shopify/draft-order
// ---------------------------------------------------------------------------
// Turns a finished customizer design into a Shopify **Draft Order** and returns
// its hosted checkout URL, so the customer pays through Shopify's normal
// checkout and the order lands in Shopify Admin — with NO need to pre-create a
// product/variant per charm.
//
// Why a draft order: Shopify only charges for real prices. A draft order lets us
// build custom line items (one per charm + the case) at prices we compute
// SERVER-SIDE from the D1 catalogue, so the client cannot tamper with pricing.
// The returned `invoiceUrl` is a real Shopify checkout (all payment methods,
// taxes, shipping); completing it creates the order in Admin.
//
// Request body (from shopifyCart.js → onPlaceOrder):
//   {
//     product: { id, name, kind, color, colorId, caseColour, gelColour },
//     charms:  [ { charmId, name, price, bundle } ... ],
//     preview: "data:image/png;base64,...",   // optional proof image
//     designToken: "cd_..."                    // optional; generated if absent
//   }
// Response: { invoiceUrl, draftOrderId, total }
//
// Required Cloudflare Pages secrets/vars (set with `wrangler pages secret put`):
//   SHOPIFY_STORE        e.g. thecharmeedit.myshopify.com
//   SHOPIFY_ADMIN_TOKEN  Admin API access token (custom app) with write_draft_orders
// Bindings already in wrangler.jsonc: DB (D1, for prices), IMAGES (KV, for proofs).

import { uploadImageToShopifyFiles } from '../_lib.js'
import { TYPES, shopifyConfigured, getRecord } from '../_shopify-store.js'
import { charmChargeLines, normalizeCharmPricingGroups } from '../../../src/lib/charmPricing.js'

const API_VERSION = '2024-10'
const SETTINGS_HANDLE = 'app-settings'
const SETTINGS_KV_KEY = 'settings:app'


// Server-authoritative base price per product kind (mirrors src/data/products.js).
const BASE_PRICE = { phone: 26, tote: 16, frame: 24 }

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  })

export const onRequestOptions = () => new Response(null, { headers: cors })

// Cache the client_credentials access token per isolate (best-effort — worst
// case we just re-exchange). Shopify tokens carry an expires_in.
let cachedToken = null // { token, exp }

/**
 * Resolve an Admin API access token. New Shopify "dev dashboard" custom apps no
 * longer hand out a static shpat_ token — instead they expose a Client ID +
 * Secret and you exchange them for a short-lived access token via the
 * client_credentials grant. We prefer that (SHOPIFY_CLIENT_ID +
 * SHOPIFY_CLIENT_SECRET); fall back to a static SHOPIFY_ADMIN_TOKEN if provided.
 */
async function getAccessToken(env) {
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
    const now = Date.now()
    if (cachedToken && cachedToken.exp > now + 60_000) return cachedToken.token
    const res = await fetch(`https://${env.SHOPIFY_STORE}/admin/oauth/access_token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) {
      throw new Error(`token exchange failed: ${JSON.stringify(data).slice(0, 200)}`)
    }
    cachedToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 }
    return cachedToken.token
  }
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN
  throw new Error('no Shopify auth configured')
}

async function admin(env, query, variables) {
  const token = await getAccessToken(env)
  const res = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': token,
      },
      body: JSON.stringify({ query, variables }),
    },
  )
  const body = await res.json()
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data
}

const DRAFT_ORDER_CREATE = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id invoiceUrl totalPrice }
      userErrors { field message }
    }
  }`

const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2)

async function loadCharmPricingGroups(env) {
  try {
    if (shopifyConfigured(env)) {
      const settings = await getRecord(env, TYPES.override, SETTINGS_HANDLE)
      return normalizeCharmPricingGroups(settings?.charmPricingGroups)
    }
    if (env.IMAGES) {
      const raw = await env.IMAGES.get(SETTINGS_KV_KEY)
      const settings = raw ? JSON.parse(raw) : {}
      return normalizeCharmPricingGroups(settings.charmPricingGroups)
    }
  } catch (err) {
    console.warn('[Charmé] Could not load grouped pricing settings, using defaults', err?.message)
  }
  return normalizeCharmPricingGroups()
}

/**
 * Store the proof PNG. Preferred: the merchant's Shopify Files (durable,
 * store-owned CDN). Fallback: Cloudflare KV under img:proof-<token> served from
 * /api/image. Returns the best available absolute URL.
 */
async function storeProof(env, origin, token, dataUrl) {
  if (!dataUrl) return null
  const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const key = `proof-${token}`

  let kvUrl = null
  if (env.IMAGES) {
    await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType: m[1] } })
    kvUrl = `${origin}/api/image/${key}`
  }
  try {
    const shopifyUrl = await uploadImageToShopifyFiles(env, bytes, {
      contentType: m[1],
      filename: `charme-proof-${token}.png`,
      alt: `Charmé design proof ${token}`,
    })
    if (shopifyUrl) return shopifyUrl
  } catch (e) {
    console.warn('[Charmé] Shopify Files upload failed, using KV URL', e && e.message)
  }
  return kvUrl
}

export async function onRequestPost({ request, env }) {
  const hasAuth =
    (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) || env.SHOPIFY_ADMIN_TOKEN
  if (!env.SHOPIFY_STORE || !hasAuth) {
    return json(
      {
        error:
          'Shopify backend not configured (set SHOPIFY_STORE + SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET, or SHOPIFY_ADMIN_TOKEN).',
      },
      503,
    )
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  const product = payload.product || {}
  const charms = Array.isArray(payload.charms) ? payload.charms : []
  if (!product.id || !charms.length) return json({ error: 'design has no product or charms' }, 400)

  const token = payload.designToken || `cd_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  const origin = new URL(request.url).origin

  // ---- Authoritative pricing from the catalogue (never trust the client) ----
  // Prefer the Shopify-native store (charme_charm metaobjects); fall back to the
  // legacy D1 catalogue. Bundled base-catalogue charms live in neither, so their
  // price falls through to the clamped client value below.
  const ids = [...new Set(charms.map((c) => c.charmId).filter(Boolean))]
  const catalogById = new Map()
  if (ids.length && shopifyConfigured(env)) {
    const recs = await Promise.all(
      ids.map((id) => getRecord(env, TYPES.charm, id).catch(() => null)),
    )
    for (const r of recs) {
      if (!r || !r.id) continue
      catalogById.set(r.id, r)
    }
  } else if (env.DB && ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const rows = await env.DB.prepare(
      `SELECT id, name, collection, price, bundle FROM charms WHERE id IN (${placeholders})`,
    ).bind(...ids).all()
    for (const r of rows.results || []) {
      catalogById.set(r.id, r)
    }
  }
  // Fall back to the client price only for charms not in D1 (e.g. custom art),
  // clamped to a sane range so a tampered request can't set an arbitrary price.
  const priceFor = (c) => {
    if (catalogById.has(c.charmId)) return Number(catalogById.get(c.charmId).price) || 0
    return Math.max(0, Math.min(100, Number(c.price) || 0))
  }

  const pricingGroups = await loadCharmPricingGroups(env)
  const authoritativeCharms = charms
    .filter((c) => c.charmId)
    .map((c) => {
      const catalogCharm = catalogById.get(c.charmId)
      return {
        ...c,
        name: catalogCharm?.name || c.name || 'Charm',
        // Unknown client records may retain their clamped price for legacy base
        // catalogue support, but cannot opt themselves into grouped pricing.
        collection: catalogCharm?.collection || '',
        price: priceFor(c),
        bundle: !!catalogCharm?.bundle,
      }
    })

  // Build charge lines with the same rules as the storefront, then merge
  // repeated regular charms to keep Shopify's visible attributes compact.
  const entriesByKey = new Map()
  for (const line of charmChargeLines(authoritativeCharms, pricingGroups)) {
    const first = line.items[0]
    const key = line.kind === 'group' ? `group:${line.rule.id}` : `${line.kind}:${line.key}`
    const current = entriesByKey.get(key) || {
      qty: 0,
      price: line.unitPrice,
      name: line.kind === 'group' ? line.rule.label : first.name,
      selectedCount: 0,
      blockSize: line.kind === 'group' ? line.rule.quantity : null,
      grouped: line.kind === 'group',
      legacyBundle: line.kind === 'legacy-bundle',
    }
    current.qty += line.quantity
    current.selectedCount += line.items.length
    entriesByKey.set(key, current)
  }

  const proofUrl = await storeProof(env, origin, token, payload.preview)

  const finish = product.color || product.colorId || ''
  const kind = BASE_PRICE[product.kind] != null ? product.kind : 'phone'
  const basePrice = BASE_PRICE[kind]

  // Merged, priced charm list (billed quantities) to itemise BENEATH the case.
  const charmEntries = [...entriesByKey.values()]
  const charmsTotal = charmEntries.reduce((n, c) => n + c.price * c.qty, 0)
  const casePrice = basePrice + charmsTotal

  // ONE line item = the finished custom case, priced base + charms. The chosen
  // charms + their prices ride along as VISIBLE custom attributes, so Shopify
  // lists them UNDER the item in the cart / checkout and on the Admin order.
  const baseAttributes = []
  baseAttributes.push({ key: 'Model', value: String(product.name || product.id || '') })
  if (finish) baseAttributes.push({ key: 'Case & Gel', value: String(finish) })
  baseAttributes.push({ key: 'Base case', value: `£${money(basePrice)}` })
  charmEntries.forEach((c, i) => {
    let qtyPart = c.qty > 1 ? ` ×${c.qty}` : ''
    if (c.grouped) {
      const blocks = `${c.qty} ${c.qty === 1 ? 'block' : 'blocks'} of ${c.blockSize}`
      qtyPart = ` ×${c.selectedCount} (${blocks})`
    } else if (c.legacyBundle && c.selectedCount > 1) {
      qtyPart = ` ×${c.selectedCount}`
    }
    baseAttributes.push({
      key: `Charm ${i + 1}`,
      value: `${c.name}${qtyPart} · £${money(c.price * c.qty)}`,
    })
  })
  baseAttributes.push({ key: 'Charms subtotal', value: `£${money(charmsTotal)}` })
  if (proofUrl) baseAttributes.push({ key: 'Proof', value: proofUrl })
  // Internal props (underscore = hidden from storefront/checkout, kept on order).
  baseAttributes.push({ key: '_design_token', value: token })
  baseAttributes.push({
    key: '_layout',
    value: JSON.stringify({ product, charms, proof: proofUrl }).slice(0, 4000),
  })

  const lineItems = [
    {
      title: `${product.name}${finish ? ` — ${finish}` : ''}`,
      originalUnitPrice: money(casePrice),
      quantity: 1,
      requiresShipping: true,
      taxable: true,
      customAttributes: baseAttributes,
    },
  ]

  const total = casePrice

  const input = {
    lineItems,
    tags: ['charme-customizer'],
    note: `Charmé custom design ${token}${proofUrl ? `\nProof: ${proofUrl}` : ''}`,
    customAttributes: [
      { key: '_design_token', value: token },
      ...(proofUrl ? [{ key: '_proof', value: proofUrl }] : []),
    ],
  }

  try {
    const data = await admin(env, DRAFT_ORDER_CREATE, { input })
    const r = data.draftOrderCreate
    if (r.userErrors && r.userErrors.length) {
      return json({ error: r.userErrors.map((e) => e.message).join('; ') }, 422)
    }
    return json({
      invoiceUrl: r.draftOrder.invoiceUrl,
      draftOrderId: r.draftOrder.id,
      total: money(total),
      designToken: token,
    })
  } catch (err) {
    return json({ error: String(err.message || err) }, 502)
  }
}
