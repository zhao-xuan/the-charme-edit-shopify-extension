import test from 'node:test'
import assert from 'node:assert/strict'
import { findFirstTextSpot, nextTextCharmSpot, alignToNearestTextCharm } from './geometry.js'

const phoneProduct = {
  printable: {
    kind: 'phone',
    outer: { xMm: 0, yMm: 0, wMm: 60, hMm: 120, rMm: 4 },
    obstacles: [],
  },
}

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
