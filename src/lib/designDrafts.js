const KEY = 'charme.designDrafts.v1'
const RECOVERY_ID = '__recovery__'
const MAX_NAMED_DRAFTS = 12
const TOTE_KEY = 'charme.toteDesign.v1'

const storageFor = (storage) => storage || (typeof window !== 'undefined' ? window.localStorage : null)

function readAll(storage) {
  try {
    const raw = storage?.getItem(KEY)
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeAll(storage, drafts) {
  try {
    storage?.setItem(KEY, JSON.stringify(drafts))
    return true
  } catch {
    return false
  }
}

export function designSnapshot({ productId, caseColourId, gelColourId, placed, wordGroups }) {
  return {
    productId,
    caseColourId,
    gelColourId,
    charms: serializeCharms(placed),
    wordGroups: (wordGroups || []).map((group) => ({ ...group })),
  }
}

export function serializeCharms(placed) {
  return (placed || []).map((charm) => ({
    charmId: charm.charmId,
    shopifyVariantId: charm.shopifyVariantId,
    type: charm.type,
    category: charm.category,
    collection: charm.collection,
    name: charm.name,
    src: charm.src,
    price: charm.price,
    bundle: !!charm.bundle,
    wMm: charm.baseWmm,
    hMm: charm.baseHmm,
    scale: charm.scale || 1,
    rot: charm.rot || 0,
    cxMm: charm.cxMm,
    cyMm: charm.cyMm,
    toteSide: charm.toteSide,
    groupId: charm.groupId,
    groupLabel: charm.groupLabel,
  }))
}

// The tote is decorated on two independent sides (front/back); losing either
// one when the customer switches to a different product (e.g. to check out a
// phone case) would silently discard work, so it is kept in its own
// always-on-save slot rather than the single-product recovery draft above.
export function saveToteDesign(design, storage) {
  const target = storageFor(storage)
  try {
    target?.setItem(TOTE_KEY, JSON.stringify({ ...design, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadToteDesign(storage) {
  try {
    const raw = storageFor(storage)?.getItem(TOTE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearToteDesign(storage) {
  try {
    storageFor(storage)?.removeItem(TOTE_KEY)
    return true
  } catch {
    return false
  }
}

// Phone and frame designs are lost when the customer switches to a different
// product KIND (e.g. to check out a tote) and back, because only the tote has
// its own always-on-save slot above. Give every non-tote kind the same
// treatment, keyed by kind so a phone design and a frame design don't clobber
// each other.
const KIND_KEY_PREFIX = 'charme.kindDesign.'

export function saveKindDesign(kind, design, storage) {
  const target = storageFor(storage)
  try {
    target?.setItem(`${KIND_KEY_PREFIX}${kind}.v1`, JSON.stringify({ ...design, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadKindDesign(kind, storage) {
  try {
    const raw = storageFor(storage)?.getItem(`${KIND_KEY_PREFIX}${kind}.v1`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearKindDesign(kind, storage) {
  try {
    storageFor(storage)?.removeItem(`${KIND_KEY_PREFIX}${kind}.v1`)
    return true
  } catch {
    return false
  }
}

export function listDesignDrafts(storage) {
  return readAll(storageFor(storage))
    .filter((draft) => draft.id !== RECOVERY_ID)
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function loadRecoveryDraft(storage) {
  return readAll(storageFor(storage)).find((draft) => draft.id === RECOVERY_ID) || null
}

export function saveRecoveryDraft(snapshot, storage) {
  return saveDraft({ id: RECOVERY_ID, name: 'Recovered design', snapshot }, storage)
}

export function clearRecoveryDraft(storage) {
  const target = storageFor(storage)
  return writeAll(target, readAll(target).filter((draft) => draft.id !== RECOVERY_ID))
}

export function saveDraft({ id, name, snapshot }, storage) {
  const target = storageFor(storage)
  const drafts = readAll(target)
  const now = Date.now()
  const next = {
    id: id || `draft-${now}-${Math.random().toString(16).slice(2)}`,
    name: String(name || 'Untitled design').trim() || 'Untitled design',
    snapshot,
    updatedAt: now,
  }
  const withoutCurrent = drafts.filter((draft) => draft.id !== next.id)
  const named = withoutCurrent.filter((draft) => draft.id !== RECOVERY_ID).slice(0, MAX_NAMED_DRAFTS - 1)
  const recovery = withoutCurrent.filter((draft) => draft.id === RECOVERY_ID)
  return writeAll(target, next.id === RECOVERY_ID ? [next, ...named] : [next, ...recovery, ...named]) ? next : null
}

export function deleteDesignDraft(id, storage) {
  const target = storageFor(storage)
  return writeAll(target, readAll(target).filter((draft) => draft.id !== id))
}