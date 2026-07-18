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

test('mini and midi stones start another block at their boundaries', () => {
  const mini = { collection: 'Stones', name: 'Mini Stone' }
  const midi = { collection: 'Stones', name: 'Midi Stone' }

  assert.equal(charmPricingTotal(placed(8, mini)), 2)
  assert.equal(charmPricingTotal(placed(9, mini)), 4)
  assert.equal(charmPricingTotal(placed(3, midi)), 2)
  assert.equal(charmPricingTotal(placed(4, midi)), 4)
})

test('pricing groups accumulate independently', () => {
  const charms = [
    ...placed(7, { collection: 'Filling Stones', name: 'Smoky' }),
    ...placed(9, { charmId: 'mini', collection: 'Stones', name: 'Mini Stone' }),
    ...placed(4, { charmId: 'midi', collection: 'Stones', name: 'Midi Stone' }),
  ]

  assert.equal(charmPricingTotal(charms), 11)
})

test('other styles in Stones retain their item prices', () => {
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