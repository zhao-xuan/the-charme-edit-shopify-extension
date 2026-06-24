import charmData from '../data/catalog.json'
import patchData from '../data/patches.json'
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

// Merchant overrides (re-priced / hidden charms + uploaded custom charms) are
// merged on top of the built-in catalogue at load time. These come from the
// Cloudflare API (remoteCatalog) and any local-only admin drafts.
const ADMIN = loadAdmin()
const REMOTE = remoteCatalog() || {}
const REMOTE_OV = REMOTE.overrides || {}
const charmHidden = { ...(REMOTE_OV.charmHidden || {}), ...ADMIN.charmHidden }
const charmPrices = { ...(REMOTE_OV.charmPrices || {}), ...ADMIN.charmPrices }

const BASE_CHARMS = charmData.charms
  .filter((c) => !charmHidden[c.id])
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

// Remote (Cloudflare DB) charms first, then local-only drafts; skip hidden ones
// and de-dup by id.
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
    }))
const CUSTOM_CHARMS = [...mergeCustom(REMOTE.charms), ...mergeCustom(ADMIN.customCharms)]

// Merchant charms surface first within each category so they're easy to find.
const CHARMS = [...CUSTOM_CHARMS, ...BASE_CHARMS]
const PATCHES = patchData.patches.map((p) => ({ ...p, kind: 'tote', src: resolveAsset(p.src) }))

const ITEMS_BY_KIND = {
  phone: CHARMS,
  tote: PATCHES,
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
  const items = ITEMS_BY_KIND[kind] || []
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
  return PHONE_CATEGORIES.map((c) => ({
    ...c,
    items: CHARMS.filter((ch) => ch.category === c.key),
  }))
}

/** Human label for a phone charm category key (for the order summary). */
export function categoryLabel(key) {
  return PHONE_CATEGORIES.find((c) => c.key === key)?.label || key
}
