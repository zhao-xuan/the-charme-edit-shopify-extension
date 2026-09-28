import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fetchVariantDetails, resolvePricedVariant } from './shopifyVariant.js'

test('tote proof uploads retain an explicit front regardless of completion order', async () => {
  const source = readFileSync(new URL('../../shopify/widget/shopifyCart.js', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('function resolveProductVariant('), source.indexOf('/**\n * Draft-order flow'))
  for (const firstSide of ['front', 'back']) {
    const uploads = new Map()
    const build = vm.runInNewContext(`${code}\nbuildCartItems`, {
      uploadProof: (endpoint, image, token) => new Promise(resolve => uploads.set(image, { token, resolve })),
      charmChargeLines: () => [], settings: () => ({}),
    })
    const result = build({ uploadEndpoint: '/api/upload-proof' }, { products: { tote: '123' } }, {
      designToken: 'stable', product: { id: 'tote', kind: 'tote' }, charms: [],
      proofs: { frontUrl: 'front', backUrl: 'back', sampleUrl: 'back' },
    })
    for (const side of [firstSide, firstSide === 'front' ? 'back' : 'front']) {
      assert.equal(uploads.get(side).token, `stable_${side}`)
      uploads.get(side).resolve(`https://example.com/${side}.png`)
    }
    const properties = (await result).items[0].properties
    assert.equal(properties._design_token, 'stable')
    assert.equal(properties._proof_front, 'https://example.com/front.png')
    assert.equal(properties.Proof, properties._proof_front)
    assert.equal(properties['Proof back'], 'https://example.com/back.png')
  }
})

test('cart relocation safely skips removed blocks and missing anchor parents', () => {
  const source = readFileSync(new URL('../../shopify/snippets/cart-products.liquid', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('        function relocateSecondProduct()'), source.indexOf('        function ensureRelocated('))
  let inserts = 0
  const parent = { insertBefore() { inserts++ } }
  const block = { isConnected: true, parentNode: {} }
  const anchor = { isConnected: true, parentNode: parent, nextSibling: null }
  const relocate = vm.runInNewContext(`${code}\nrelocateSecondProduct`, { block, anchor, document: { querySelector: () => null }, window: { matchMedia: () => ({ matches: false }) } })
  relocate()
  assert.equal(inserts, 1)
  anchor.parentNode = null
  assert.equal(relocate(), true)
  anchor.isConnected = false
  anchor.parentNode = parent
  assert.equal(relocate(), true)
  block.isConnected = false
  anchor.isConnected = true
  assert.equal(relocate(), true)
  assert.equal(inserts, 1)
})

test('proof upload reports progress and rejects timeout, network errors and unconfirmed uploads', async () => {
  const source = readFileSync(new URL('../../shopify/widget/shopifyCart.js', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('async function uploadProof('), source.indexOf('/** Resolve the Shopify variant'))
  for (const outcome of ['success', 'timeout', 'network', 'invalid', 'http']) {
    const progress = []
    const upload = vm.runInNewContext(`${code}\nuploadProof`, {
      URL, setTimeout, clearTimeout, window: { location: { origin: 'https://charme-customizer.pages.dev' } },
      XMLHttpRequest: class {
        upload = {}
        open() {}
        setRequestHeader() {}
        send(body) {
          assert.equal(this.timeout, 5000)
          assert.equal(JSON.parse(body).designToken, 'stable-token')
          this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 })
          if (outcome === 'timeout') return this.ontimeout()
          if (outcome === 'network') return this.onerror()
          this.status = outcome === 'http' ? 503 : 200
          this.responseText = JSON.stringify(outcome === 'invalid' ? {} : { url: 'https://example.com/proof.jpg' })
          this.onload()
        }
      },
    })
    const result = upload('/api/upload-proof', 'data:image/jpeg;base64,test', 'stable-token', 'standard', percent => progress.push(percent))
    if (outcome === 'success') {
      assert.equal(await result, 'https://example.com/proof.jpg')
      assert.deepEqual(progress, [50, 100])
    } else {
      await assert.rejects(result, /retry/i)
      assert.deepEqual(progress, [50])
    }
  }
})

test('bridge payload validation rejects malformed designs before cart requests', () => {
  const source = readFileSync(new URL('../../shopify/snippets/charme-cart-group.liquid', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('  function decodeBridgePayload('), source.indexOf('  function missingBridgeItems('))
  const api = vm.runInNewContext(`${code}\n({ decodeBridgePayload, bridgeItems })`, { atob, TextDecoder, Uint8Array })
  const base = { id: 123, quantity: 1, properties: { _design_token: 'valid', _layout: '{"name":"你好"}' } }
  const payload = { version: 1, items: [base] }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  assert.equal(api.bridgeItems(api.decodeBridgePayload(encoded))[0].properties._layout, base.properties._layout)
  for (const invalid of ['', 'a', 'a%20', 'a'.repeat(200001), Buffer.from('not json').toString('base64url')]) assert.throws(() => api.decodeBridgePayload(invalid), /Invalid cart payload/)
  for (const invalid of [
    { version: 2, items: [base] }, { version: 1, items: [] },
    { ...payload, items: Array(101).fill(base) },
    ...[0, -1, 1.5, 'invalid', true].map(quantity => ({ ...payload, items: [{ ...base, quantity }] })),
    { ...payload, items: [{ ...base, id: true }] },
    { ...payload, items: [{ ...base, properties: [] }] },
    { ...payload, items: [{ ...base, properties: { _design_token: 'valid', bad: {} } }] },
    { ...payload, items: [{ ...base, properties: { _design_token: '../bad' } }] },
    { ...payload, items: [{ ...base, properties: { _design_token: 'valid', _role: 'charm' } }] },
    { ...payload, items: [base, base] },
    { ...payload, replaceDesignToken: 'invalid token' },
  ]) assert.throws(() => api.bridgeItems(invalid), /Invalid|exactly one base/)
})

function bridgeHarness(mode) {
  const source = readFileSync(new URL('../../shopify/snippets/charme-cart-group.liquid', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('  function missingBridgeItems('), source.indexOf('  function groupedUpdates('))
  const items = [{ id: 123, quantity: 1, properties: { _design_token: 'test' } }, { id: 456, quantity: 2, properties: { _design_token: 'test', _role: 'charm' } }]
  if (mode === 'batched') {
    for (let index = 2; index < 45; index++) items.push({ id: 1000 + index, quantity: 1, properties: { _design_token: 'test', _role: 'charm' } })
  }
  let cart = mode === 'partial' ? [items[0]] : []
  let adds = 0
  let reloads = 0
  let cleared = false
  let feedback = ''
  const logs = []
  const events = {}
  const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: key => key === 'x-request-id' ? 'request-123' : 'application/json' }, text: async () => JSON.stringify(body) })
  const context = {
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { hash: '#charme-cart=encoded', pathname: '/cart', search: '' },
    history: { replaceState() { cleared = true; context.location.hash = '' } },
    window: { addEventListener(name, listener) { events[name] = listener }, location: { reload() { reloads++ } }, Shopify: { routes: { root: '/en-us/' } } },
    console: { error(label, details) { logs.push(JSON.parse(details)) } },
    decodeBridgePayload: () => ({ items }), bridgeItems: payload => payload.items,
    fetch: async (url, options) => {
      assert.ok(url.startsWith('/en-us/'))
      if (url.endsWith('/add.js')) {
        adds++
        const incoming = JSON.parse(options.body).items
        assert.ok(incoming.length <= 20)
        if (mode === 'rejected') return response({ description: 'This charm is sold out.' }, 422)
        cart.push(...incoming)
        if (mode === 'lost-response' && adds === 1) throw new Error('Connection lost')
        return response({ items: incoming })
      }
      return response({ items: cart })
    },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  context.showBridgeStatus = text => { feedback = text }
  return { context, items, events, logs, state: () => ({ adds, reloads, cleared, feedback, cart }) }
}

test('cart retry reconciles partial success and confirms all lines before clearing the payload', async () => {
  for (const mode of ['partial', 'lost-response', 'batched']) {
    const api = bridgeHarness(mode)
    await api.context.applyCartBridge()
    if (mode === 'lost-response') {
      assert.equal(api.state().cleared, false)
      await api.context.applyCartBridge()
      assert.equal(api.state().adds, 1)
      api.context.window.__charmeBridgeFailed = false
      await api.context.applyCartBridge()
    }
    assert.equal(api.state().adds, mode === 'batched' ? 3 : 1)
    assert.equal(api.state().reloads, 1)
    assert.equal(api.state().cleared, true)
    assert.equal(api.state().cart.length, api.items.length)
  }
})

test('Shopify rejection is actionable and preserves the design without automatic retry loops', async () => {
  const api = bridgeHarness('rejected')
  await api.context.applyCartBridge()
  assert.match(api.state().feedback, /This charm is sold out/)
  assert.equal(api.state().cleared, false)
  assert.equal(api.state().reloads, 0)
  assert.equal(api.logs[0].stage, 'add-items')
  assert.equal(api.logs[0].status, 422)
  assert.equal(api.logs[0].requestId, 'request-123')
  assert.equal(api.logs[0].response.description, 'This charm is sold out.')
  assert.equal(JSON.stringify(api.logs).includes('_design_token'), false)
  await api.context.applyCartBridge()
  assert.equal(api.state().adds, 1)
})

test('bridge lifecycle serializes concurrent events and skips completed payload replay', async () => {
  const api = bridgeHarness('partial')
  await Promise.all([api.context.applyCartBridge(), api.context.applyCartBridge(), api.events.pageshow(), api.events.hashchange()])
  assert.equal(api.state().adds, 1)
  api.context.location.hash = '#charme-cart=encoded'
  await api.context.applyCartBridge()
  assert.equal(api.state().adds, 1)
  assert.equal(api.context.location.hash, '')
  assert.equal(api.context.window.__charmeAdding, false)
})

test('bridge validation failure logs its condition and never calls Shopify', async () => {
  const api = bridgeHarness('partial')
  api.context.decodeBridgePayload = () => { throw new Error('Invalid cart payload JSON') }
  api.context.fetch = () => { assert.fail('Validation must precede all network calls') }
  await api.context.applyCartBridge()
  assert.equal(api.logs[0].stage, 'validate')
  assert.equal(api.logs[0].message, 'Invalid cart payload JSON')
  assert.equal(api.state().cleared, false)
  assert.match(api.state().feedback, /link is invalid/)
})

test('hash changes during a request preserve and process the new payload serially', async () => {
  const api = bridgeHarness('partial')
  const fetchOriginal = api.context.fetch
  let release
  let held = true
  api.context.fetch = async (...args) => {
    if (held) {
      held = false
      await new Promise(resolve => { release = resolve })
    }
    return fetchOriginal(...args)
  }
  api.context.decodeBridgePayload = encoded => ({ items: encoded === 'next' ? [{ id: 789, quantity: 1, properties: { _design_token: 'next' } }] : api.items })
  const first = api.context.applyCartBridge()
  api.context.location.hash = '#charme-cart=next'
  api.events.hashchange()
  assert.equal(api.state().adds, 0)
  release()
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(api.state().adds, 2)
  assert.equal(api.state().cart.length, 3)
  assert.equal(api.context.location.hash, '')
  assert.equal(api.context.window.__charmeAdding, false)
})

test('a failed payload does not block a different design arriving through the hash', async () => {
  const api = bridgeHarness('partial')
  api.context.decodeBridgePayload = encoded => {
    if (encoded === 'encoded') throw new Error('Invalid cart payload')
    return { items: api.items }
  }
  await api.context.applyCartBridge()
  assert.equal(api.context.window.__charmeBridgeFailed, true)
  api.context.location.hash = '#charme-cart=next'
  await api.context.applyCartBridge()
  assert.equal(api.state().adds, 1)
  assert.equal(api.context.window.__charmeBridgeFailed, false)
})

test('non-JSON Shopify errors preserve HTTP metadata and do not expose response HTML', async () => {
  const api = bridgeHarness('partial')
  api.context.fetch = async () => ({ ok: false, status: 503, headers: { get: () => 'test-header' }, text: async () => '<html>private@example.com</html>' })
  await api.context.applyCartBridge()
  assert.equal(api.logs[0].status, 503)
  assert.equal(api.logs[0].stage, 'read-cart')
  assert.equal(JSON.stringify(api.logs).includes('private@example.com'), false)
})

test('iPhone 18 Pro and Pro Max resolve every finish before default or Other variants', () => {
  const products = JSON.parse(readFileSync(new URL('../../shopify/widget/variantmap-products.generated.json', import.meta.url), 'utf8'))
  const source = readFileSync(new URL('../../shopify/widget/shopifyCart.js', import.meta.url), 'utf8')
  const resolver = source.slice(source.indexOf('function resolveProductVariant('), source.indexOf('function cartVariantMap('))
  const resolve = vm.runInNewContext(`${resolver}\nresolveProductVariant`)
  const expected = {
    'iphone-18-pro': { glitter: 57172232274298, white: 57172232339834, black: 57172232307066 },
    'iphone-18-pro-max': { glitter: 57172232470906, white: 57172232536442, black: 57172232503674 },
  }
  for (const [model, finishes] of Object.entries(expected)) {
    for (const [gelId, variantId] of Object.entries(finishes)) {
      assert.equal(products[`${model}:${gelId}`], variantId)
      assert.equal(resolve({ products }, { product: {
        id: model, gelId, colorId: gelId === 'black' ? 'black' : 'white',
        shopifyVariantId: finishes.glitter,
      } }), variantId)
    }
  }
})

test('bounds a variant request that never responds', async () => {
  const startedAt = Date.now()
  const variant = await fetchVariantDetails('/variants/slow.js', {
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 15,
  })

  assert.equal(variant, null)
  assert.ok(Date.now() - startedAt < 250)
})

test('keeps a direct charm variant when its live price matches', async () => {
  const variants = {
    direct: { available: true, price: 200 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['direct', 'fallback'], 2, async (id) => variants[id]),
    'direct',
  )
})

test('rejects wrong-price direct mappings and uses a same-price fallback', async () => {
  const variants = {
    wrong: { available: true, price: 300 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['wrong', 'fallback'], 2, async (id) => variants[id]),
    'fallback',
  )
})

test('rejects unavailable and missing charm variants', async () => {
  const variants = {
    unavailable: { available: false, price: 200 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['unavailable', 'missing', 'fallback'], 2, async (id) => variants[id]),
    'fallback',
  )
})