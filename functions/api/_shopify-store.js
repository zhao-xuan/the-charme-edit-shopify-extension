// Shopify-native storage layer for the Charmé catalogue.
// ---------------------------------------------------------------------------
// The App-Store build runs NO database of its own: structured catalogue
// (charms / products / overrides / presets) lives in the merchant's own Shopify
// store as METAOBJECTS, and images live in Shopify FILES (cdn.shopify.com).
//
// IMPORTANT — schema compatibility: the store may already contain charm/product
// metaobjects created by scripts/migrate-to-shopify.mjs +
// scripts/migrate-products-to-shopify.mjs, which use **typed fields** (name,
// price, width_mm, image=file_reference, …) and store the app's id in a
// `legacy_id` field. This module reads/writes those SAME typed fields so the
// admin sees existing data and new writes stay compatible. `charme_charm` and
// `charme_product` are keyed by `legacy_id`; `charme_override` and
// `charme_preset` (which this app owns entirely) use a single `data` JSON field
// keyed by the metaobject handle.
//
// All calls run server-side with the app's Admin API token (see
// _lib.getShopifyToken), so no token reaches the browser and each shop only ever
// touches its own data.
import { shopifyAdmin, uploadImageFile } from './_lib.js'

/** Metaobject type keys (one "table" each). */
export const TYPES = {
  charm: 'charme_charm',
  product: 'charme_product',
  override: 'charme_override',
  preset: 'charme_preset',
}

/** True when the Shopify Admin backend is configured for this environment. */
export function shopifyConfigured(env) {
  return !!(
    env &&
    env.SHOPIFY_STORE &&
    ((env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) || env.SHOPIFY_ADMIN_TOKEN)
  )
}

/** Sanitise an id into a Shopify metaobject handle ([a-z0-9-]). */
export function moHandle(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 240) || 'item'
  )
}

const rid = () => Math.random().toString(36).slice(2, 7)
const slug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item'
export const makeId = (prefix, name) => `${prefix}-${slug(name)}-${rid()}`

/** overrideHandle for a bundled base-catalogue item. */
export const overrideHandle = (scope, refId) => `ov-${scope}-${refId}`

const numOrNull = (v) => (v == null || v === '' ? null : Number(v))

// ---------------------------------------------------------------------------
// Metaobject definitions (created on first use for a FRESH store; on a migrated
// store they already exist and creation is skipped). Field lists mirror the
// migration scripts so both paths converge on the same schema.
// ---------------------------------------------------------------------------
const CHARM_FIELD_DEFS = [
  ['name', 'Name', 'single_line_text_field'],
  ['image', 'Image', 'file_reference'],
  ['category', 'Category', 'single_line_text_field'],
  ['tier', 'Tier', 'single_line_text_field'],
  ['collection', 'Collection', 'single_line_text_field'],
  ['charm_type', 'Charm type', 'number_integer'],
  ['price', 'Price', 'number_decimal'],
  ['width_mm', 'Width mm', 'number_decimal'],
  ['height_mm', 'Height mm', 'number_decimal'],
  ['px_w', 'Px width', 'number_integer'],
  ['px_h', 'Px height', 'number_integer'],
  ['min_scale', 'Min scale', 'number_decimal'],
  ['max_scale', 'Max scale', 'number_decimal'],
  ['hidden', 'Hidden', 'boolean'],
  ['shopify_variant_id', 'Shopify variant id', 'single_line_text_field'],
  ['bundle', 'Bundle', 'boolean'],
  ['bundle_max', 'Bundle max', 'number_integer'],
  ['source', 'Source', 'single_line_text_field'],
  ['legacy_id', 'Legacy id', 'single_line_text_field'],
]
const PRODUCT_FIELD_DEFS = [
  ['name', 'Name', 'single_line_text_field'],
  ['kind', 'Kind', 'single_line_text_field'],
  ['base_price', 'Base price', 'number_decimal'],
  ['width_mm', 'Width mm', 'number_decimal'],
  ['height_mm', 'Height mm', 'number_decimal'],
  ['body_image_white', 'Body image (white)', 'file_reference'],
  ['body_image_black', 'Body image (black)', 'file_reference'],
  ['legacy_id', 'Legacy id', 'single_line_text_field'],
]
const OVERRIDE_FIELD_DEFS = [['data', 'Data', 'json']]
const PRESET_FIELD_DEFS = [
  ['title', 'Title', 'single_line_text_field'],
  ['data', 'Data', 'json'],
]

