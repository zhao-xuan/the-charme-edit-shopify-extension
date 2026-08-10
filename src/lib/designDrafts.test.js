import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearRecoveryDraft,
  deleteDesignDraft,
  listDesignDrafts,
  loadRecoveryDraft,
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