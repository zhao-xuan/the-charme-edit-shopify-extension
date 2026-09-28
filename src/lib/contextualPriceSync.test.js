test('confirmed market prices do not show the recurring decoration estimate notice', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('  const priceNotice ='), source.indexOf('  const priceBar ='))
  for (const currency of ['GBP', 'AUD', 'USD']) {
    const notice = (failed, price) => vm.runInNewContext(`${code}\npriceNotice`, {
      priceLookupFailed: failed, livePresentmentCasePrice: price, activeCurrency: () => currency, t: key => key,
    })
    assert.equal(notice(false, { amount: 32 }), '')
    assert.equal(notice(true, null), 'price.marketUnavailable')
    assert.equal(notice(false, null), 'price.marketLoading')
  }
})
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { fetchContextualPrice, marketEstimateContext } from './contextualPrice.js'
import { onRequestGet } from '../../functions/api/shopify/contextual-price.js'

const liquid = readFileSync(new URL('../../shopify/sections/charme-product-ordering.liquid', import.meta.url), 'utf8')
const script = liquid.slice(liquid.indexOf('    var priceCache'), liquid.indexOf('    function syncCarouselSlides'))
const clickScript = liquid.slice(liquid.indexOf('    var navigatingTarget'), liquid.indexOf('    new MutationObserver'))

function setupMarketLinks(currency = 'USD', country = 'US', rate = 1.35) {
  const source = readFileSync(new URL('../../shopify/snippets/charme-cart-group.liquid', import.meta.url), 'utf8')
  const marketScript = source.slice(source.indexOf('  function syncEditorMarket('), source.indexOf('  var floatingButton;'))
  const links = []
  const events = {}
  const tasks = []
  let observe
  const context = {
    URL,
    window: { Shopify: { country, locale: 'en', currency: { active: currency, rate } }, location: { origin: 'https://thecharmeedit.com' }, addEventListener: (name, callback) => { events[name] = callback } },
    document: { body: {}, querySelectorAll: () => links, addEventListener: (name, callback) => { events[name] = callback } },
    MutationObserver: class { constructor(callback) { observe = callback } observe() {} },
    setTimeout: (callback) => tasks.push(callback),
  }
  vm.runInNewContext(marketScript, context)
  return {
    context, events,
    add(attributes) {
      const link = { getAttribute: (name) => attributes[name], setAttribute: (name, value) => { attributes[name] = value } }
      links.push(link)
      return link
    },
    mutate() { observe(); while (tasks.length) tasks.shift()() },
  }
}

test('global market handoff corrects stale links for every product kind and preserves design data', () => {
  for (const [currency, country, rate] of [['USD', 'US', 1.35], ['EUR', 'DE', 1.18], ['AWG', 'AW', 2.41], ['GBP', 'GB', 1]]) {
    const api = setupMarketLinks(currency, country, rate)
    for (const product of ['tote-cream-white', 'tote-deep-navy', 'tote-olive-green', 'frame-5x7', 'iphone-18-pro', 'pixel-11']) {
      const original = new URL(`https://charme-customizer.pages.dev/editor/?product=${product}&currency=GBP&currency_rate=1&country=GB&variant=123&cart_bridge=1&cart_url=https%3A%2F%2Fthecharmeedit.com%2Fcart&return_to=%2Fproducts%2Fexample#charme_layout=abc&charme_edit_token=test`)
      const attributes = { href: original.href, 'data-charme-edit-url': original.href }
      api.add(attributes)
      api.mutate()
      for (const attribute of ['href', 'data-charme-edit-url']) {
        const result = new URL(attributes[attribute])
        assert.equal(result.searchParams.get('currency'), currency)
        assert.equal(result.searchParams.get('country'), country)
        assert.equal(Number(result.searchParams.get('currency_rate')), rate)
        for (const key of ['product', 'variant', 'cart_bridge', 'cart_url', 'return_to']) assert.equal(result.searchParams.get(key), original.searchParams.get(key))
        assert.equal(result.hash, original.hash)
      }
    }
  }
})

