import test from 'node:test'
import assert from 'node:assert/strict'
import { findFirstTextSpot, nextTextCharmSpot, alignToNearestTextCharm, validateLayout } from './geometry.js'

test('successive letters wrap without stacking at the right edge', () => {
  const charm = { widthMm: 8, heightMm: 8 }
  const placed = [{ uid: 'first', cxMm: 54, cyMm: 60, rot: 0, baseWmm: 8, baseHmm: 8, scale: 1 }]
  for (let index = 1; index < 10; index += 1) {
    const spot = nextTextCharmSpot(placed.at(-1), charm, { product: phoneProduct, placedCharms: placed })
    assert.ok(spot)
    placed.push({ ...spot, uid: `letter-${index}`, baseWmm: 8, baseHmm: 8, scale: 1 })
  }
  assert.ok(placed[1].cxMm < placed[0].cxMm)
  assert.ok(placed[1].cyMm > placed[0].cyMm)
  assert.equal(validateLayout(placed, phoneProduct, { minCharms: 10 }).ok, true)
})

test('successive letters avoid blocked continuation positions', () => {
  const charm = { widthMm: 8, heightMm: 8 }
  const previous = { cxMm: 20, cyMm: 60, rot: 0, baseWmm: 8, baseHmm: 8, scale: 1 }
  const blocker = { ...previous, cxMm: 29.4 }
  const spot = nextTextCharmSpot(previous, charm, { product: phoneProduct, placedCharms: [previous, blocker] })
  assert.ok(spot.cyMm > previous.cyMm)
})

const phoneProduct = {
  printable: {
    kind: 'phone',
    outer: { xMm: 0, yMm: 0, wMm: 60, hMm: 120, rMm: 4 },
    obstacles: [],
  },
}

test('phone and tote letters stay on the same baseline when continuation is clear', () => {
  for (const size of [8, 42]) {
    const product = { printable: { kind: size === 8 ? 'phone' : 'tote', outer: { xMm: 0, yMm: 0, wMm: 300, hMm: 300, rMm: 0 }, obstacles: [] } }
    for (const rotation of [0, 15, -20]) {
      const previous = { cxMm: 60.123, cyMm: 100.456, rot: rotation, baseWmm: size, baseHmm: size, scale: 1 }
      const charm = { widthMm: size, heightMm: size }
      const expected = nextTextCharmSpot(previous, charm)
      const actual = nextTextCharmSpot(previous, charm, { product, placedCharms: [previous] })
      assert.deepEqual(actual, expected, `size ${size}, rotation ${rotation} should continue the aligned row`)
    }
  }
})

test('findFirstTextSpot lands upright and biased toward the left half', () => {
  const charm = { widthMm: 8, heightMm: 8 }
  for (let i = 0; i < 20; i++) {
    const spot = findFirstTextSpot(phoneProduct, [], charm)
    assert.equal(spot.rot, 0)
    assert.ok(spot.cxMm <= 30, `expected left-biased x, got ${spot.cxMm}`)
  }
})

test('nextTextCharmSpot sits beside the previous letter along its own rotation', () => {
  const prev = { cxMm: 20, cyMm: 60, rot: 0, baseWmm: 8, baseHmm: 8, scale: 1 }
  const charm = { widthMm: 8, heightMm: 8 }
  const spot = nextTextCharmSpot(prev, charm)
  assert.equal(spot.rot, 0)
  assert.ok(spot.cxMm > prev.cxMm, 'next letter should sit to the right when upright')
  assert.equal(spot.cyMm, prev.cyMm)

  // Rotated word: the offset should follow the tilt, not stay purely horizontal.
  const tilted = { ...prev, rot: 90 }
  const tiltedSpot = nextTextCharmSpot(tilted, charm)
  assert.ok(Math.abs(tiltedSpot.cxMm - tilted.cxMm) < 0.01, 'a 90° tilt offsets vertically, not horizontally')
  assert.ok(tiltedSpot.cyMm > tilted.cyMm)
})

test('alignToNearestTextCharm snaps onto a nearby sibling baseline, leaves far drags alone', () => {
  const sibling = { cxMm: 20, cyMm: 60, rot: 0 }
  const closeBox = { cx: 32, cy: 61 } // 1mm off the sibling's horizontal baseline
  const snapped = alignToNearestTextCharm(closeBox, [sibling])
  assert.equal(snapped.cy, 60, 'perpendicular offset should snap flush with the baseline')
  assert.equal(snapped.cx, 32, 'movement along the baseline stays free')

  const farBox = { cx: 32, cy: 80 } // well off the baseline — no snap
  const unsnapped = alignToNearestTextCharm(farBox, [sibling])
  assert.equal(unsnapped.cy, 80)
})
