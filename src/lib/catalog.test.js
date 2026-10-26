import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { orderByTaxonomy } from './catalogOrder.js'

test('text classification covers live phone letters and tote Letters patches', () => {
  const source = readFileSync(new URL('./catalog.js', import.meta.url), 'utf8')
  const classification = source.slice(source.indexOf('export const TEXT_COLLECTIONS'), source.indexOf('export function charmByLabel'))
  const isTextCollection = vm.runInNewContext(`${classification.replaceAll('export ', '')}\nisTextCollection`)
  for (const collection of ['Letters & Initials', 'Letters / Initials', 'Letters', ' letters ', 'Numbers']) {
    assert.equal(isTextCollection(collection), true, collection)
  }
  for (const collection of ['Sports', 'Flowers', 'Custom patches', '', null]) {
    assert.equal(isTextCollection(collection), false, String(collection))
  }
})

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