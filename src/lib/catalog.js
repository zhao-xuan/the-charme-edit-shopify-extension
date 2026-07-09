import charmData from '../data/catalog.json'
import patchData from '../data/patches.json'
import charmOverrides from '../data/charm-overrides.generated.json'
import { resolveAsset } from './assets'
import { loadAdmin } from './adminStore'
import { remoteCatalog } from './remoteCatalog'

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

/**
 * Single-character label ("A".."Z" / "0".."9") for a letter or number charm,
 * used by "Type a word". Bundled catalogue rows carry an explicit `charmLabel`,
 * but MIGRATED Shopify charms don't — so derive it from the name (e.g. "Gold
 * Letter A" → "A", "Gold Number 0" → "0") for the text collections.
 */
function deriveCharmLabel(c) {
  if (c.charmLabel) return c.charmLabel
  const name = c.name || ''
  let m = /\bletter\s+([a-z])\b/i.exec(name)
  if (m) return m[1].toUpperCase()
  m = /\bnumber\s+([0-9]+)\b/i.exec(name)
  if (m) return m[1]
  return c.charmLabel
}

/** Apply a merchant size-scale override (keyed by charm id) to a charm's mm size. */
function applySizeOverride(c, charmSizes) {
  const scale = Number(charmSizes[c.id])
  if (!scale || scale <= 0 || scale === 1) return c
  const w = Number(c.widthMm)
  const h = Number(c.heightMm)
  return {
    ...c,
    sizeScale: scale,
    widthMm: w ? +(w * scale).toFixed(2) : c.widthMm,
    heightMm: h ? +(h * scale).toFixed(2) : c.heightMm,
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
    .map((c) => ({
      ...c,
      kind: 'phone',
      src: resolveAsset(c.src),
      price: charmPrices[c.id] ?? c.price,
      // Catalogue rows now carry an explicit material category (gold | silver |
      // colourful | unique) from the reference categorisation; only fall back to
      // the keyword classifier for legacy rows that lack one.
      category: c.category || charmCategory(c),
    }))

  // Remote (Shopify) charms first, then local-only drafts; skip hidden ones and
  // de-dup by id.
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
        // Migrated Shopify charms lack charmLabel → derive it so "Type a word"
        // can resolve letters/numbers from the remote catalogue too.
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
    // matched charms get the Shopify variant price + id; unmatched charms are
    // flagged unavailable so the tray greys them out. Applied LAST so it wins even
    // when the remote catalogue overrode the bundled charm by id.
    const ov = charmOverrides[c.id]
    if (!ov) return applySizeOverride(c, charmSizes)
    return applySizeOverride(
      {
        ...c,
        ...(ov.price != null ? { price: ov.price } : {}),
        ...(ov.unavailable ? { unavailable: true } : {}),
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

/** Collections whose pieces are single characters — support "type a word". */
export const TEXT_COLLECTIONS = ['Letters & initials', 'Numbers']
export function isTextCollection(name) {
  return TEXT_COLLECTIONS.includes(name)
}

/**
 * Resolve a single-character charm (a letter or number) by the character it
 * shows (its `charmLabel`). `collection` is "Letters & initials" or "Numbers";
 * `preferCategory` is the tray finish tab the user is on (gold/silver/…), so a
 * typed word uses the matching finish when one exists. Skips unavailable charms.
 */
export function charmByLabel(collection, label, preferCategory) {
  const want = String(label == null ? '' : label).toUpperCase()
  if (!want) return null
  const matches = catalog().CHARMS.filter(
    (c) =>
      c.collection === collection &&
      !c.unavailable &&
      String(c.charmLabel == null ? '' : c.charmLabel).toUpperCase() === want,
  )
  if (!matches.length) return null
  return matches.find((c) => c.category === preferCategory) || matches[0]
}

/**
 * Ordered tray groups for a product kind. Phone charms browse by **category**
 * (one tab each): the four built-in materials (Gold / Silver / Colourful /
 * Natural) first — with their nice labels — then any custom merchant categories
 * that have charms. Within each tab the charms are further split into sections
 * by their `collection` (the sub-category). Tote patches keep the original
 * interaction-type tabs. Each group is `{ key, label, sub, help, note?, items }`.
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
  // Built-in categories first (only if they actually have charms), keeping their
  // curated labels / help text.
  for (const c of PHONE_CATEGORIES) {
    const items = CHARMS.filter((ch) => ch.category === c.key)
    if (items.length) {
      groups.push({ ...c, items })
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
  return groups
}

/** Human label for a phone charm category key (for the order summary). */
export function categoryLabel(key) {
  return PHONE_CATEGORIES.find((c) => c.key === key)?.label || key
}
