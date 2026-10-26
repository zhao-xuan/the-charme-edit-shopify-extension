import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { productPhotoCrop, productPhotoStyle } from './productPhoto.js'

const boundsByModel = JSON.parse(
  readFileSync(new URL('../data/official-phone-case-image-bounds.json', import.meta.url), 'utf8'),
)

test('XR finishes crop the current 1024 by 1536 artwork to the same full shell', () => {
  for (const finish of ['black', 'white']) {
    const bounds = boundsByModel['iphone-xr'][finish]
    assert.deepEqual(bounds, {
      sourceWidth: 1024, sourceHeight: 1536,
      left: 104, top: 210, width: 816, height: 1131,
    })
    assert.deepEqual(productPhotoCrop(bounds), { left: 104, top: 210, width: 816, height: 1131 })
  }
})

test('stage and exported source crops map all source positions to identical product coordinates', () => {
  for (const finishes of Object.values(boundsByModel)) for (const bounds of Object.values(finishes)) {
    const style = productPhotoStyle(bounds)
    const crop = productPhotoCrop(bounds, bounds.sourceWidth * 2, bounds.sourceHeight * 2)
    for (const fraction of [0, 0.2, 0.5, 0.8, 1]) {
      const sourceX = crop.left + crop.width * fraction
      const sourceY = crop.top + crop.height * fraction
      const stageX = parseFloat(style.left) / 100 + sourceX / (bounds.sourceWidth * 2) * parseFloat(style.width) / 100
      const stageY = parseFloat(style.top) / 100 + sourceY / (bounds.sourceHeight * 2) * parseFloat(style.height) / 100
      assert.ok(Math.abs(stageX - fraction) < 1e-12)
      assert.ok(Math.abs(stageY - fraction) < 1e-12)
    }
  }
})
