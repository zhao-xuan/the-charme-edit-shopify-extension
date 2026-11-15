import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultMobileTrayPercent, defaultPreviewZoom } from './mobilePreview.js'

test('mobile opens with a closer product preview and desktop keeps its original zoom', () => {
  assert.equal(defaultPreviewZoom(true, 'tote'), 1.3)
  assert.equal(defaultPreviewZoom(true, 'phone'), 1)
  assert.equal(defaultPreviewZoom(true, 'frame'), 1)
  assert.equal(defaultPreviewZoom(false, 'tote'), 1)
  assert.equal(defaultPreviewZoom(false, 'phone'), 1)
})


test('tote opens with a little more tray space than phone and frame', () => {
  assert.equal(defaultMobileTrayPercent('tote'), 42)
  assert.equal(defaultMobileTrayPercent('phone'), 32)
  assert.equal(defaultMobileTrayPercent('frame'), 32)
})
