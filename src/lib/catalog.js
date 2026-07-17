import charmData from '../data/catalog.json'
import patchData from '../data/patches.json'
import charmOverrides from '../data/charm-overrides.generated.json'
import { resolveAsset } from './assets'
import { loadAdmin } from './adminStore'
import { remoteCatalog } from './remoteCatalog'
import { settings } from './settings'

// ---- Order limits & pricing ------------------------------------------------
// A craftable order needs at least MIN_CHARMS pieces and no more than
// MAX_CHARMS (beyond that, charms overcrowd the case and the layout maths gets
// unreliable). REC_MIN..REC_MAX is the softer "looks balanced" guidance.
export const MIN_CHARMS = 10
export const MAX_CHARMS = 30
export const REC_MIN = 12
export const REC_MAX = 15

/**
 * Total chargeable charm price for a placed layout. "Bundle" charms — a flat
 * price that lets the customer pick several of the same piece (e.g. little
 * stones) — are billed once per charm id; every other charm is billed per
 * placed piece.
 */
export function placedCharmsTotal(placed) {
  let total = 0
  const billed = new Set()
  for (const c of placed || []) {
    if (c.bundle) {
      if (billed.has(c.charmId)) continue
      billed.add(c.charmId)
    }
    total += c.price || 0
  }
  return total
}

/**
 * The customizer carries two completely separate decoration worlds:
 *   • phone cases → jewellery-style charms  (src/data/catalog.json)
 *   • canvas totes → embroidered patches    (src/data/patches.json)
 *
 * Each product's `kind` ('phone' | 'tote') selects which set the tray shows, so
 * a tote is never decorated with phone charms and vice-versa.
 */

/**
 * Browsing taxonomy for phone charms. Charms keep their interaction `type`
 * (1 = drag fixed, 2 = drag + scale, 3 = tap to scatter) but are *browsed* by
 * material/finish category. The category is derived from each charm's name +
 * collection with a keyword classifier (see `charmCategory`).
 */
export const PHONE_CATEGORIES = [
  {
    key: 'gold',
    label: 'Gold charms',
    sub: 'Gold tone',
    help: 'Classic gold-tone charms, letters and numbers.',
  },
  {
    key: 'silver',
    label: 'Silver charms',
    sub: 'Silver tone',
    help: 'Cool silver-tone charms.',
  },
  {
    key: 'colourful',
    label: 'Colourful charms',
    sub: 'Enamel & colour',
    help: 'Bright enamel and coloured charms.',
  },
  {
    key: 'unique',
    label: 'Natural charms',
    sub: 'One of a kind',
    help: 'Natural and hand-finished pieces — shells, pearls, stones and more.',
    note: 'Natural charms may vary slightly in size, shape, colour and pattern.',
  },
]

const UNIQUE_WORDS = [
  'shell', 'pearl', 'stone', 'ceramic', 'abalone', 'sunstone', 'coral', 'marble',
  'porcelain', 'amber', 'orb', 'crystal', 'amulet', 'reliquary', 'riviera',
  'treasure', 'pebble', 'nacre',
]
const has = (s, words) => words.some((w) => s.includes(w))

/**
 * Classify a phone charm into one of the four browsing categories. Natural /
 * hand-finished materials (which genuinely vary) win first, then silver, then
 * gold (letters & numbers default to gold tone), otherwise colourful.
 */
export function charmCategory(charm) {
  const s = `${charm.name} ${charm.collection}`.toLowerCase()
  if (has(s, UNIQUE_WORDS)) return 'unique'
  if (s.includes('silver')) return 'silver'
  if (
    s.includes('gold') ||
    s.includes('brass') ||
    charm.collection === 'Letters & Initials' ||
    charm.collection === 'Numbers'
  ) {
    return 'gold'
  }
  return 'colourful'
}

