import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CHARM_PRICING_GROUPS,
  charmChargeLines,
  charmPricingTotal,
  normalizeCharmPricingGroups,
} from './charmPricing.js'

const placed = (count, charm) =>
  Array.from({ length: count }, (_, index) => ({
    charmId: `${charm.charmId || 'charm'}-${index}`,
    price: 99,
    ...charm,
  }))

test('filling styles share each six-piece block', () => {
  const six = placed(6, { collection: 'Filling Stones', name: 'Ice Blue' })
  const seven = [...six, ...placed(1, { charmId: 'earthy', collection: 'Filling Stones', name: 'Earthy' })]

  assert.equal(charmPricingTotal(six), 1.5)
  assert.equal(charmPricingTotal(seven), 3)
  assert.equal(charmChargeLines(seven)[0].quantity, 2)
})

test('mini and midi stones start another block at their Shopify sub-category boundaries', () => {
  const mini = { collection: 'Mini Stones', name: 'Mini Stone' }
  const midi = { collection: 'Midi Stone', name: 'Midi Stone' }

  assert.equal(charmPricingTotal(placed(8, mini)), 2)
  assert.equal(charmPricingTotal(placed(9, mini)), 4)
  assert.equal(charmPricingTotal(placed(3, midi)), 2)
  assert.equal(charmPricingTotal(placed(4, midi)), 4)
})

test('mini shells use the live three-piece pack', () => {
  const shell = { collection: 'Mini Shells', name: 'Natural Shell', price: 2 }

  assert.equal(charmPricingTotal(placed(3, shell)), 2)
  assert.equal(charmPricingTotal(placed(4, shell)), 4)
  assert.equal(charmChargeLines(placed(3, shell))[0].quantity, 1)
})

test('pricing groups accumulate independently', () => {
  const charms = [
    ...placed(7, { collection: 'Filling Stones', name: 'Smoky' }),
    ...placed(9, { charmId: 'mini', collection: 'Mini Stones', name: 'Mini Stone' }),
    ...placed(4, { charmId: 'midi', collection: 'Midi Stone', name: 'Midi Stone' }),
  ]

  assert.equal(charmPricingTotal(charms), 11)
})

test('other sub-categories retain their item prices', () => {
  const marble = placed(2, { collection: 'Stones', name: 'Marble Stone', price: 3 })

  assert.equal(charmPricingTotal(marble), 6)
  assert.ok(charmChargeLines(marble).every((line) => line.kind === 'item'))
})

test('disabled groups fall back to item pricing', () => {
  const groups = DEFAULT_CHARM_PRICING_GROUPS.map((group) =>
    group.id === 'filling-stones' ? { ...group, enabled: false } : group,
  )
  const filling = placed(2, { collection: 'Filling Stones', name: 'Cream', price: 5 })

  assert.equal(charmPricingTotal(filling, groups), 10)
})

test('an all-empty configuration restores the verified defaults', () => {
  assert.deepEqual(
    normalizeCharmPricingGroups([{ id: 'empty', collection: '', nameEquals: '' }]),
    DEFAULT_CHARM_PRICING_GROUPS,
  )
})

test('an explicitly empty configuration disables grouped pricing', () => {
  const charms = placed(2, { collection: 'Filling Stones', name: 'Cream', price: 5 })

  assert.deepEqual(normalizeCharmPricingGroups([]), [])
  assert.equal(charmPricingTotal(charms, []), 10)
})

test('saved legacy groups migrate to their real Shopify sub-categories', () => {
  const groups = normalizeCharmPricingGroups([
    { id: 'mini-stones', collection: 'Stones', nameEquals: 'Mini Stone', quantity: 8, price: 2 },
    { id: 'midi-stones', collection: 'Stones', nameEquals: 'Midi Stone', quantity: 3, price: 2 },
    { id: 'natural-shells', collection: 'Shells', nameEquals: 'Natural Shell', quantity: 3, price: 2 },
  ])

  assert.deepEqual(groups.map((group) => group.collection), ['Mini Stones', 'Midi Stone', 'Mini Shells'])
})

test('a custom group matches every charm in its selected Shopify sub-category', () => {
  const groups = [{ id: 'stars', label: 'Stars pack', collection: 'Stars', quantity: 2, price: 3 }]
  const stars = placed(3, { collection: 'Stars', name: 'Gold Star', price: 2 })

  assert.equal(charmPricingTotal(stars, groups), 6)
})

test('legacy bundles still bill once per charm id', () => {
  const bundle = placed(4, {
    charmId: 'legacy-filler',
    collection: 'Other',
    name: 'Legacy filler',
    price: 2,
    bundle: true,
  })

  assert.equal(charmPricingTotal(bundle), 2)
  assert.equal(charmChargeLines(bundle)[0].items.length, 4)
})