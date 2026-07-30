/**
 * shopifyCart.js — turn a finished design into a Shopify order.
 *
 * Two modes (chosen by `CharmeConfig.orderMode`):
 *   • 'draft' (default when apiBase is set) — POST the design to the server
 *     (/api/shopify/draft-order); it builds a Shopify Draft Order at
 *     SERVER-validated prices and returns a hosted checkout URL we redirect to.
 *     The customer pays via Shopify's normal checkout and the order lands in
 *     Admin. No per-charm Shopify variants required.
 *   • 'cart' — native /cart/add.js. The case + each charm must be real Shopify
 *     products/variants (a `variantMap`); Shopify prices each line. A shared
 *     `_design_token` ties the lines together; the proof image URL + a compact
 *     layout JSON ride along as line-item properties.
 */

import baseProducts from './variantmap-products.generated.json'
import { charmChargeLines } from '../../src/lib/charmPricing'
import { settings } from '../../src/lib/settings'
import { fetchVariantDetails, resolvePricedVariant } from '../../src/lib/shopifyVariant'
import {
  submitStorefrontCartBridge,
  submitStorefrontCartForm,
} from '../../src/lib/storefrontCart'

const DEFAULT_CHARM_BY_PRICE = {
  1: '56027931935098',
  1.5: '56450822701434',
  2: '55870432903546',
  3: '56014459765114',
}

const variantDetailsCache = new Map()

function token() {
  return 'cd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function uploadProof(uploadEndpoint, dataUrl, designToken) {
  if (!uploadEndpoint || !dataUrl) return null
  try {
    const res = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designToken, image: dataUrl }),
    })
    if (!res.ok) throw new Error('upload failed')
    const json = await res.json()
    return json.url || null
  } catch (e) {
    console.warn('[Charmé] proof upload failed, continuing without hosted image', e)
    return null
  }
}

/** Resolve the Shopify variant id for the chosen base case (model × gel/colour). */
function resolveProductVariant(variantMap, payload) {
  const p = variantMap.products || {}
  const model = payload.product.id
  const gel = payload.product.gelId || payload.product.colorId
  // Base case product's variants are keyed "<model>:<gel>" (glitter|white|black).
  // Fall back to caseColour, then a bare model, then the "other" (Android/misc)
  // row for the same gel.
  return (
    p[`${model}:${gel}`] ||
    p[`${model}:${payload.product.colorId}`] ||
    p[model] ||
    p[`other:${gel}`] ||
    null
  )
}

function cartVariantMap(cfg) {
  const configured = cfg.variantMap || {}
  return {
    ...configured,
    products: { ...baseProducts, ...(configured.products || {}) },
    charms: { ...(configured.charms || {}) },
  }
}

function firstMappedVariant(candidates) {
  return [...new Set(candidates.filter(Boolean).map(String))][0] || null
}

async function buildCartItems(cfg, variantMap, payload, resolveVariant) {
  const baseVariant = resolveProductVariant(variantMap, payload)
  if (!baseVariant) {
    throw new Error(
      `No Shopify variant mapped for "${payload.product.id}". Add it to the block's Variant map.`,
    )
  }

  const designToken = token()
  const proofUrl = await uploadProof(cfg.uploadEndpoint, payload.proofs?.sampleUrl, designToken)

  const byPrice = { ...DEFAULT_CHARM_BY_PRICE, ...(variantMap.charmByPrice || {}) }
  const charmVariant = (charm) =>
    resolveVariant(
      [
        (variantMap.charms || {})[charm.charmId],
        charm.shopifyVariantId,
        byPrice[String(charm.price)] || byPrice[charm.price],
      ],
      charm.price,
    )

  const groupVariant = (line) => {
    const byGroup = variantMap.charmPricingGroups || {}
    return resolveVariant(
      [
        byGroup[line.rule.id],
        line.rule.shopifyVariantId,
        byPrice[String(line.unitPrice)] || byPrice[line.unitPrice],
      ],
      line.unitPrice,
    )
  }

  const unmapped = []
  const chargeLines = charmChargeLines(payload.charms, settings().charmPricingGroups)
  const resolvedLines = await Promise.all(
    chargeLines.map(async (line) => {
      const first = line.items[0]
      const variantId =
        line.kind === 'group' ? await groupVariant(line) : await charmVariant(first)
      return { line, variantId }
    }),
  )
  for (const { line, variantId } of resolvedLines) {
    const first = line.items[0]
    if (!variantId) {
      unmapped.push(line.kind === 'group' ? line.rule.label : first.name)
    }
  }
  if (unmapped.length) {
    throw new Error(
      `These charms aren’t mapped to a Shopify variant yet: ${[...new Set(unmapped)].join(', ')}. ` +
        `Set each group’s billing variant in Admin → Charms → Grouped pricing, ` +
        `or add a variant map entry by group or price.`,
    )
  }

  const items = [
    {
      id: Number(baseVariant),
      quantity: 1,
      properties: {
        _design_token: designToken,
        Design: `${payload.charms.length} charms`,
        Finish: payload.product.color,
        ...(proofUrl ? { Proof: proofUrl } : {}),
        _layout: JSON.stringify({
          product: payload.product,
          charms: payload.charms,
          total: payload.total,
        }),
      },
    },
    ...resolvedLines.map(({ line, variantId }) => {
      const selected = new Map()
      line.items.forEach((charm) => {
        const key = `${charm.name || 'Charm'}|${charm.charmId || charm.id || ''}`
        const entry = selected.get(key) || { name: charm.name || 'Charm', count: 0 }
        entry.count += 1
        selected.set(key, entry)
      })
      const selection = [...selected.values()]
        .map(({ name, count }) => `${name}${count > 1 ? ` × ${count}` : ''}`)
        .join(', ')
        .slice(0, 240)
      return {
        id: Number(variantId),
        quantity: line.quantity,
        properties: {
          _design_token: designToken,
          _role: 'charm',
          'Charm selection': selection,
          '_Customizer charm IDs': line.items
            .map((charm) => charm.charmId || charm.id)
            .filter(Boolean)
            .join(',')
            .slice(0, 240),
        },
      }
    }),
  ]

  return { designToken, items }
}