function deriveCharmLabel(charm) {
  if (charm.charmLabel) return charm.charmLabel
  const name = charm.name || ''
  let match = /\bletter\s+([a-z])\b/i.exec(name)
  if (match) return match[1].toUpperCase()
  match = /\bnumber\s+([0-9]+)\b/i.exec(name)
  return match ? match[1] : charm.charmLabel
}

function applySizeOverride(charm, charmSizes) {
  const scale = Number(charmSizes[charm.id])
  if (!scale || scale <= 0 || scale === 1) return charm
  const width = Number(charm.widthMm)
  const height = Number(charm.heightMm)
  return {
    ...charm,
    sizeScale: scale,
    widthMm: width ? +(width * scale).toFixed(2) : charm.widthMm,
    heightMm: height ? +(height * scale).toFixed(2) : charm.heightMm,
  }
}

// The merged catalogue (bundled + remote Shopify + local admin drafts) is built
// LAZILY, on first access, and memoised.
//
// ⚠️ Why lazy and not a module-scope `const`: in the Shopify IIFE widget build
// (vite.shopify.config.js → `inlineDynamicImports: true`) the whole module graph
// — including this file — is evaluated the moment the bundle script loads, which
// is BEFORE entry.jsx `await loadRemoteCatalog()` populates the remote cache.
// Reading `remoteCatalog()` at module-eval would therefore always see an empty
// remote and fall back to the bundled charms (stale sizes / prices / hidden). By
// building on first ACCESS — which only happens during React render, after the
// await — the live Shopify catalogue is reliably folded in. (The standalone app
// build code-splits, so it never hit this, which is why pages.dev looked fine
// while the embedded storefront widget showed stale data.)
let _catalog = null
function buildCatalog() {
  const ADMIN = loadAdmin()
  const REMOTE = remoteCatalog() || {}
  const REMOTE_OV = REMOTE.overrides || {}
  const charmHidden = { ...(REMOTE_OV.charmHidden || {}), ...ADMIN.charmHidden }
  const charmPrices = { ...(REMOTE_OV.charmPrices || {}), ...ADMIN.charmPrices }
  const charmSizes = { ...(REMOTE_OV.charmSizes || {}), ...ADMIN.charmSizes }

  const BASE_CHARMS = charmData.charms
    .filter((c) => !charmHidden[c.id] && !c.hidden)
    // eslint-disable-next-line no-unused-vars
    .map(({ unavailable, ...c }) => ({
      // Restore charms that were flagged `unavailable` (unmatched to a Shopify
      // add-on variant): they still have a valid price and are billed by price
      // tier / draft order, so keep them selectable rather than greyed out.
      ...c,
      kind: 'phone',
      src: resolveAsset(c.src),
      price: charmPrices[c.id] ?? c.price,
      category: c.category || charmCategory(c),
    }))

  const seenCharm = new Set()
  const mergeCustom = (list) =>
    (list || [])
      .filter((c) => !c.hidden && !seenCharm.has(c.id) && seenCharm.add(c.id))
      .map((c) => ({
        minScale: 1,
        maxScale: 1,
        ...c,
        kind: 'phone',
        src: resolveAsset(c.src),
        category: c.category || charmCategory(c),
        charmLabel: deriveCharmLabel(c),
      }))
  const CUSTOM_CHARMS = [...mergeCustom(REMOTE.charms), ...mergeCustom(ADMIN.customCharms)]

  // When the merchant's Shopify catalogue is present, the storefront uses ONLY
  // those charms: every image then comes from Shopify Files (cdn.shopify.com) and
  // merchant edits — price / size / hide — reflect immediately. The bundled
  // catalogue is only a fallback for local dev / when the API is unavailable.
  const hasRemoteCharms = Array.isArray(REMOTE.charms) && REMOTE.charms.length > 0
  const MERGED_CHARMS = hasRemoteCharms
    ? CUSTOM_CHARMS
    : [...CUSTOM_CHARMS, ...BASE_CHARMS.filter((c) => !seenCharm.has(c.id))]

  const CHARMS = MERGED_CHARMS.map((c) => {
    // Shopify charm mapping override (generated by scripts/apply-charm-mapping.mjs):
    // matched charms get the Shopify variant id (+ a fallback price). Charms with
    // no matched add-on variant used to be flagged `unavailable` (greyed out in
    // the tray) — but they still have a valid price and are billed by price tier
    // / draft order, so the override's `unavailable` flag is intentionally NOT
    // applied here: every catalogue charm stays selectable. Applied LAST so the
    // variant id / fallback price wins even when the remote catalogue overrode the
    // bundled charm by id.
    //
    // ⚠️ Price precedence: when the merchant manages charms in their Shopify store
    // (hasRemoteCharms), the charm's OWN price — edited in the admin and returned
    // by /api/catalog — is authoritative and must reflect immediately. The
    // generated override price is only a fallback for the BUNDLED catalogue (local
    // dev / no remote), so it must NOT clobber an admin-edited remote price.
    const ov = charmOverrides[c.id]
    if (!ov) return applySizeOverride(c, charmSizes)
    return applySizeOverride(
      {
        ...c,
        ...(!hasRemoteCharms && ov.price != null ? { price: ov.price } : {}),
        ...(ov.variantId ? { shopifyVariantId: ov.variantId } : {}),
      },
      charmSizes,
    )
  })
  const PATCHES = patchData.patches.map((p) => ({ ...p, kind: 'tote', src: resolveAsset(p.src) }))
  return { CHARMS, PATCHES, ITEMS_BY_KIND: { phone: CHARMS, tote: PATCHES } }
}

