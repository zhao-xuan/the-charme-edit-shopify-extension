import test from 'node:test'
import assert from 'node:assert/strict'
import {
  samsungCameraObstacles,
  samsungCameraObstaclesByCaseColour,
} from './samsungCameraKeepouts.js'

const MEASURED_LENSES = [
  ['galaxy-s24', 71, 148, [0.118, 0.056, 0.278, 0.349]],
  ['galaxy-s24-plus', 76, 158, [0.108, 0.051, 0.269, 0.344]],
  ['galaxy-s24-ultra', 78, 163, [0.126, 0.053, 0.29, 0.357], [0.361, 0.071, 0.454, 0.228]],
  ['galaxy-s25', 71, 148, [0.091, 0.041, 0.293, 0.356]],
  ['galaxy-s25-plus', 76, 158, [0.085, 0.038, 0.283, 0.347]],
  ['galaxy-s25-ultra', 78, 163, [0.1, 0.045, 0.304, 0.367], [0.346, 0.065, 0.469, 0.235]],
  ['galaxy-s26', 71, 148, [0.118, 0.047, 0.306, 0.355]],
  ['galaxy-s26-plus', 76, 158, [0.112, 0.039, 0.286, 0.329]],
  ['galaxy-s26-ultra', 78, 163, [0.109, 0.047, 0.297, 0.36], [0.376, 0.068, 0.479, 0.23]],
]

function assertCovers(obstacle, measured, widthMm, heightMm) {
  assert.equal(obstacle.type, 'roundedRect')
  assert.ok(obstacle.xMm / widthMm <= measured[0])
  assert.ok(obstacle.yMm / heightMm <= measured[1])
  assert.ok((obstacle.xMm + obstacle.wMm) / widthMm >= measured[2])
  assert.ok((obstacle.yMm + obstacle.hMm) / heightMm >= measured[3])
}

test('S24-S26 camera keep-outs cover the lens edges measured from the case photos', () => {
  for (const [modelId, widthMm, heightMm, mainLenses, auxiliaryLenses] of MEASURED_LENSES) {
    const obstacles = samsungCameraObstacles(modelId, widthMm, heightMm)
    assert.equal(obstacles.length, 2, modelId)
    assertCovers(obstacles[0], mainLenses, widthMm, heightMm)
    if (auxiliaryLenses) assertCovers(obstacles[1], auxiliaryLenses, widthMm, heightMm)
  }
})

test('camera calibration remains scoped to the launched S24-S26 models', () => {
  assert.equal(samsungCameraObstacles('galaxy-s23', 71, 148), null)
})

test('S26 Ultra Black covers its fourth main lens without enlarging the White keep-out', () => {
  const standard = samsungCameraObstacles('galaxy-s26-ultra', 78, 163)
  const black = samsungCameraObstaclesByCaseColour('galaxy-s26-ultra', 78, 163).black

  assertCovers(black[0], [0.09, 0.04, 0.33, 0.435], 78, 163)
  assertCovers(black[1], [0.33, 0.055, 0.51, 0.225], 78, 163)
  assert.ok(black[0].hMm > standard[0].hMm)
  assert.equal(samsungCameraObstaclesByCaseColour('galaxy-s24', 71, 148), null)
})