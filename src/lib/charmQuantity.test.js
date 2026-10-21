import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { validateLayout } from './geometry.js'
import { charmChargeLines } from './charmPricing.js'

const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
const callbacks = source.slice(source.indexOf('  const commitPlaced ='), source.indexOf('  const activateCharm ='))
const printable = {
  outer: { xMm: 0, yMm: 0, wMm: 100, hMm: 100, rMm: 0 },
}
const layout = (count) => Array.from({ length: count }, (_, i) => ({
  uid: `charm-${i}`,
  charmId: 'stone',
  baseWmm: 1,
  baseHmm: 1,
  scale: 1,
  rot: 0,
  cxMm: 2 + (i % 25) * 3,
  cyMm: 2 + Math.floor(i / 25) * 3,
}))

for (const kind of ['phone', 'tote', 'frame']) {
  test(`${kind} layouts above the former 30-piece cap remain valid`, () => {
    for (const count of [31, 64, 500]) {
      const validation = validateLayout(layout(count), { kind, printable }, { minCharms: 10 })
      assert.equal(validation.count, count)
      assert.equal(validation.ok, true)
      assert.equal(validation.problems, 0)
    }
  })
}

test('quantity changes preserve minimum, overlap and boundary validation', () => {
  const product = { kind: 'phone', printable }
  assert.equal(validateLayout(layout(9), product, { minCharms: 10 }).tooFew, true)
  const overlapping = layout(64)
  overlapping[1] = { ...overlapping[0], uid: overlapping[1].uid }
  assert.equal(validateLayout(overlapping, product).ok, false)
  const outside = layout(64)
  outside[0].cxMm = -10
  assert.equal(validateLayout(outside, product).ok, false)
})

for (const path of ['addAt', 'addAuto']) {
  test(`${path} adds repeatedly beyond total and legacy bundle caps, including rapid taps`, () => {
    let placed = layout(30)
    let checkpoints = 0
    const events = []
    const api = vm.runInNewContext(`${callbacks}\n;({ addAt, addAuto })`, {
      useCallback: (callback) => callback,
      pushHistory: () => checkpoints++,
      setPlaced: (update) => { placed = update(placed) },
      setSelectedUid: () => {},
      analytics: { track: (...event) => events.push(event) },
      // Keep the ref stale to model several clicks before React re-renders.
      placedRef: { current: placed },
      makePlaced: (charm, pos) => ({ ...charm, ...pos, charmId: charm.id, uid: `added-${checkpoints}` }),
      constrainPosition: (charm) => charm,
      product: { printable },
      geometryProduct: { printable },
      isTextCollection: () => false,
      findScatterSpot: () => null,
    })
    const charm = { id: 'stone', bundle: true, bundleMax: 2, type: 3 }
    for (let i = 0; i < 70; i++) api[path](charm, { xMm: 50, yMm: 50 })
    assert.equal(placed.length, 100)
    assert.equal(checkpoints, 70)
    assert.equal(events.length, 70)
  })
}

test('unlimited quantity retains pricing blocks and legacy flat-price billing', () => {
  const pieces = layout(64).map((charm) => ({ ...charm, price: 2, collection: 'Stones' }))
  const groups = [{ id: 'stones', enabled: true, collection: 'Stones', quantity: 8, price: 3 }]
  const [group] = charmChargeLines(pieces, groups)
  assert.equal(group.quantity, 8)
  assert.equal(group.total, 24)
  const [bundle] = charmChargeLines(pieces.map((charm) => ({ ...charm, bundle: true, bundleMax: 2 })), [])
  assert.equal(bundle.quantity, 1)
  assert.equal(bundle.items.length, 64)
  assert.equal(bundle.total, 2)
})