test('market handoff refreshes rewritten links on native and modified navigation without intercepting it', () => {
  const api = setupMarketLinks()
  const attributes = {}
  const link = api.add(attributes)
  for (const event of ['pointerdown', 'touchstart', 'click', 'auxclick', 'contextmenu', 'pageshow']) {
    attributes.href = 'https://charme-customizer.pages.dev/editor?product=frame-5x7&currency=GBP'
    api.events[event]({ target: { closest: () => link }, ctrlKey: true, preventDefault: () => assert.fail('Must preserve native navigation') })
    assert.equal(new URL(attributes.href).searchParams.get('currency'), 'USD')
  }
})

test('market handoff does not retain stale exchange rates or rewrite unrelated URLs', () => {
  for (const rate of [undefined, NaN, Infinity, 0, -1]) {
    const api = setupMarketLinks('EUR', 'DE', rate)
    api.context.window.Shopify.currency.rate = rate
    const attributes = { href: 'https://charme-customizer.pages.dev/editor?currency=GBP&currency_rate=1' }
    api.add(attributes)
    api.mutate()
    assert.equal(new URL(attributes.href).searchParams.has('currency_rate'), false)
  }
  const api = setupMarketLinks()
  for (const href of ['https://example.com/editor', 'https://charme-customizer.pages.dev/admin', '/cart', 'https://charme-customizer.pages.dev.evil.example/editor']) {
    const attributes = { href }
    api.add(attributes)
    api.mutate()
    assert.equal(attributes.href, href)
  }
})

test('editor initializes the Shopify market and rate from the launch URL instead of forcing GBP', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const initialization = app.slice(app.indexOf('function configureEditorCurrency()'), app.indexOf('const editorCart ='))
  for (const [country, currency, rate] of [['US', 'USD', 1.35], ['AW', 'AWG', 2.4188688], ['GB', 'GBP', 1]]) {
    const window = { location: { search: `?country=${country}&currency=${currency}&currency_rate=${rate}` } }
    vm.runInNewContext(initialization, { window, URLSearchParams })
    assert.equal(window.CharmeConfig.country, country)
    assert.equal(window.CharmeConfig.currency.active, currency)
    assert.equal(window.CharmeConfig.currency.rate, rate)
    assert.equal(window.CharmeConfig.shopifyCurrency.rate, rate)
  }
})

test('Shopify exchange rates survive rounded case quotes and invalid or mismatched rates are ignored', () => {
  const quote = { amount: 37, currency: 'USD', baseAmount: 26.99, baseCurrency: 'GBP' }
  assert.equal(marketEstimateContext(quote, { active: 'USD', rate: 1.35 }).rate, 1.35)
  for (const context of [{ active: 'EUR', rate: 1.2 }, { active: 'USD', rate: Infinity }, { active: 'USD', rate: -1 }]) {
    assert.equal(marketEstimateContext(quote, context).rate, 37 / 26.99)
  }
  assert.equal(marketEstimateContext({ amount: 26.99, currency: 'GBP' }, { active: 'GBP', rate: 2 }).rate, 1)
})

