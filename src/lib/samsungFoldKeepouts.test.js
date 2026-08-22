import test from 'node:test'
import assert from 'node:assert/strict'
import { samsungFoldObstacles } from './samsungFoldKeepouts.js'

const ACTIVE_FOLDS = [
  ['galaxy-z-fold-3', 128.1, 158.2, 'right'],
  ['galaxy-z-fold-4', 130.1, 155.1, 'right'],
  ['galaxy-z-fold-5', 129.9, 154.9, 'right'],
  ['galaxy-z-fold-7', 143.2, 158.4, 'left'],
]

test('active Fold models keep charms off both the screen and centre crease', () => {
  for (const [modelId, widthMm, heightMm, screenSide] of ACTIVE_FOLDS) {
    const obstacles = samsungFoldObstacles(modelId, widthMm, heightMm)
    assert.deepEqual(obstacles.map((obstacle) => obstacle.label), ['screen', 'crease'])

    const [screen, crease] = obstacles
    assert.equal(screen.yMm, 4)
    assert.equal(screen.yMm + screen.hMm, heightMm - 4)
    assert.ok(crease.xMm < widthMm / 2 + 3, modelId)
    assert.ok(crease.xMm + crease.wMm > widthMm / 2 - 3, modelId)

    if (screenSide === 'left') {
      assert.equal(screen.xMm, 4)
      assert.ok(Math.abs(screen.xMm + screen.wMm - crease.xMm) < 0.01)
    } else {
      assert.ok(Math.abs(screen.xMm - crease.xMm - crease.wMm) < 0.01)
      assert.ok(Math.abs(screen.xMm + screen.wMm - (widthMm - 4)) < 0.01)
    }
  }
})

test('non-Fold and unavailable folded-view models retain their existing geometry', () => {
  assert.deepEqual(samsungFoldObstacles('galaxy-s24', 71, 148), [])
  assert.deepEqual(samsungFoldObstacles('galaxy-z-fold-6', 68.1, 155.5), [])
})