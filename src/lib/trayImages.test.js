import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadTrayImage, observeTrayImages } from './trayImages.js'

function harness(count = 30) {
  let notify
  let options
  let disconnected = false
  const observed = new Set()
  const images = Array.from({ length: count }, (_, index) => {
    const attributes = { 'data-charm-src': `/charm-${index}.png` }
    const image = {
      getAttribute: (name) => attributes[name] ?? null,
      setAttribute: (name, value) => { attributes[name] = value },
    }
    image.parentElement = { querySelector: () => image }
    return image
  })
  class Observer {
    constructor(callback, config) { notify = callback; options = config }
    observe(target) { observed.add(target) }
    unobserve(target) { observed.delete(target) }
    disconnect() { disconnected = true; observed.clear() }
  }
  const stop = observeTrayImages({ querySelectorAll: () => images }, Observer)
  return {
    images, observed, options, stop,
    get disconnected() { return disconnected },
    enter(indices, visible = true, width = 60) {
      notify(indices.map((index) => ({
        target: images[index].parentElement, isIntersecting: visible,
        intersectionRect: { width, height: 52 },
      })))
    },
  }
}

test('only the displayed first three rows receive image URLs; offscreen images make no requests', () => {
  const api = harness()
  assert.equal(api.images.filter((image) => image.getAttribute('src')).length, 0)
  api.enter([0, 1, 2, 3, 4, 5, 6, 7, 8])
  api.enter([9, 10, 11], false)
  assert.equal(api.images.filter((image) => image.getAttribute('src')).length, 9)
  assert.equal(api.observed.size, 21)
  assert.deepEqual(api.options, { root: null, rootMargin: '0px', threshold: 0 })
})

test('vertical and horizontal scrolling loads newly visible thumbnails independently of other image completion', () => {
  const api = harness()
  api.enter([0, 1, 2])
  api.enter([3, 4, 5])
  assert.equal(api.images[5].getAttribute('src'), '/charm-5.png')
  assert.equal(api.images[6].getAttribute('src'), null)
  // Edge contact with a clipped row must not fetch thumbnails off to the side.
  api.enter([6], true, 0)
  assert.equal(api.images[6].getAttribute('src'), null)
  api.enter([6])
  assert.equal(api.images[6].getAttribute('src'), '/charm-6.png')
})

test('cleanup disconnects the observer when changing category or unmounting', () => {
  const api = harness()
  api.stop()
  assert.equal(api.disconnected, true)
  assert.equal(api.observed.size, 0)
})

test('already loaded images are skipped and keyboard focus can load one thumbnail', () => {
  const api = harness()
  loadTrayImage(api.images[12])
  assert.equal(api.images[12].getAttribute('src'), '/charm-12.png')
  let constructed = false
  observeTrayImages({ querySelectorAll: () => [api.images[12]] }, class { constructor() { constructed = true } })()
  assert.equal(constructed, false)
  assert.doesNotThrow(() => loadTrayImage(null))
})

test('older browsers retain thumbnail access with an explicit compatibility warning', (t) => {
  const api = harness(2)
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  observeTrayImages({ querySelectorAll: () => api.images }, null)()
  assert.equal(api.images.filter((image) => image.getAttribute('src')).length, 2)
  assert.equal(warnings.length, 1)
})

test('React tray does not eagerly assign src and keeps fixed-size thumbnails for observation', () => {
  const source = readFileSync(new URL('../components/CharmTray.jsx', import.meta.url), 'utf8')
  assert.match(source, /<img data-charm-src=\{charm.src\}/)
  assert.doesNotMatch(source, /<img src=\{charm.src\}/)
  assert.match(source, /decoding="async"/)
  assert.match(source, /useEffect\(\(\) => observeTrayImages\(panelRef.current\), \[thumbnailKey\]\)/)
  assert.match(source, /key=\{`\$\{charm.id\}:\$\{charm.src\}`\}/)
})