function setup(fetch, timers = {}) {
  const input = { value: '123456789' }
  const root = { dataset: { charmeMarketCountry: 'US', charmeMarketCurrency: 'USD' } }
  const target = { href: 'https://charme-customizer.pages.dev/editor?currency=USD&case_price=12' }
  const label = { textContent: 'Start designing' }
  const attributes = new Map()
  target.querySelector = () => label
  target.setAttribute = (name, value) => attributes.set(name, value)
  target.removeAttribute = (name) => attributes.delete(name)
  target.getAttribute = (name) => attributes.get(name) ?? null
  const source = { href: 'https://charme-customizer.pages.dev/editor?product=iphone-18-pro-max&case=white&gel=glitter' }
  root.contains = (node) => node === target || node === source
  source.querySelector = () => null
  source.setAttribute = () => {}
  source.removeAttribute = () => {}
  root.querySelector = (selector) => selector === '[data-charme-own-design]' ? target : selector === '.add-charms-here-button' ? source : input
  const warnings = []
  const navigations = []
  let clickHandler
  const events = {}
  const context = { fetch, URL, AbortController, setTimeout, clearTimeout, ...timers, rootSelector: '#ordering', console: { warn: (...args) => warnings.push(args) }, document: { querySelector: (selector) => selector === '#ordering' ? root : { value: '56665206292858' }, addEventListener: (event, handler) => { clickHandler = handler } }, window: { location: { href: 'https://thecharmeedit.com/products/custom-charm-phone-case', origin: 'https://thecharmeedit.com', assign: (url) => navigations.push(url) }, Shopify: { routes: { root: '/en-us/' } } } }
  context.window.addEventListener = (name, handler) => { events[name] = handler }
  vm.runInNewContext(script, context)
  vm.runInNewContext(clickScript, context)
  return { input, root, target, source, label, events, warnings, navigations, window: context.window, sync: () => context.setPresentmentCasePrice(root, target), click: (event = {}) => clickHandler({ target: { closest: () => target }, button: 0, preventDefault() {}, ...event }) }
}

test('start designing gives immediate feedback, deduplicates clicks and resets on back navigation', () => {
  const api = setup(() => { throw new Error('Click must not fetch a price') })
  api.click()
  assert.equal(api.label.textContent, 'Opening designer...')
  assert.equal(api.target.getAttribute('aria-busy'), 'true')
  api.click()
  assert.equal(api.navigations.length, 1)
  api.events.pageshow({ persisted: true })
  assert.equal(api.label.textContent, 'Start designing')
  assert.equal(api.target.getAttribute('aria-busy'), null)
  api.click()
  assert.equal(api.navigations.length, 2)
})

test('unowned links keep native navigation and rejected navigation resets the button', () => {
  const api = setup(() => { throw new Error('Click must not fetch a price') })
  api.root.contains = () => false
  api.click({ preventDefault() { assert.fail('Unowned links must remain native') } })
  assert.equal(api.navigations.length, 0)
  api.root.contains = () => true
  api.window.location.assign = () => { throw new Error('Navigation rejected') }
  assert.throws(() => api.click(), /Navigation rejected/)
  assert.equal(api.label.textContent, 'Start designing')
  assert.equal(api.target.getAttribute('aria-busy'), null)
})

test('recommended-product forms cannot replace the selected custom case variant', async () => {
  const requested = []
  const api = setup(async (url) => {
    requested.push(new URL(url).pathname)
    return { ok: true, json: async () => ({ id: 123456789, price: 3700 }) }
  })
  const selector = api.root.querySelector
  api.root.querySelector = (value) => {
    if (value.includes('[name="id"]')) assert.equal(value, '.charme-order-path--standard form[action*="/cart/add"] [name="id"]')
    return selector(value)
  }
  await api.sync()
  assert.deepEqual(requested, ['/en-us/variants/123456789.js'])
})

test('start designing navigates immediately while pricing is stalled and keeps the latest selection', async () => {
  let calls = 0
  const api = setup(() => { calls += 1; return new Promise(() => {}) }, {
    setTimeout: (callback) => setTimeout(callback, 5),
  })
  const pending = api.sync()
  api.input.value = '57172232503674'
  api.source.href = 'https://charme-customizer.pages.dev/editor?product=iphone-18-pro-max&case=black&gel=black'
  api.click()
  assert.equal(calls, 1)
  assert.equal(api.navigations.length, 1)
  const destination = new URL(api.navigations[0])
  assert.equal(destination.searchParams.get('product'), 'iphone-18-pro-max')
  assert.equal(destination.searchParams.get('gel'), 'black')
  assert.equal(destination.searchParams.get('variant'), '57172232503674')
  assert.equal(destination.searchParams.get('country'), 'US')
  assert.equal(destination.searchParams.get('currency'), 'USD')
  assert.equal(destination.searchParams.has('case_price'), false)
  assert.equal(destination.searchParams.get('cart_url'), 'https://thecharmeedit.com/cart')
  assert.equal(destination.searchParams.get('return_to'), api.window.location.href)
  await pending
})

