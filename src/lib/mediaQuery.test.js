import test from 'node:test'
import assert from 'node:assert/strict'
import { observeMediaQuery } from './mediaQuery.js'

test('observeMediaQuery uses the modern change-event API', () => {
  const calls = []
  const listener = () => {}
  const mediaQuery = {
    addEventListener: (type, fn) => calls.push(['add', type, fn]),
    removeEventListener: (type, fn) => calls.push(['remove', type, fn]),
  }

  const stop = observeMediaQuery(mediaQuery, listener)
  stop()

  assert.deepEqual(calls, [
    ['add', 'change', listener],
    ['remove', 'change', listener],
  ])
})

test('observeMediaQuery falls back to the legacy Safari listener API', () => {
  const calls = []
  const listener = () => {}
  const mediaQuery = {
    addListener: (fn) => calls.push(['add', fn]),
    removeListener: (fn) => calls.push(['remove', fn]),
  }

  const stop = observeMediaQuery(mediaQuery, listener)
  stop()

  assert.deepEqual(calls, [
    ['add', listener],
    ['remove', listener],
  ])
})