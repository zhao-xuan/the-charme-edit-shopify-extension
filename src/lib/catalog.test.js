import test from 'node:test'
import assert from 'node:assert/strict'
import { orderByTaxonomy } from './catalogOrder.js'

test('patch taxonomy preserves saved sub-category order across patch types', () => {
  const patches = [
    { id: 'sports-grande', category: 'Graphic', collection: 'Sports', type: 1 },
    { id: 'letters-midi', category: 'Graphic', collection: 'Letters', type: 2 },
  ]
  const taxonomy = {
    categoryOrder: ['Graphic'],
    subOrder: { Graphic: ['Letters', 'Sports'] },
    patchOrder: {},
  }

  const ordered = orderByTaxonomy(patches, taxonomy)

  assert.deepEqual(ordered.map((patch) => patch.id), ['letters-midi', 'sports-grande'])
})