/** Memoised merged catalogue. First call builds it (after the remote load). */
function catalog() {
  if (!_catalog) _catalog = buildCatalog()
  return _catalog
}

/** Per-kind tab metadata (labels + helper copy differ for charms vs patches). */
export const TYPE_META_BY_KIND = {
  phone: {
    1: { key: 1, tier: 'grande', label: 'Fixture', sub: 'Grande · fixed size', help: 'Tap to add a bold focal charm, then drag to place it.' },
    2: { key: 2, tier: 'midi', label: 'Tile', sub: 'Midi · size', help: 'Tap to add, then drag to place it.' },
    3: { key: 3, tier: 'mini', label: 'Filler', sub: 'Mini · scatter', help: 'Tap to scatter these into the gaps automatically.' },
  },
  tote: {
    1: { key: 1, tier: 'grande', label: 'Statement', sub: 'Large · fixed size', help: 'Tap to add a big embroidered statement patch, then drag to place it.' },
    2: { key: 2, tier: 'midi', label: 'Feature', sub: 'Medium · size', help: 'Tap to add, then drag to place it.' },
    3: { key: 3, tier: 'mini', label: 'Filler', sub: 'State patch · scatter', help: 'Tap to scatter little state patches into the gaps.' },
  },
}

/** All decorations for a product kind, grouped by interaction type. */
export function itemsByType(kind) {
  const items = catalog().ITEMS_BY_KIND[kind] || []
  return {
    1: items.filter((c) => c.type === 1),
    2: items.filter((c) => c.type === 2),
    3: items.filter((c) => c.type === 3),
  }
}

export function typeMeta(kind) {
  return TYPE_META_BY_KIND[kind] || TYPE_META_BY_KIND.phone
}

/** Look an item up by id across both worlds. */
export function itemById(id) {
  const { CHARMS, PATCHES } = catalog()
  return CHARMS.find((c) => c.id === id) || PATCHES.find((p) => p.id === id) || null
}

/** Group a list of items by their `collection` for nicer browsing. */
export function groupByCollection(items) {
  const map = new Map()
  for (const c of items) {
    if (!map.has(c.collection)) map.set(c.collection, [])
    map.get(c.collection).push(c)
  }
  return Array.from(map, ([collection, list]) => ({ collection, items: list }))
}

export const TEXT_COLLECTIONS = ['Letters & initials', 'Numbers']
export function isTextCollection(name) {
  return TEXT_COLLECTIONS.includes(name)
}