test('modified clicks and already-handled clicks retain native link behavior', () => {
  const api = setup(() => { throw new Error('Unexpected fetch') })
  for (const event of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    api.click({ ...event, preventDefault() { assert.fail('Native navigation should not be prevented') } })
  }
  assert.equal(api.navigations.length, 0)
})

test('Aruba prices use the Shopify market currency and preserve it on navigation', async () => {
  const api = setup(async () => ({ ok: true, json: async () => ({ id: 123456789, price: 6600 }) }))
  api.root.dataset.charmeMarketCountry = 'AW'
  api.root.dataset.charmeMarketCurrency = 'AWG'
  api.target.href = 'https://charme-customizer.pages.dev/editor?variant=123456789&country=AW'
  await api.sync()
  api.click()
  const destination = new URL(api.navigations[0])
  assert.equal(destination.searchParams.get('case_price'), '66')
  assert.equal(destination.searchParams.get('country'), 'AW')
  assert.equal(destination.searchParams.get('currency'), 'AWG')
})

test('the secondary design link also forwards Shopify country currency and exchange rate without waiting', () => {
  const api = setup(() => { assert.fail('Click should not request a price') })
  api.root.dataset.charmeMarketCountry = 'US'
  api.window.Shopify.currency = { active: 'USD', rate: '1.35' }
  api.click({ target: { closest(selector) {
    assert.ok(selector.includes('.add-charms-here-button'))
    return api.source
  } } })
  const destination = new URL(api.navigations[0])
  assert.equal(destination.searchParams.get('currency'), 'USD')
  assert.equal(destination.searchParams.get('currency_rate'), '1.35')
  assert.equal(destination.searchParams.get('country'), 'US')
  assert.equal(destination.searchParams.get('variant'), api.input.value)
  assert.equal(api.source.href, api.target.href)
})

test('malformed or wrong-variant Shopify prices never enter the editor URL', async () => {
  for (const variant of [{ id: 987654321, price: 3700 }, { id: 123456789, price: 'invalid' }, { id: 123456789, price: null }]) {
    const api = setup(async () => ({ ok: true, json: async () => variant }))
    await api.sync()
    assert.equal(new URL(api.target.href).searchParams.has('case_price'), false)
  }
})

test('product page uses Shopify same-origin localized variant prices without Pages fetches', async () => {
  const api = setup(async (url) => {
    const requestUrl = new URL(url)
    assert.equal(requestUrl.origin, 'https://thecharmeedit.com')
    assert.equal(requestUrl.pathname, '/en-us/variants/123456789.js')
    return { ok: true, json: async () => ({ id: 123456789, price: 3700 }) }
  })
  await api.sync()
  assert.equal(new URL(api.target.href).searchParams.get('case_price'), '37')
  assert.equal(api.warnings.length, 0)
})

test('product page deduplicates concurrent and repeated market price syncs', async () => {
  let calls = 0
  const api = setup(async () => { calls += 1; return { ok: true, json: async () => ({ id: 123456789, price: 3700 }) } })
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
    if (url.includes('987654321')) resolve({ ok: true, json: async () => ({ id: 987654321, price: 4000 }) })
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
  const api = setup(async () => {
    calls += 1
    return { ok: true, json: async () => ({ id: 123456789, price: api.root.dataset.charmeMarketCountry === 'US' ? 3700 : 3000 }) }
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