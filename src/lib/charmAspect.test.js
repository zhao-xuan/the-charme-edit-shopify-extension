import assert from 'node:assert/strict'
import test from 'node:test'
import { charmSizeFromArtwork, charmWithPngArtwork, pngPixelSize } from './charmAspect.js'
import { charmFootprint } from './geometry.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
test('PNG header yields actual artwork dimensions and rejects invalid inputs', () => {
  assert.deepEqual(pngPixelSize(png), { pxW: 1, pxH: 1 })
  for (const src of ['', 'data:image/jpeg;base64,AA==', 'data:image/png;base64,AA==']) {
    assert.throws(() => pngPixelSize(src), /PNG/)
  }
})

test('every landscape, portrait and square charm preserves its longest edge without stretching', () => {
  for (const [pxW, pxH] of [[111, 326], [133, 354], [337, 192], [301, 364], [165, 169], [75, 75]]) {
    for (const longMm of [8.3, 16, 20.8, 36.8]) {
      const size = charmSizeFromArtwork({ widthMm: longMm, heightMm: longMm, pxW, pxH })
      assert.ok(Math.abs(size.widthMm / size.heightMm - pxW / pxH) < 1e-12)
      assert.ok(Math.abs(Math.max(size.widthMm, size.heightMm) - longMm) < 1e-12)
      const footprint = charmFootprint({ baseWmm: size.widthMm, baseHmm: size.heightMm, scale: 1.35, rot: 30 })
      assert.ok(Math.abs(footprint.w / footprint.h - pxW / pxH) < 1e-12)
      assert.deepEqual(charmSizeFromArtwork(size), size)
    }
  }
})

test('missing legacy pixel metadata is unchanged; a replacement PNG refreshes its ratio', () => {
  const old = { id: 'old', widthMm: 12, heightMm: 24, name: 'Test' }
  assert.equal(charmSizeFromArtwork(old), old)
  assert.deepEqual(charmWithPngArtwork(old, png), { ...old, widthMm: 24, heightMm: 24, pxW: 1, pxH: 1 })
})