export function charmByLabel(collection, label, preferCategory) {
  const wantedLabel = String(label == null ? '' : label).toUpperCase()
  if (!wantedLabel) return null
  const matches = catalog().CHARMS.filter(
    (charm) =>
      charm.collection === collection &&
      !charm.unavailable &&
      String(charm.charmLabel == null ? '' : charm.charmLabel).toUpperCase() === wantedLabel,
  )
  if (!matches.length) return null
  return matches.find((charm) => charm.category === preferCategory) || matches[0]
}

/**
 * Ordered tray groups for a product kind. Phone charms browse by the four
 * material categories (Gold / Silver / Colourful / Unique); tote patches keep
 * the original interaction-type tabs. Each group is `{ key, label, sub, help,
 * note?, items }` so the tray can render either taxonomy generically.
 */
export function trayGroups(kind) {
  if (kind === 'tote') {
    const meta = TYPE_META_BY_KIND.tote
    const items = itemsByType('tote')
    return [1, 2, 3].map((t) => ({
      key: `type-${t}`,
      label: meta[t].label,
      sub: meta[t].sub,
      help: meta[t].help,
      items: items[t],
    }))
  }
  const titleCase = (s) =>
    String(s || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase())
  const { CHARMS } = catalog()
  const groups = []
  const usedKeys = new Set()
  // Built-in categories first (only if they actually have charms). The tab LABEL
  // is derived from the real category value (titleCase of the key) — NOT a fixed
  // brand label — so what the customer sees matches exactly what the merchant
  // sees / edits in the Shopify admin (rename a category there and it shows here).
  // The curated help text + coloured dot are kept as visual enhancement only.
  for (const c of PHONE_CATEGORIES) {
    const items = CHARMS.filter((ch) => ch.category === c.key)
    if (items.length) {
      groups.push({ ...c, label: titleCase(c.key), items })
      usedKeys.add(c.key)
    }
  }
  // Then any custom merchant category (in first-seen order) as its own tab.
  for (const ch of CHARMS) {
    const cat = ch.category
    if (!cat || usedKeys.has(cat)) continue
    usedKeys.add(cat)
    groups.push({
      key: cat,
      label: titleCase(cat),
      sub: '',
      help: `Browse ${titleCase(cat)} charms.`,
      items: CHARMS.filter((c) => c.category === cat),
    })
  }
  // Never render an empty tray: if nothing matched (edge case), fall back to the
  // four built-in category groups.
  if (!groups.length) {
    return PHONE_CATEGORIES.map((c) => ({ ...c, items: CHARMS.filter((ch) => ch.category === c.key) }))
  }

  // Apply the merchant's saved display order (Admin → Categories & order):
  // category TABS, then sub-category SECTIONS and the charms within each section.
  // Anything not listed keeps its natural (first-seen) order after the listed
  // ones (stable).
  const tax = (settings() && settings().taxonomy) || {}
  const catOrder = tax.categoryOrder || []
  const subOrder = tax.subOrder || {}
  const charmOrder = tax.charmOrder || {}
  const rank = (arr, v) => {
    const i = (arr || []).indexOf(v)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(catOrder, a.g.key) - rank(catOrder, b.g.key) || a.i - b.i)
    .map(({ g }) => {
      const so = subOrder[g.key] || []
      const sorted = g.items
        .map((c, i) => ({ c, i }))
        .sort((a, b) => {
          const s = rank(so, a.c.collection) - rank(so, b.c.collection)
          if (s !== 0) return s
          const co = charmOrder[`${g.key}::${a.c.collection}`] || []
          return rank(co, a.c.id) - rank(co, b.c.id) || a.i - b.i
        })
        .map(({ c }) => c)
      return { ...g, items: sorted }
    })
}

/** Human label for a phone charm category key (for the order summary). Derived
 *  from the actual category value (backend-driven) so it matches the customizer
 *  tabs + the Shopify admin rather than a fixed brand label. */
export function categoryLabel(key) {
  return String(key || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}
