import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asShopifyVariantId,
  chargeLineVariantId,
  decorationVariantId,
  fetchContextualVariantPrices,
  hasUnavailablePrices,
  productVariantId,
} from './marketPrices.js'
import { onRequestPost } from '../../functions/api/shopify/contextual-prices.js'
import { onRequestGet as catalogResponse } from '../../functions/api/catalog.js'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('product quotes resolve exactly the cart variant for each product kind and finish', () => {
  const source = readFileSync(new URL('../../shopify/widget/shopifyCart.js', import.meta.url), 'utf8')
  const cartResolve = vm.runInNewContext(`${source.slice(source.indexOf('function resolveProductVariant('), source.indexOf('function cartVariantMap('))}\nresolveProductVariant`)
  const base = { 'phone:glitter': '12345678901234', phone: '23456789012345', tote: '34567890123456', frame: '45678901234567', 'other:black': '56789012345678' }
  const configured = { 'phone:glitter': '67890123456789', 'phone:white': '78901234567890' }
  for (const id of ['phone', 'tote', 'frame', 'custom']) {
    for (const gel of ['glitter', 'white', 'black', undefined]) {
      for (const shopifyVariantId of [undefined, '89012345678901']) {
        const product = { id, shopifyVariantId }
        const expected = cartResolve({ products: { ...base, ...configured } }, { product: { ...product, colorId: 'white', gelId: gel } })
        assert.equal(productVariantId(product, 'white', gel, { products: configured }, base), expected)
      }
    }
  }
})

test('price failure screen detects missing visible prices even before placing any charm', () => {
  const input = {
    productFailed: false, decorationStatus: 'ready',
    items: [{ id: 'letter', shopifyVariantId: '12345678901234' }],
    pricingGroups: [], prices: {}, variantMap: {},
  }
  assert.equal(hasUnavailablePrices(input), true)
  assert.equal(hasUnavailablePrices({ ...input, decorationStatus: 'loading' }), false)
  assert.equal(hasUnavailablePrices({ ...input, prices: { '12345678901234': 0 } }), false)
  assert.equal(hasUnavailablePrices({ ...input, decorationStatus: 'error' }), true)
  assert.equal(hasUnavailablePrices({ ...input, productFailed: true, decorationStatus: 'loading' }), true)
  assert.equal(hasUnavailablePrices({ ...input, items: [{ id: 'unmapped' }] }), true)
  assert.equal(hasUnavailablePrices({
    ...input, items: [{ id: 'stone', collection: 'Stones' }],
    pricingGroups: [{ id: 'stones', collection: 'Stones', enabled: true, quantity: 3, price: 2, shopifyVariantId: '23456789012345' }],
    prices: { '23456789012345': 2 },
  }), false)
})

