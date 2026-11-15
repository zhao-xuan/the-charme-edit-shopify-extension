import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearRecoveryDraft,
  deleteDesignDraft,
  listDesignDrafts,
  loadRecoveryDraft,
  loadKindDesign,
  saveKindDesign,
  loadToteDesign,
  saveToteDesign,
  saveDraft,
  saveRecoveryDraft,
} from './designDrafts.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('design drafts keep named work separate from automatic recovery', () => {
  const storage = memoryStorage()
  const recovery = saveRecoveryDraft({ productId: 'iphone-xr', charms: [{ charmId: 'taurus' }] }, storage)
  const named = saveDraft({ name: 'Birthday case', snapshot: { productId: 'iphone-16' } }, storage)

  assert.equal(loadRecoveryDraft(storage).id, recovery.id)
  assert.deepEqual(listDesignDrafts(storage).map((draft) => draft.name), ['Birthday case'])
  assert.equal(deleteDesignDraft(named.id, storage), true)
  assert.deepEqual(listDesignDrafts(storage), [])
  assert.equal(clearRecoveryDraft(storage), true)
  assert.equal(loadRecoveryDraft(storage), null)
})

test('phone and frame history preserve models, finishes, designs and word groups independently of tote sides', () => {
  const storage = memoryStorage()
  const phone = { productId: 'iphone-16-pro-max', caseColourId: 'black', gelColourId: 'white', charms: [{ charmId: 'letter-a', cxMm: 12, cyMm: 34 }], wordGroups: [{ id: 'word-1', label: 'A' }] }
  const frame = { productId: 'frame-5x7', charms: [{ charmId: 'star' }], wordGroups: [] }
  const tote = { front: [{ charmId: 'patch-front' }], back: [{ charmId: 'patch-back' }] }
  assert.equal(saveKindDesign('phone', phone, storage), true)
  assert.equal(saveKindDesign('frame', frame, storage), true)
  assert.equal(saveToteDesign(tote, storage), true)
  const restoredPhone = loadKindDesign('phone', storage)
  assert.deepEqual({ ...restoredPhone, updatedAt: undefined }, { ...phone, updatedAt: undefined })
  assert.deepEqual(loadKindDesign('frame', storage).charms, frame.charms)
  assert.deepEqual(loadToteDesign(storage).front, tote.front)
  assert.deepEqual(loadToteDesign(storage).back, tote.back)
})

test('a chosen phone model remains saved even without charms', () => {
  const storage = memoryStorage()
  saveKindDesign('phone', { productId: 'iphone-16-pro-max', gelColourId: 'black', charms: [] }, storage)
  const restored = loadKindDesign('phone', storage)
  assert.equal(restored.productId, 'iphone-16-pro-max')
  assert.equal(restored.gelColourId, 'black')
  assert.deepEqual(restored.charms, [])
})
