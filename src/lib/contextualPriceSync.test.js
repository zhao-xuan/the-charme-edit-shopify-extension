import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { fetchContextualPrice, marketEstimateContext } from './contextualPrice.js'
import { onRequestGet } from '../../functions/api/shopify/contextual-price.js'

const liquid = readFileSync(new URL('../../shopify/sections/charme-product-ordering.liquid', import.meta.url), 'utf8')
const script = liquid.slice(liquid.indexOf('    var priceCache'), liquid.indexOf('    function syncDesignLink'))

function setup(fetch, timers = {}) {
  const input = { value: '123456789' }
  const root = { dataset: { charmeMarketCountry: 'US' } }
  const target = { href: 'https://charme-customizer.pages.dev/editor?currency=USD&case_price=12' }
  const warnings = []
  const context = { fetch, URL, AbortController, setTimeout, clearTimeout, ...timers, console: { warn: (...args) => warnings.push(args) }, document: { querySelector: () => input }, window: { location: { href: target.href } } }
  vm.runInNewContext(script, context)
  return { input, root, target, warnings, sync: () => context.setPresentmentCasePrice(root, target) }
}

test('product page deduplicates concurrent and repeated market price syncs', async () => {
  let calls = 0
  const api = setup(async () => { calls += 1; return { ok: true, json: async () => ({ amount: 37, currency: 'USD' }) } })
  await Promise.all([api.sync(), api.sync(), api.sync()])
  await api.sync()
  assert.equal(calls, 1)
  assert.equal(new URL(api.target.href).searchParams.get('case_price'), '37')
})

test('final price failure retries once, warns once, and removes stale price', async () => {
  let calls = 0
  const api = setup(async () => { calls += 1; throw new TypeError('Load failed') })
  await api.sync()
  await api.sync()
  assert.equal(calls, 2)
  assert.equal(api.warnings.length, 1)
  assert.equal(new URL(api.target.href).searchParams.has('case_price'), false)
})

test('obsolete market requests are aborted and cannot overwrite the new price', async () => {
  const api = setup((url, { signal }) => new Promise((resolve, reject) => {
    if (url.includes('987654321')) resolve({ ok: true, json: async () => ({ amount: 40, currency: 'USD' }) })
    else signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const old = api.sync()
  api.input.value = '987654321'
  await api.sync()
  await old
  assert.equal(new URL(api.target.href).searchParams.get('case_price'), '40')
  assert.equal(api.warnings.length, 0)
})

test('editor prices require a verified base currency for market estimates', () => {
  assert.equal(marketEstimateContext({ amount: 37, currency: 'USD' }), null)
  assert.equal(marketEstimateContext({ amount: Infinity, currency: 'USD', baseAmount: 27, baseCurrency: 'GBP' }), null)
  assert.deepEqual(marketEstimateContext({ amount: 37, currency: 'USD', baseAmount: 26.99, baseCurrency: 'GBP' }), { base: 'GBP', active: 'USD', rate: 37 / 26.99 })
})

test('editor timeout is bounded even when fetch never settles and retries only once', async () => {
  let calls = 0
  await assert.rejects(fetchContextualPrice('https://example.test', {
    timeoutMs: 5,
    fetchImpl: () => { calls += 1; return new Promise(() => {}) },
  }), /timeout/)
  assert.equal(calls, 2)
})

test('editor recovers from one transient network error', async () => {
  let calls = 0
  const price = await fetchContextualPrice('https://example.test', {
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) throw new TypeError('Load failed')
      return { ok: true, json: async () => ({ amount: 37, currency: 'USD', baseAmount: 26.99, baseCurrency: 'GBP' }) }
    },
  })
  assert.equal(price.amount, 37)
  assert.equal(calls, 2)
})

test('product page times out stalled fetches and preserves the editor destination', async () => {
  let calls = 0
  const api = setup(() => { calls += 1; return new Promise(() => {}) }, {
    setTimeout: (callback) => setTimeout(callback, 5),
  })
  await api.sync()
  assert.equal(calls, 2)
  assert.equal(api.warnings.length, 1)
  assert.equal(new URL(api.target.href).pathname, '/editor')
  assert.equal(new URL(api.target.href).searchParams.has('case_price'), false)
})

test('product page caches each country independently', async () => {
  let calls = 0
  const api = setup(async (url) => {
    calls += 1
    return { ok: true, json: async () => ({ amount: url.includes('country=US') ? 37 : 30, currency: 'USD' }) }
  })
  await api.sync()
  api.root.dataset.charmeMarketCountry = 'CA'
  await api.sync()
  assert.equal(new URL(api.target.href).searchParams.get('case_price'), '30')
  api.root.dataset.charmeMarketCountry = 'US'
  await api.sync()
  assert.equal(new URL(api.target.href).searchParams.get('case_price'), '37')
  assert.equal(calls, 2)
})

test('contextual price endpoint supplies Shopify base currency and amount', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body)
    assert.deepEqual(body.variables, { id: 'gid://shopify/ProductVariant/123456789', country: 'US' })
    assert.match(body.query, /shop\s*\{\s*currencyCode\s*\}/)
    return Response.json({ data: {
      shop: { currencyCode: 'GBP' },
      productVariant: { price: '26.99', contextualPricing: { price: { amount: '37.00', currencyCode: 'USD' } } },
    } })
  })
  const response = await onRequestGet({
    request: new Request('https://example.test/api/shopify/contextual-price?variant=123456789&country=US'),
    env: { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { amount: 37, currency: 'USD', baseAmount: 26.99, baseCurrency: 'GBP' })
})