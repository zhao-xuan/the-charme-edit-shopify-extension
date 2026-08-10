const KEY = 'charme.designDrafts.v1'
const RECOVERY_ID = '__recovery__'
const MAX_NAMED_DRAFTS = 12

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
    charms: (placed || []).map((charm) => ({
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
      groupId: charm.groupId,
      groupLabel: charm.groupLabel,
    })),
    wordGroups: (wordGroups || []).map((group) => ({ ...group })),
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