/**
 * Draft-order flow (recommended): POST the finished design to the server, which
 * builds a Shopify Draft Order at server-validated prices and returns a hosted
 * checkout URL. The customer pays through Shopify's normal checkout and the
 * order appears in Admin — no per-charm Shopify variants required.
 */
function createDraftOrderHandler(cfg) {
  const base = (cfg.apiBase || '').replace(/\/$/, '')
  const endpoint = cfg.orderEndpoint || `${base}/api/shopify/draft-order`
  return async function onPlaceOrder(payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        product: payload.product,
        charms: payload.charms,
        preview: payload.preview || payload.proofs?.sampleUrl || null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.invoiceUrl) {
      throw new Error(data.error || `Could not start checkout (${res.status}).`)
    }
    // Hand off to Shopify's hosted checkout to take payment.
    window.location.href = data.invoiceUrl
    return { invoiceUrl: data.invoiceUrl, designToken: data.designToken }
  }
}

export function createCartHandler(cfg) {
  // 'draft' (server-side Draft Order → hosted checkout) or 'cart' (native
  // /cart/add.js with a per-charm variant map). Defaults to the draft flow when
  // an order endpoint / apiBase is available so orders + payment work with no
  // per-charm Shopify variants.
  const mode = cfg.orderMode || (cfg.orderEndpoint || cfg.apiBase ? 'draft' : 'cart')
  if (mode === 'draft') return createDraftOrderHandler(cfg)
  return createNativeCartHandler(cfg)
}