const DEF_META = {
  [TYPES.charm]: { name: 'Charmé charm', fields: CHARM_FIELD_DEFS, keyBy: 'legacy_id' },
  [TYPES.product]: { name: 'Charmé product', fields: PRODUCT_FIELD_DEFS, keyBy: 'legacy_id' },
  [TYPES.override]: { name: 'Charmé override', fields: OVERRIDE_FIELD_DEFS, keyBy: 'handle' },
  [TYPES.preset]: { name: 'Charmé preset', fields: PRESET_FIELD_DEFS, keyBy: 'handle' },
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------
const Q_DEF = `query($type:String!){ metaobjectDefinitionByType(type:$type){ id type fieldDefinitions{ key } } }`
const M_DEF_CREATE = `
  mutation($definition: MetaobjectDefinitionCreateInput!){
    metaobjectDefinitionCreate(definition:$definition){
      metaobjectDefinition{ id type }
      userErrors{ field message code }
    }
  }`
const NODE_FIELDS = `fields{ key value reference{ ... on MediaImage{ image{ url } } } }`
const Q_BY_HANDLE = `query($handle: MetaobjectHandleInput!){ metaobjectByHandle(handle:$handle){ id handle ${NODE_FIELDS} } }`
const Q_LIST = `query($type:String!,$after:String){ metaobjects(type:$type, first:200, after:$after){ edges{ node{ id handle ${NODE_FIELDS} } } pageInfo{ hasNextPage endCursor } } }`
const M_CREATE = `mutation($input:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$input){ metaobject{ id handle } userErrors{ field message code } } }`
const M_UPDATE = `mutation($id:ID!,$metaobject:MetaobjectUpdateInput!){ metaobjectUpdate(id:$id, metaobject:$metaobject){ metaobject{ id } userErrors{ field message code } } }`
const M_DELETE = `mutation($id:ID!){ metaobjectDelete(id:$id){ deletedId userErrors{ field message code } } }`

// ---------------------------------------------------------------------------
// Definitions: ensure they exist + learn their real field keys (write filter)
// ---------------------------------------------------------------------------
const _defCache = new Map() // type -> Set(fieldKeys)

async function ensureDefinition(env, type) {
  if (_defCache.has(type)) return _defCache.get(type)
  const meta = DEF_META[type]
  const found = await shopifyAdmin(env, Q_DEF, { type })
  let def = found.metaobjectDefinitionByType
  if (!def) {
    const res = await shopifyAdmin(env, M_DEF_CREATE, {
      definition: {
        name: meta.name,
        type,
        access: { storefront: 'PUBLIC_READ' },
        ...(meta.fields.some(([k]) => k === 'name') ? { displayNameKey: 'name' } : {}),
        fieldDefinitions: meta.fields.map(([key, name, ftype]) => ({ key, name, type: ftype })),
      },
    })
    const errs = res.metaobjectDefinitionCreate.userErrors || []
    if (errs.length && !errs.some((e) => /taken|exist/i.test(e.message))) {
      throw new Error(`definition ${type}: ${JSON.stringify(errs)}`)
    }
    // Re-read to learn the actual field keys (also covers the "taken" race).
    def = (await shopifyAdmin(env, Q_DEF, { type })).metaobjectDefinitionByType
  }
  const keys = new Set((def?.fieldDefinitions || []).map((f) => f.key))
  _defCache.set(type, keys)
  return keys
}

// ---------------------------------------------------------------------------
// Codecs: metaobject fields <-> app record shape
// ---------------------------------------------------------------------------
const stripMeta = (rec) => {
  const out = {}
  for (const [k, v] of Object.entries(rec || {})) if (!k.startsWith('_')) out[k] = v
  return out
}

function toFields(type, record, imageGids = {}) {
  if (type === TYPES.charm) {
    const f = {
      name: record.name,
      category: record.category,
      tier: record.tier,
      collection: record.collection,
      charm_type: record.type != null ? String(record.type) : undefined,
      price: record.price != null ? String(record.price) : undefined,
      width_mm: record.widthMm != null ? String(record.widthMm) : undefined,
      height_mm: record.heightMm != null ? String(record.heightMm) : undefined,
      px_w: record.pxW != null ? String(record.pxW) : undefined,
      px_h: record.pxH != null ? String(record.pxH) : undefined,
      min_scale: record.minScale != null ? String(record.minScale) : undefined,
      max_scale: record.maxScale != null ? String(record.maxScale) : undefined,
      hidden: record.hidden != null ? String(!!record.hidden) : undefined,
      shopify_variant_id: record.shopifyVariantId || undefined,
      bundle: record.bundle != null ? String(!!record.bundle) : undefined,
      bundle_max: record.bundleMax != null ? String(record.bundleMax) : undefined,
      source: record.source || undefined,
      legacy_id: record.id,
    }
    if (imageGids.image) f.image = imageGids.image
    return f
  }
  if (type === TYPES.product) {
    const f = {
      name: record.name,
      kind: record.kind,
      base_price: record.basePrice != null ? String(record.basePrice) : undefined,
      width_mm: record.widthMm != null ? String(record.widthMm) : undefined,
      height_mm: record.heightMm != null ? String(record.heightMm) : undefined,
      legacy_id: record.id,
    }
    if (imageGids.image) f.body_image_white = imageGids.image
    return f
  }
  // override / preset — everything in a single JSON blob.
  const f = { data: JSON.stringify(stripMeta(record)) }
  if (type === TYPES.preset) f.title = record.title || record.handle || ''
  return f
}

function toRecord(type, node) {
  const f = {}
  const ref = {}
  for (const x of node.fields || []) {
    f[x.key] = x.value
    if (x.reference && x.reference.image && x.reference.image.url) ref[x.key] = x.reference.image.url
  }
  if (type === TYPES.charm) {
    return {
      id: f.legacy_id || node.handle,
      name: f.name || '',
      collection: f.collection || 'Custom',
      category: f.category || 'gold',
      tier: f.tier || 'midi',
      type: f.charm_type != null && f.charm_type !== '' ? Number(f.charm_type) : 2,
      price: f.price != null && f.price !== '' ? Number(f.price) : 0,
      widthMm: numOrNull(f.width_mm),
      heightMm: numOrNull(f.height_mm),
      pxW: numOrNull(f.px_w),
      pxH: numOrNull(f.px_h),
      minScale: f.min_scale != null && f.min_scale !== '' ? Number(f.min_scale) : 1,
      maxScale: f.max_scale != null && f.max_scale !== '' ? Number(f.max_scale) : 1,
      hidden: f.hidden === 'true' || f.hidden === true,
      shopifyVariantId: f.shopify_variant_id || undefined,
      bundle: f.bundle === 'true' || f.bundle === true,
      bundleMax: numOrNull(f.bundle_max),
      source: f.source || 'custom',
      src: ref.image || null,
      _gid: node.id,
      _handle: node.handle,
    }
  }
  if (type === TYPES.product) {
    return {
      id: f.legacy_id || node.handle,
      name: f.name || '',
      kind: f.kind || 'phone',
      basePrice: numOrNull(f.base_price),
      widthMm: numOrNull(f.width_mm),
      heightMm: numOrNull(f.height_mm),
      // Merchant-uploaded body renders, served from Shopify Files (cdn.shopify.com).
      // `src` is the primary (white/glitter) finish; `srcBlack` the black finish
      // when the merchant uploaded one. The storefront uses these as the case
      // render so the picture always comes from the merchant's Shopify store.
      src: ref.body_image_white || ref.body_image_black || null,
      srcBlack: ref.body_image_black || null,
      colourLabel: 'Default',
      _gid: node.id,
      _handle: node.handle,
    }
  }
  // override / preset
  let data = {}
  try {
    data = JSON.parse(f.data || '{}')
  } catch {
    data = {}
  }
  return { ...data, _gid: node.id, _handle: node.handle }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
/** List every record of a type (paginated). */
export async function listRecords(env, type) {
  await ensureDefinition(env, type)
  const out = []
  let after = null
  for (let i = 0; i < 40; i++) {
    const res = await shopifyAdmin(env, Q_LIST, { type, after })
    const conn = res.metaobjects
    for (const e of conn.edges) out.push(toRecord(type, e.node))
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  return out
}

/** Locate the metaobject node for an id (by handle first, then by legacy_id). */
async function findNode(env, type, id) {
  const meta = DEF_META[type]
  const byHandle = await shopifyAdmin(env, Q_BY_HANDLE, { handle: { type, handle: moHandle(id) } })
  const node = byHandle.metaobjectByHandle
  if (node) {
    if (meta.keyBy === 'handle') return node
    const legacy = (node.fields || []).find((x) => x.key === 'legacy_id')
    if (legacy && legacy.value === id) return node
  }
  if (meta.keyBy === 'legacy_id') {
    // Migrated entries have an auto-generated handle → scan for the legacy_id.
    let after = null
    for (let i = 0; i < 40; i++) {
      const res = await shopifyAdmin(env, Q_LIST, { type, after })
      const conn = res.metaobjects
      for (const e of conn.edges) {
        const legacy = (e.node.fields || []).find((x) => x.key === 'legacy_id')
        if (legacy && legacy.value === id) return e.node
      }
      if (!conn.pageInfo.hasNextPage) break
      after = conn.pageInfo.endCursor
    }
  }
  return null
}

/** Read one record by id, or null. */
export async function getRecord(env, type, id) {
  await ensureDefinition(env, type)
  const node = await findNode(env, type, id)
  return node ? toRecord(type, node) : null
}

/**
 * Create or update a record. `imageGids` maps a logical image slot to a Shopify
 * File GID (e.g. { image: 'gid://shopify/MediaImage/…' }); omit it on updates
 * that don't change the image (the existing reference is preserved).
 */
export async function saveRecord(env, type, id, record, imageGids = {}) {
  const defKeys = await ensureDefinition(env, type)
  const raw = toFields(type, { ...record, id }, imageGids)
  // Only write fields the definition actually has, and skip empties.
  const fields = Object.entries(raw)
    .filter(([k, v]) => defKeys.has(k) && v !== '' && v != null)
    .map(([key, value]) => ({ key, value: String(value) }))

  const existing = await findNode(env, type, id)
  if (existing) {
    const res = await shopifyAdmin(env, M_UPDATE, { id: existing.id, metaobject: { fields } })
    const errs = res.metaobjectUpdate.userErrors || []
    if (errs.length) throw new Error(`update ${type}: ${JSON.stringify(errs)}`)
    return existing.id
  }
  const res = await shopifyAdmin(env, M_CREATE, { input: { type, handle: moHandle(id), fields } })
  const errs = res.metaobjectCreate.userErrors || []
  if (errs.length) throw new Error(`create ${type}: ${JSON.stringify(errs)}`)
  return res.metaobjectCreate.metaobject.id
}

/** Delete a record by id (the referenced image File is left in Files). */
export async function deleteRecord(env, type, id) {
  await ensureDefinition(env, type)
  const node = await findNode(env, type, id)
  if (!node) return false
  const res = await shopifyAdmin(env, M_DELETE, { id: node.id })
  const errs = res.metaobjectDelete.userErrors || []
  if (errs.length) throw new Error(`delete ${type}: ${JSON.stringify(errs)}`)
  return true
}

/**
 * Update specific fields of an already-known metaobject by its GID (partial
 * update — omitted fields are preserved). Much cheaper than saveRecord() when
 * you already hold the node GID (e.g. from listRecords → record._gid), because
 * it skips the by-id lookup. `fields` is `[{ key, value }]`.
 */
export async function updateRecordFields(env, gid, fields) {
  const res = await shopifyAdmin(env, M_UPDATE, { id: gid, metaobject: { fields } })
  const errs = res.metaobjectUpdate.userErrors || []
  if (errs.length) throw new Error(`update ${gid}: ${JSON.stringify(errs)}`)
  return gid
}

// ---------------------------------------------------------------------------
// Images → Shopify Files
// ---------------------------------------------------------------------------
/**
 * Persist an image and return { url, id } where `id` is the File GID to store in
 * a file_reference field. Accepts a data: URL (uploads) or an existing http(s)
 * URL (returns it as-is with a null GID).
 */
export async function storeImageToFiles(env, dataUrl, opts = {}) {
  if (!dataUrl) return { url: null, id: null }
  if (/^https?:/i.test(dataUrl)) return { url: dataUrl, id: null }
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('expected a base64 data URL or http(s) URL')
  const contentType = m[1]
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return uploadImageFile(env, bytes, { ...opts, contentType })
}

// ---------------------------------------------------------------------------
// Client-shape helpers (strip _meta; add scale defaults for charms)
// ---------------------------------------------------------------------------
export const cleanCharm = (r) => ({ minScale: 1, maxScale: 1, ...stripMeta(r) })
export const cleanProduct = (r) => stripMeta(r)
