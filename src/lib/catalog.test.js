import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { orderByTaxonomy, orderList, phoneTaxonomy } from './catalogOrder.js'

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

test('unlisted patch categories, sections and cards follow the same first-seen order as admin', () => {
  const patches = [
    { id: 'z-last', category: 'Zebra', collection: 'Sports' },
    { id: 'a', category: 'Animals', collection: 'Birds' },
    { id: 'flower', category: 'Zebra', collection: 'Flowers' },
    { id: 'z-first', category: 'Zebra', collection: 'Sports' },
  ]
  const taxonomy = { patchOrder: { 'Zebra::Sports': ['z-first'] } }
  assert.deepEqual(orderByTaxonomy(patches, taxonomy).map((patch) => patch.id), ['z-first', 'z-last', 'flower', 'a'])
  assert.deepEqual(orderList(['Zebra', 'Animals'], []), ['Zebra', 'Animals'])
  assert.deepEqual(patches.map((patch) => patch.id), ['z-last', 'a', 'flower', 'z-first'])
})

test('phone taxonomy aliases normalize only category keys and merge mixed historical spellings', () => {
  const source = {
    categoryOrder: ['Silver', ' Gold ', 'Natural', 'Unique', 'Colorful'],
    subOrder: { Gold: ['Sports'], gold: ['Sports', 'Flowers'], Natural: ['Shells'] },
    charmOrder: { 'Gold::Sports': ['a'], 'gold::Sports': ['a', 'b'], 'Natural::Shells::Small': ['shell'] },
  }
  assert.deepEqual(phoneTaxonomy(source), {
    categoryOrder: ['silver', 'gold', 'unique', 'colourful'],
    subOrder: { gold: ['Sports', 'Flowers'], unique: ['Shells'] },
    charmOrder: { 'gold::Sports': ['a', 'b'], 'unique::Shells::Small': ['shell'] },
  })
  assert.equal(source.categoryOrder[0], 'Silver')
})