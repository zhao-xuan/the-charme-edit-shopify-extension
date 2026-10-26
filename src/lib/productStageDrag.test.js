import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { clampCenter } from './geometry.js'

const source = readFileSync(new URL('../components/ProductStage.jsx', import.meta.url), 'utf8')
const handler = source.slice(source.indexOf('  const onCharmPointerMove ='), source.indexOf('  const endDrag ='))

for (const mode of ['single', 'group']) {
  test(`${mode} drag saves its original position before the first mutation`, () => {
    const calls = []
    const drag = { current: {
      mode, uid: 'letter', groupId: 'word', pointerId: 1,
      startX: 100, startY: 100, startCx: 50, startCy: 50,
      w: 8, h: 8, rot: 0, checkpointed: false, starts: new Map(),
    } }
    const move = vm.runInNewContext(`${handler}\nonCharmPointerMove`, {
      useCallback: (callback) => callback,
      drag, scale: 0.5, clampCenter,
      product: { printable: { outer: { xMm: 0, yMm: 0, wMm: 200, hMm: 200, rMm: 0 } } },
      onCheckpoint: () => calls.push('checkpoint'),
      onMove: () => calls.push('move'),
      onMoveGroup: () => calls.push('move'),
    })
    move({ pointerId: 2, clientX: 120, clientY: 100 })
    move({ pointerId: 1, clientX: 101, clientY: 100 })
    assert.deepEqual(calls, [], 'tap jitter must not mutate the layout before its undo checkpoint')
    move({ pointerId: 1, clientX: 102, clientY: 100 })
    move({ pointerId: 1, clientX: 110, clientY: 100 })
    assert.deepEqual(calls, ['checkpoint', 'move', 'move'])
  })
}