import test from 'node:test'
import assert from 'node:assert/strict'
import { measuredCameraKeepout } from './appleCameraKeepouts.js'

const IPHONE_7_FRACTIONS = { x: 0.074, y: 0.032, w: 0.201, h: 0.102 }
const IPHONE_7_PLUS_FRACTIONS = { x: 0.063, y: 0.028, w: 0.45, h: 0.093 }
const IPHONE_XR_FRACTIONS = { x: 0.054, y: 0.035, w: 0.252, h: 0.208 }

test('iPhone 7 uses its measured single-camera keep-out', () => {
  const camera = measuredCameraKeepout(
    { widthMm: 67.1, heightMm: 138.3, camera: { kind: 'squareDual' } },
    IPHONE_7_FRACTIONS,
  )

  assert.deepEqual(
    {
      xMm: camera.xMm,
      yMm: camera.yMm,
      wMm: camera.wMm,
      hMm: camera.hMm,
    },
    { xMm: 5, yMm: 4.4, wMm: 13.5, hMm: 14.1 },
  )
  assert.ok(camera.wMm < 20, 'must not fall back to the generic 27 mm camera island')
})

test('iPhone 7 Plus retains its wider measured dual-camera keep-out', () => {
  const camera = measuredCameraKeepout(
    { widthMm: 77.9, heightMm: 158.2, camera: { kind: 'squareDual' } },
    IPHONE_7_PLUS_FRACTIONS,
  )

  assert.deepEqual(
    {
      xMm: camera.xMm,
      yMm: camera.yMm,
      wMm: camera.wMm,
      hMm: camera.hMm,
    },
    { xMm: 4.9, yMm: 4.4, wMm: 35.1, hMm: 14.7 },
  )
})

test('iPhone XR uses its cropped-source camera keep-out', () => {
  const camera = measuredCameraKeepout(
    { widthMm: 75.7, heightMm: 150.9, camera: { kind: 'squareDual' } },
    IPHONE_XR_FRACTIONS,
  )

  assert.deepEqual(
    { xMm: camera.xMm, yMm: camera.yMm, wMm: camera.wMm, hMm: camera.hMm },
    { xMm: 4.1, yMm: 5.3, wMm: 19.1, hMm: 31.4 },
  )
})