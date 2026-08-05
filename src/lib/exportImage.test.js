import assert from 'node:assert/strict'
import test from 'node:test'

import { drawProductPhoto } from './exportImage.js'

test('drawProductPhoto crops reviewed transparent canvases before scaling', () => {
  const calls = []
  const ctx = { drawImage: (...args) => calls.push(args) }
  const image = { id: 'samsung-case' }
  const bounds = { left: 535, top: 35, width: 464, height: 954 }

  drawProductPhoto(ctx, image, bounds, 466, 980)

  assert.deepEqual(calls, [[image, 535, 35, 464, 954, 0, 0, 466, 980]])
})

test('drawProductPhoto preserves the existing full-image path without bounds', () => {
  const calls = []
  const ctx = { drawImage: (...args) => calls.push(args) }
  const image = { id: 'standard-case' }

  drawProductPhoto(ctx, image, undefined, 466, 980)

  assert.deepEqual(calls, [[image, 0, 0, 466, 980]])
})