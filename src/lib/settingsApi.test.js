import test from 'node:test'
import assert from 'node:assert/strict'
import { persistCrossSellImages, onRequestGet, onRequestPost } from '../../functions/api/settings.js'
import { crossSellTitle } from './crossSellTitle.js'
import { applySettings, loadSettings, onSettingsChange, settings } from './settings.js'

test('settings API persists independent charm/patch orders and public reads prohibit caching', async () => {
  let stored
  const env = { ADMIN_TOKEN: 'test-only', IMAGES: {
    get: async () => stored,
    put: async (_key, value) => { stored = value },
  } }
  for (const patch of [
    { taxonomy: { categoryOrder: ['Silver', 'Gold'] } },
    { patchTaxonomy: { subOrder: { Graphic: ['Sports', 'Flowers'] } } },
  ]) {
    const response = await onRequestPost({ env, request: new Request('https://example.com/api/settings', {
      method: 'POST', headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }) })
    assert.equal(response.status, 200)
  }
  const response = await onRequestGet({ env })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json()
  assert.deepEqual(data.taxonomy.categoryOrder, ['Silver', 'Gold'])
  assert.deepEqual(data.patchTaxonomy.subOrder.Graphic, ['Sports', 'Flowers'])
})

test('settings read failure is explicit rather than a successful empty order', async (t) => {
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  const response = await onRequestGet({ env: { IMAGES: { get: async () => { throw new Error('Storage unavailable') } } } })
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /merchant settings/)
  assert.equal(warnings.length, 1)
})

test('settings refresh bypasses cache, notifies changes and retains the last order on failure', async (t) => {
  applySettings({ taxonomy: { categoryOrder: ['Gold'] } })
  let notifications = 0
  const stop = onSettingsChange(() => { notifications++ })
  t.after(stop)
  const warnings = []
  t.mock.method(console, 'warn', (...args) => warnings.push(args))
  let fail = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/settings')
    assert.equal(options.cache, 'no-store')
    return fail ? Response.json({ error: 'Unavailable' }, { status: 502 })
      : Response.json({ taxonomy: { categoryOrder: ['Silver', 'Gold'] } })
  })
  await loadSettings()
  assert.deepEqual(settings().taxonomy.categoryOrder, ['Silver', 'Gold'])
  assert.equal(notifications, 1)
  await loadSettings()
  assert.equal(notifications, 1)
  fail = true
  await loadSettings()
  assert.deepEqual(settings().taxonomy.categoryOrder, ['Silver', 'Gold'])
  assert.equal(notifications, 1)
  assert.equal(warnings.length, 1)
})

test('cross-sell titles drop the retired extra 5% off suffix', () => {
  assert.equal(
    crossSellTitle('Would you like to customise your second product (extra 5% off)?'),
    'Would you like to customise your second product?',
  )
})

test('popup photos are uploaded without changing the other option fields', async () => {
  const source = {
    enabled: true,
    options: [
      { label: 'Phone case', buttonLabel: 'Customise', image: 'data:image/png;base64,AAAA', group: 'apple' },
      { label: 'Photo frame', image: 'https://cdn.example/frame.png', group: 'frame' },
    ],
  }
  const uploads = []

  const result = await persistCrossSellImages(source, async (dataUrl, option, index) => {
    uploads.push({ dataUrl, label: option.label, index })
    return 'https://cdn.example/phone.png'
  })

  assert.deepEqual(uploads, [
    { dataUrl: 'data:image/png;base64,AAAA', label: 'Phone case', index: 0 },
  ])
  assert.deepEqual(result, {
    enabled: true,
    options: [
      { label: 'Phone case', buttonLabel: 'Customise', image: 'https://cdn.example/phone.png', group: 'apple' },
      { label: 'Photo frame', image: 'https://cdn.example/frame.png', group: 'frame' },
    ],
  })
  assert.equal(source.options[0].image, 'data:image/png;base64,AAAA')
})

test('popup photos reject non-image data URLs', async () => {
  await assert.rejects(
    persistCrossSellImages(
      { options: [{ label: 'Bad', image: 'data:text/plain;base64,AAAA' }] },
      async () => 'https://cdn.example/never.png',
    ),
    /popup photo must be an image/,
  )
})