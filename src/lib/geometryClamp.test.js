import assert from 'node:assert/strict'
import test from 'node:test'
import { clampCenter, clampCenterByShape, roundedRectContains } from './geometry.js'

const printable = {
  kind: 'phone',
  outer: { xMm: 0, yMm: 0, wMm: 100, hMm: 100, rMm: 0 },
}

test('phone charm movement follows the opaque shape rather than transparent box corners', () => {
  const box = { cx: 95, cy: 50, w: 20, h: 20, rot: 0 }
  const bowShape = new Float32Array([-0.2, -0.4, 0.2, -0.4, -0.2, 0.4, 0.2, 0.4])

  assert.deepEqual(clampCenter(box, printable), { cx: 90, cy: 50 })
  assert.deepEqual(clampCenterByShape(box, printable, bowShape, { cx: 50, cy: 50 }), {
    cx: 95,
    cy: 50,
  })
})

test('shape-aware clamping stops only when the charm itself reaches the edge', () => {
  const box = { cx: 99, cy: 50, w: 20, h: 20, rot: 0 }
  const charmShape = new Float32Array([-0.2, -0.4, 0.2, -0.4, -0.2, 0.4, 0.2, 0.4])
  const clamped = clampCenterByShape(box, printable, charmShape, { cx: 50, cy: 50 })

  assert.ok(Math.abs(clamped.cx - 96) < 0.001)
  assert.equal(clamped.cy, 50)
})

test('shape-aware movement respects rounded phone corners', () => {
  const roundedPrintable = {
    ...printable,
    outer: { ...printable.outer, rMm: 20 },
  }
  const box = { cx: 1, cy: 1, w: 20, h: 20, rot: 0 }
  const charmShape = new Float32Array([-0.2, -0.4, 0.2, -0.4, -0.2, 0.4, 0.2, 0.4])
  const clamped = clampCenterByShape(box, roundedPrintable, charmShape, { cx: 50, cy: 50 })

  assert.ok(clamped.cx > 1)
  assert.ok(clamped.cy > 1)
  assert.ok(clamped.cx < 20)
  assert.ok(clamped.cy < 20)
  for (let i = 0; i < charmShape.length; i += 2) {
    assert.equal(
      roundedRectContains(
        roundedPrintable.outer.xMm,
        roundedPrintable.outer.yMm,
        roundedPrintable.outer.wMm,
        roundedPrintable.outer.hMm,
        roundedPrintable.outer.rMm,
        clamped.cx + charmShape[i] * box.w,
        clamped.cy + charmShape[i + 1] * box.h,
      ),
      true,
    )
  }
})