/** Remove every cart line of the design that owns cart line `key` (edit flow). */
async function removeDesignGroup(routesRoot, key) {
  const cartUrl = `${routesRoot}cart.js`.replace('//', '/')
  const updUrl = `${routesRoot}cart/update.js`.replace('//', '/')
  const cart = await fetch(cartUrl, { headers: { Accept: 'application/json' } }).then((r) => r.json())
  const item = (cart.items || []).find((i) => i.key === key)
  const tok = item && item.properties && item.properties._design_token
  if (!tok) return
  const updates = {}
  cart.items.forEach((i) => {
    if (i.properties && i.properties._design_token === tok) updates[i.key] = 0
  })
  if (Object.keys(updates).length) {
    await fetch(updUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
  }
}

function createNativeCartHandler(cfg) {
  const variantMap = cartVariantMap(cfg)
  const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/'
  const addUrl = `${routesRoot}cart/add.js`.replace('//', '/')
  const loadVariant = (id) => {
    const cacheKey = `${routesRoot}:${id}`
    if (!variantDetailsCache.has(cacheKey)) {
      const url = `${routesRoot}variants/${id}.js`.replace('//', '/')
      const request = fetchVariantDetails(url, {
        timeoutMs: cfg.variantRequestTimeoutMs ?? 3000,
      }).then((variant) => {
        if (!variant) variantDetailsCache.delete(cacheKey)
        return variant
      })
      variantDetailsCache.set(cacheKey, request)
    }
    return variantDetailsCache.get(cacheKey)
  }
  const resolveVariant = (candidates, expectedPrice) =>
    resolvePricedVariant(candidates, expectedPrice, loadVariant)

  return async function onPlaceOrder(payload) {
    // Editing an existing design (?charme_edit): remove the original cart group
    // first so the updated design replaces it instead of duplicating.
    if (cfg.editKey) {
      await removeDesignGroup(routesRoot, cfg.editKey).catch(() => {})
      cfg.editKey = null
    }
    const { designToken, items } = await buildCartItems(
      cfg,
      variantMap,
      payload,
      resolveVariant,
    )

    // Ask the theme to re-render its cart-drawer sections (Section Rendering API)
    // so the drawer reflects the new lines without a full page reload.
    const sections = drawerSectionIds()
    const body = sections.length
      ? { items, sections, sections_url: window.location.pathname }
      : { items }
    const res = await fetch(addUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Shopify cart error: ${res.status} ${txt.slice(0, 120)}`)
    }
    const added = await res.json().catch(() => ({}))
    if (added && added.sections) applyDrawerSections(added.sections)

    surfaceCart(cfg, routesRoot, designToken, payload.deferSurface)
    return { designToken }
  }
}

export function createStorefrontCartHandler(cfg = {}) {
  const storeUrl = new URL(cfg.storeUrl || cfg.storeOrigin || 'https://thecharmeedit.com').origin
  const requestedCartUrl = new URL(cfg.cartUrl || '/cart', storeUrl)
  const cartUrl =
    requestedCartUrl.origin === storeUrl ? requestedCartUrl : new URL('/cart', storeUrl)
  const variantMap = cartVariantMap(cfg)
  const pendingItems = []
  const resolveVariant = (candidates) => firstMappedVariant(candidates)

  const goToCart = () => {
    const items = pendingItems.slice()
    if (cfg.cartBridge) {
      submitStorefrontCartBridge(
        storeUrl,
        items,
        cartUrl,
        cfg.replaceDesignToken,
      )
      return
    }
    submitStorefrontCartForm(storeUrl, items, cartUrl)
  }

  const onPlaceOrder = async (payload) => {
    const { designToken, items } = await buildCartItems(
      cfg,
      variantMap,
      payload,
      resolveVariant,
    )
    pendingItems.push(...items)
    if (!payload.deferSurface) goToCart()
    return { designToken }
  }

  return {
    cartUrl: cartUrl.href,
    goToCart,
    onPlaceOrder,
  }
}

// ---- cart drawer helpers (Dawn / OS 2.0 compatible, best-effort) -----------

const cartUrl = (routesRoot) => `${routesRoot}cart`.replace(/\/\/+/, '/')

/** Section ids of any cart drawer / cart bubble currently in the DOM. */
function drawerSectionIds() {
  const ids = new Set()
  document
    .querySelectorAll(
      'cart-drawer, cart-drawer-items, cart-notification, #CartDrawer, cart-icon-bubble, #cart-icon-bubble',
    )
    .forEach((el) => {
      const sec = el.closest('[id^="shopify-section-"]')
      if (sec) ids.add(sec.id.replace('shopify-section-', ''))
    })
  return [...ids]
}

/** Swap in the freshly-rendered cart sections returned by /cart/add.js. */
function applyDrawerSections(sections) {
  for (const [id, html] of Object.entries(sections)) {
    if (typeof html !== 'string') continue
    const el = document.getElementById(`shopify-section-${id}`)
    if (!el) continue
    const fresh = new DOMParser()
      .parseFromString(html, 'text/html')
      .getElementById(`shopify-section-${id}`)
    el.innerHTML = fresh ? fresh.innerHTML : html
  }
}

/** Open the theme's cart drawer if it exposes one; returns whether it opened. */
function tryOpenDrawer() {
  const drawer = document.querySelector('cart-drawer')
  if (!drawer) return false
  drawer.classList.remove('is-empty')
  if (typeof drawer.open === 'function') {
    try {
      drawer.open()
      return true
    } catch {
      /* fall through to markup fallback */
    }
  }
  // Dawn markup fallback: reveal the drawer + lock scroll.
  drawer.classList.add('active', 'animate')
  document.body.classList.add('overflow-hidden')
  return true
}

/** Surface the cart per the merchant's preference (drawer → cart → nothing). */
function surfaceCart(cfg, routesRoot, designToken, defer) {
  // Generic events for themes that listen (non-Dawn drawers, cart notices).
  document.dispatchEvent(new CustomEvent('charme:added', { detail: { designToken } }))
  document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }))
  document.dispatchEvent(new CustomEvent('cart:build'))
  // `defer`: the customizer is about to show the cross-sell popup — keep the
  // shopper in the customizer (don't open the drawer or navigate to /cart). The
  // cart-refresh events above still fire so the header count stays in sync; the
  // "No thanks" button then surfaces the cart.
  if (defer) return
  const mode = cfg.cartRedirect || 'drawer'
  if (mode === 'none') return
  if (mode === 'cart') {
    window.location.href = cartUrl(routesRoot)
    return
  }
  // drawer: open a known drawer, else fall back to the cart page.
  if (!tryOpenDrawer()) window.location.href = cartUrl(routesRoot)
}