test('production catalogue failures retry and expose an explicit recovery state', async () => {
  const source = readFileSync(new URL('./remoteCatalog.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replaceAll('export ', '')
  let calls = 0
  const api = vm.runInNewContext(`${source}\n({loadRemoteCatalog, remoteCatalogFailed})`, {
    API_BASE: 'https://api.example', PROD_API_BASE: 'https://api.example',
    location: { hostname: 'charme-customizer.pages.dev' },
    fetch: () => {},
    fetchPriceJson: async () => { calls++; throw new Error('catalog_http_502') },
    setTimeout: (callback) => callback(),
    console: { warn: () => {} },
  })
  await api.loadRemoteCatalog()
  assert.equal(calls, 3)
  assert.equal(api.remoteCatalogFailed(), true)
})

test('Shopify catalogue errors are not disguised as a successful empty catalogue', async (context) => {
  context.mock.method(console, 'warn', () => {})
  context.mock.method(globalThis, 'fetch', async () => Response.json({ errors: [{ message: 'Shopify temporarily unavailable' }] }))
  const response = await catalogResponse({ env: { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' } })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'Could not load the Shopify catalogue' })
})

test('resolves the same mapped decoration and pricing-group variants used by the cart', () => {
  const variantMap = {
    charms: { letterA: 'gid://shopify/ProductVariant/12345678901234' },
    charmPricingGroups: { stones: 23456789012345 },
  }
  assert.equal(decorationVariantId({ charmId: 'letterA' }, variantMap), '12345678901234')
  assert.equal(chargeLineVariantId({
    kind: 'group',
    rule: { id: 'stones', shopifyVariantId: '34567890123456' },
  }, variantMap), '23456789012345')
  assert.equal(asShopifyVariantId('not-a-variant'), null)
})

test('decoration prices bypass browser cache and recover from a transient network failure', async () => {
  let calls = 0
  const prices = await fetchContextualVariantPrices({
    apiBase: 'https://api.example', country: 'GB', currency: 'GBP', variantIds: ['12345678901234'],
    fetchImpl: async (url, options) => {
      assert.equal(options.cache, 'no-store')
      calls++
      if (calls === 1) throw new TypeError('Failed to fetch')
      return Response.json({ prices: { '12345678901234': { amount: 1.25, currency: 'GBP' } } })
    },
  })
  assert.equal(calls, 2)
  assert.equal(prices['12345678901234'], 1.25)
})

test('stalled decoration requests time out after two attempts, and cancelled requests never retry', async () => {
  const input = {
    apiBase: 'https://api.example', country: 'GB', currency: 'GBP', variantIds: ['12345678901234'],
    timeoutMs: 5,
  }
  let calls = 0
  await assert.rejects(fetchContextualVariantPrices({
    ...input, fetchImpl: () => { calls++; return new Promise(() => {}) },
  }), /timeout/)
  assert.equal(calls, 2)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchContextualVariantPrices({
    ...input, signal: controller.signal, fetchImpl: () => assert.fail('Cancelled request must not fetch'),
  }), /cancelled/)
})

test('decoration price batching covers more than 250 variants without dropping any prices', async () => {
  const ids = Array.from({ length: 260 }, (_, index) => String(12345678901234 + index))
  const sizes = []
  const prices = await fetchContextualVariantPrices({
    apiBase: 'https://api.example', country: 'US', currency: 'USD', variantIds: ids,
    fetchImpl: async (url, options) => {
      const { variantIds } = JSON.parse(options.body)
      sizes.push(variantIds.length)
      return Response.json({ prices: Object.fromEntries(variantIds.map(id => [id, { amount: 2.34, currency: 'USD' }])) })
    },
  })
  assert.deepEqual(sizes, [250, 10])
  assert.equal(Object.keys(prices).length, 260)
})

test('Shopify batch prices preserve free decorations and reject malformed variant lists', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ data: {
    nodes: [{ id: 'gid://shopify/ProductVariant/12345678901234', contextualPricing: { price: { amount: '0.00', currencyCode: 'GBP' } } }],
  } }))
  const env = { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  const request = (variantIds) => new Request('https://api.example/api/shopify/contextual-prices', {
    method: 'POST', body: JSON.stringify({ country: 'GB', variantIds }),
  })
  const response = await onRequestPost({ request: request(['12345678901234']), env })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { prices: { '12345678901234': { amount: 0, currency: 'GBP' } } })
  assert.equal((await onRequestPost({ request: request('12345678901234'), env })).status, 400)
})

test('loads contextual prices in batches and rejects prices in the wrong currency', async () => {
  const requests = []
  const prices = await fetchContextualVariantPrices({
    apiBase: 'https://shop.example',
    country: 'JP',
    currency: 'JPY',
    variantIds: ['12345678901234', '23456789012345', '12345678901234'],
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) })
      return {
        ok: true,
        json: async () => ({
          prices: {
            '12345678901234': { amount: '300', currency: 'JPY' },
            '23456789012345': { amount: '500', currency: 'JPY' },
          },
        }),
      }
    },
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://shop.example/api/shopify/contextual-prices')
  assert.deepEqual(requests[0].body, { country: 'JP', variantIds: ['12345678901234', '23456789012345'] })
  assert.deepEqual(prices, { '12345678901234': 300, '23456789012345': 500 })

  await assert.rejects(fetchContextualVariantPrices({
    apiBase: 'https://shop.example',
    country: 'JP',
    currency: 'JPY',
    variantIds: ['12345678901234'],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        prices: { '12345678901234': { amount: '2.00', currency: 'GBP' } },
      }),
    }),
  }), (error) => error.message === 'market_price_currency_mismatch' && error.actualCurrency === 'GBP')
})

test('a stale link or cart currency is replaced by the currency Shopify returns for the country', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /RESOLVED_MARKET_CURRENCY\.get\(country\)/)
  assert.match(source, /adoptMarketCurrency\(country, expectedCurrency/)
  assert.match(source, /adoptMarketCurrency\(country, currency, error\.actualCurrency\)/)
  assert.match(source, /adoptMarketCurrency\(marketContext\.country, marketContext\.currency, error\.actualCurrency\)/)
  const cartLinks = readFileSync(new URL('../../shopify/snippets/cart-products.liquid', import.meta.url), 'utf8')
  for (const link of cartLinks.match(/https:\/\/charme-customizer\.pages\.dev\/editor\?[^\n]+/g)) {
    assert.match(link, /&country=\{\{ charme_country/)
  }
})
