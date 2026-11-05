import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  CLICK_ID_PARAMS,
  INTERNAL_HOST_SUFFIXES,
  attributionLabel,
  decodeAttribution,
  sanitizeAttribution,
} from './trackingContext.js'

const snippet = readFileSync(new URL('../../shopify/snippets/charme-cart-group.liquid', import.meta.url), 'utf8')
const linkRegion = snippet.slice(snippet.indexOf('  function syncEditorMarket('), snippet.indexOf('  var floatingButton;'))
const bridgeRegion = snippet.slice(snippet.indexOf('  function missingBridgeItems('), snippet.indexOf('  function groupedUpdates('))

const EDITOR = 'https://design.thecharmeedit.com/editor/?product=tote-olive-green&variant=123&cart_bridge=1&cart_url=%2Fcart#charme_layout=abc'
const INSTAGRAM_LANDING = {
  search: '?utm_source=Instagram&utm_medium=paid_social&utm_campaign=Spring&fbclid=SECRETCLICKVALUE',
  referrer: 'https://l.instagram.com/',
}

function storefront({ consent, search = '', referrer = '', pathname = '/products/custom-charm-phone-case', stored = {}, loadFeatures } = {}) {
  const store = new Map(Object.entries(stored))
  const state = { ...consent }
  const windowHandlers = {}
  const documentHandlers = {}
  const links = []
  const tasks = []
  let observe
  const privacy = consent && {
    analyticsProcessingAllowed: () => state.analytics === true,
    marketingAllowed: () => state.marketing === true,
  }
  const window = {
    Shopify: { country: 'GB', locale: 'en', currency: { active: 'GBP', rate: 1 }, shop: 'demo.myshopify.com', loadFeatures, ...(privacy ? { customerPrivacy: privacy } : {}) },
    location: { origin: 'https://thecharmeedit.com', search, pathname },
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    addEventListener: (name, handler, capture) => {
      windowHandlers[name] = handler
      if (['click', 'pointerdown', 'touchstart', 'auxclick', 'contextmenu'].includes(name)) assert.equal(capture, true)
    },
  }
  const document = {
    body: {},
    referrer,
    querySelectorAll: () => links,
    addEventListener: (name, handler) => { documentHandlers[name] = handler },
  }
  vm.runInNewContext(linkRegion, {
    URL, URLSearchParams, TextEncoder, btoa, window, document,
    console,
    MutationObserver: class { constructor(callback) { observe = callback } observe() {} },
    setTimeout: (callback) => tasks.push(callback),
  })
  return {
    state, store, windowHandlers, documentHandlers,
    // Shopify's privacy API loads asynchronously, so a page can start without it.
    enablePrivacy(consent) {
      Object.assign(state, consent)
      window.Shopify.customerPrivacy = {
        analyticsProcessingAllowed: () => state.analytics === true,
        marketingAllowed: () => state.marketing === true,
      }
    },
    add(attributes) {
      const link = {
        writes: 0,
        getAttribute: (name) => attributes[name],
        setAttribute: (name, value) => { link.writes++; attributes[name] = value },
      }
      links.push(link)
      return link
    },
    sync() { observe(); while (tasks.length) tasks.shift()() },
    press(link, type = 'pointerdown') { windowHandlers[type]({ target: { closest: () => link } }) },
  }
}

const params = (href) => new URL(href).searchParams

test('without a consent signal editor links carry no tracking parameters, and stale ones are removed', () => {
  const api = storefront({ ...INSTAGRAM_LANDING })
  const fresh = { href: EDITOR }
  const stale = { href: `${EDITOR.replace('#', '&ca=1&cm=1&attr=stale#')}` }
  api.add(fresh)
  api.add(stale)
  api.sync()
  assert.equal(params(fresh.href).get('shop'), 'demo.myshopify.com')
  assert.equal(params(stale.href).get('shop'), 'demo.myshopify.com')
  for (const key of ['ca', 'cm', 'attr']) assert.equal(params(fresh.href).has(key), false, `${key} is not added without a signal`)
  for (const key of ['ca', 'cm', 'attr']) assert.equal(params(stale.href).has(key), false, `stale ${key} is removed`)
  assert.equal(params(stale.href).get('product'), 'tote-olive-green')
  assert.equal(params(stale.href).get('cart_url'), '/cart')
  assert.equal(new URL(stale.href).hash, '#charme_layout=abc')
  assert.equal(api.store.size, 0, 'no campaign data is stored without consent')
})

test('analytics-only consent is forwarded, but campaign data never is', () => {
  const api = storefront({ consent: { analytics: true, marketing: false }, ...INSTAGRAM_LANDING, stored: { charme_attr: 'leftover' } })
  const attributes = { href: EDITOR, 'data-charme-edit-url': EDITOR }
  api.add(attributes)
  api.sync()
  for (const attribute of ['href', 'data-charme-edit-url']) {
    assert.equal(params(attributes[attribute]).get('ca'), '1')
    assert.equal(params(attributes[attribute]).get('cm'), '0')
    assert.equal(params(attributes[attribute]).has('attr'), false)
    assert.equal(new URL(attributes[attribute]).hash, '#charme_layout=abc')
  }
  assert.equal(api.store.get('charme_attr'), 'leftover', 'marketing consent is required to write')
})

test('declining analytics is recorded in the link', () => {
  const api = storefront({ consent: { analytics: false, marketing: true }, ...INSTAGRAM_LANDING })
  const attributes = { href: EDITOR }
  api.add(attributes)
  api.sync()
  assert.equal(params(attributes.href).get('ca'), '0')
  assert.equal(params(attributes.href).get('cm'), '0', 'marketing cannot be on while analytics is off')
  assert.equal(params(attributes.href).has('attr'), false)
  assert.equal(api.store.size, 0)
})

test('with marketing consent the landing campaign rides in the link as a bounded summary without click ids', () => {
  const api = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const attributes = { href: EDITOR }
  api.add(attributes)
  api.sync()
  assert.equal(params(attributes.href).get('ca'), '1')
  assert.equal(params(attributes.href).get('cm'), '1')
  const encoded = params(attributes.href).get('attr')
  const attribution = decodeAttribution(encoded)
  assert.deepEqual(attribution, {
    source: 'instagram', medium: 'paid_social', campaign: 'spring', clickIds: ['fbclid'],
    referrerHost: 'l.instagram.com', landingPath: '/products/custom-charm-phone-case',
  })
  assert.equal(Buffer.from(encoded, 'base64url').toString().includes('SECRETCLICKVALUE'), false)
  assert.equal(attributionLabel(attribution), 'instagram / paid_social')
  assert.ok(encoded.length < 2000)
})

test('the editor reads exactly the consent and attribution the storefront wrote', async () => {
  const { readTrackingContext } = await import('./trackingContext.js')
  const api = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const attributes = { href: EDITOR }
  api.add(attributes)
  api.sync()
  const context = readTrackingContext(new URL(attributes.href).search)
  assert.equal(context.analytics, true)
  assert.equal(context.marketing, true)
  assert.equal(context.attribution.source, 'instagram')
  const declined = storefront({ consent: { analytics: false, marketing: false } })
  const denied = { href: EDITOR }
  declined.add(denied)
  declined.sync()
  assert.equal(readTrackingContext(new URL(denied.href).search).analytics, false)
})

test('the pressed link is refreshed from the current consent before navigation', () => {
  const api = storefront({ consent: { analytics: false, marketing: false } })
  const attributes = { href: EDITOR }
  const link = api.add(attributes)
  api.sync()
  assert.equal(params(attributes.href).get('ca'), '0')
  api.state.analytics = true
  for (const type of ['pointerdown', 'touchstart', 'click', 'auxclick', 'contextmenu']) {
    attributes.href = EDITOR
    api.press(link, type)
    assert.equal(params(attributes.href).get('ca'), '1', type)
  }
})

test('capture-phase clicks refresh the source link before product handlers rebuild the destination', () => {
  const api = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const target = { href: EDITOR }
  const source = { href: EDITOR }
  const link = api.add(target)
  api.add(source)
  api.sync()
  api.state.analytics = false
  api.press(link, 'click')
  // The product handler copies its hidden source link and immediately navigates.
  target.href = source.href
  assert.equal(params(target.href).get('ca'), '0')
  assert.equal(params(target.href).get('cm'), '0')
  assert.equal(params(target.href).has('attr'), false)
  api.state.analytics = true
  api.press(link, 'click')
  target.href = source.href
  assert.equal(params(target.href).get('ca'), '1')
})

test('privacy API initialization refreshes links even after the page load event', () => {
  let ready
  const api = storefront({ loadFeatures(features, callback) {
    assert.equal(features[0].name, 'consent-tracking-api')
    assert.equal(features[0].version, '0.1')
    ready = callback
  } })
  const attributes = { href: EDITOR }
  api.add(attributes)
  api.enablePrivacy({ analytics: true, marketing: false })
  ready()
  assert.equal(params(attributes.href).get('ca'), '1')
  assert.equal(params(attributes.href).get('cm'), '0')
})

test('consent granted or withdrawn on the page updates links and the stored campaign', () => {
  const api = storefront({ consent: { analytics: false, marketing: false }, ...INSTAGRAM_LANDING })
  const attributes = { href: EDITOR }
  api.add(attributes)
  api.sync()
  assert.equal(params(attributes.href).get('ca'), '0')
  assert.equal(api.store.size, 0)

  Object.assign(api.state, { analytics: true, marketing: true })
  api.documentHandlers.visitorConsentCollected()
  assert.equal(params(attributes.href).get('ca'), '1')
  assert.equal(params(attributes.href).get('cm'), '1')
  assert.equal(decodeAttribution(params(attributes.href).get('attr')).source, 'instagram')
  assert.equal(api.store.size, 1)

  api.state.marketing = false
  api.documentHandlers.visitorConsentCollected()
  assert.equal(params(attributes.href).get('cm'), '0')
  assert.equal(params(attributes.href).has('attr'), false)
  assert.equal(api.store.size, 0, 'withdrawing marketing consent discards the stored campaign')
})

test('a privacy API that loads after the first sync still captures the landing campaign', () => {
  const ready = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  assert.equal(ready.store.size, 1, 'captured at load when the privacy API is ready')

  const late = storefront({ ...INSTAGRAM_LANDING })
  late.sync()
  assert.equal(late.store.size, 0, 'no privacy API yet, nothing captured and nothing sent')
  late.enablePrivacy({ analytics: true, marketing: true })
  late.windowHandlers.load()
  assert.equal(decodeAttribution(late.store.get('charme_attr')).source, 'instagram')
})

test('the last non-direct touch wins and internal hops never replace it', () => {
  const first = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const instagram = first.store.get('charme_attr')
  assert.ok(instagram)

  for (const referrer of ['', 'https://design.thecharmeedit.com/editor/?product=x', 'https://thecharmeedit.com/products/a', 'https://checkout.shopify.com/c/1', 'https://www.paypal.com/checkoutnow', 'https://charme-customizer.pages.dev/editor']) {
    const later = storefront({ consent: { analytics: true, marketing: true }, referrer, stored: { charme_attr: instagram } })
    assert.equal(later.store.get('charme_attr'), instagram, `kept across ${referrer || 'a direct visit'}`)
  }

  const google = storefront({ consent: { analytics: true, marketing: true }, referrer: 'https://www.google.com/', stored: { charme_attr: instagram } })
  assert.notEqual(google.store.get('charme_attr'), instagram)
  assert.equal(decodeAttribution(google.store.get('charme_attr')).referrerHost, 'google.com')
  assert.equal(attributionLabel(decodeAttribution(google.store.get('charme_attr'))), 'google / organic')
})

test('click ids alone identify an ad click and survive a round trip through the editor sanitizer', () => {
  const api = storefront({ consent: { analytics: true, marketing: true }, search: '?gclid=abc&fbclid=def&msclkid=ghi&unknown=1' })
  const touch = decodeAttribution(api.store.get('charme_attr'))
  assert.deepEqual(touch.clickIds, ['gclid', 'fbclid', 'msclkid'])
  assert.deepEqual(sanitizeAttribution(touch), touch)
  assert.equal(attributionLabel(touch), 'google / gclid')
})

test('oversized or hostile campaign values stay within what the editor accepts', () => {
  const huge = '漢字'.repeat(400)
  const search = `?utm_source=${encodeURIComponent(huge)}&utm_medium=${encodeURIComponent(huge)}&utm_campaign=${encodeURIComponent(huge)}&${CLICK_ID_PARAMS.map((name) => `${name}=1`).join('&')}`
  const api = storefront({
    consent: { analytics: true, marketing: true },
    search,
    pathname: `/products/${'a'.repeat(500)}`,
    referrer: `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.example/`,
  })
  const encoded = api.store.get('charme_attr')
  assert.ok(encoded.length <= 2000, `attr is ${encoded.length} characters`)
  const attribution = decodeAttribution(encoded)
  assert.ok(attribution, 'the editor still accepts it')
  assert.equal(attribution.source.length, 60)
  assert.equal(attribution.campaign.length, 100)
  assert.equal(attribution.clickIds.length, CLICK_ID_PARAMS.length)
  assert.ok(attribution.landingPath.length <= 120)
})

test('syncing is idempotent and never touches unrelated links', () => {
  const api = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const editor = { href: EDITOR }
  const editorLink = api.add(editor)
  const unrelated = ['/cart', 'https://example.com/editor?x=1', 'https://charme-customizer.pages.dev.evil.example/editor', 'https://charme-customizer.pages.dev/admin', 'https://design.thecharmeedit.com/studio']
    .map((href) => ({ link: api.add({ href }), href }))
  api.sync()
  const settled = editor.href
  const writes = editorLink.writes
  for (let round = 0; round < 3; round++) api.sync()
  assert.equal(editor.href, settled)
  assert.equal(editorLink.writes, writes, 'no rewrite once the link already carries the current state')
  for (const { link, href } of unrelated) assert.equal(link.writes, 0, href)
})

test('a store-relative /editor path is not a designer link', () => {
  const api = storefront({ consent: { analytics: true, marketing: true }, ...INSTAGRAM_LANDING })
  const relative = { href: '/editor?product=x' }
  api.add(relative)
  api.sync()
  assert.equal(relative.href, '/editor?product=x', 'a relative same-origin editor path is not a designer link')
})

test('the snippet keeps the same click-id and internal-host lists as the editor', () => {
  const list = (name) => [...vm.runInNewContext(snippet.match(new RegExp(`var ${name} = (\\[[^\\]]*\\]);`))[1])]
  assert.deepEqual(list('CLICK_ID_PARAMS'), CLICK_ID_PARAMS)
  assert.deepEqual(list('INTERNAL_HOSTS'), INTERNAL_HOST_SUFFIXES)
})

function cartBridge({ analytics = { sid: 'session-12345678' }, privacy = { analyticsProcessingAllowed: () => true }, mode = 'ok', beaconFails = false, itemCount } = {}) {
  const items = [
    { id: 123, quantity: 1, properties: { _design_token: 'design-a' } },
    { id: 456, quantity: 2, properties: { _design_token: 'design-a', _role: 'charm' } },
    { id: 789, quantity: 1, properties: { _design_token: 'design-b' } },
  ]
  for (let index = 0; index < (itemCount || 0); index++) items.push({ id: 1000 + index, quantity: 1, properties: { _design_token: `bulk-${index}` } })
  const cart = []
  const beacons = []
  const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) })
  const context = {
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { hash: '#charme-cart=encoded', pathname: '/cart', search: '' },
    history: { replaceState() { context.location.hash = '' } },
    window: { addEventListener() {}, location: { reload() {} }, Shopify: { routes: { root: '/en-us/' }, ...(privacy ? { customerPrivacy: privacy } : {}) } },
    console: { error() {} },
    decodeBridgePayload: () => ({ items, ...(analytics === null ? {} : { analytics }) }),
    bridgeItems: (payload) => payload.items,
    fetch: async (url, options) => {
      if (url.startsWith('https://')) {
        beacons.push({ url, options })
        if (beaconFails) throw new Error('offline')
        return response({ ok: true })
      }
      assert.ok(url.startsWith('/en-us/'))
      if (url.endsWith('/add.js')) {
        if (mode === 'rejected') return response({ description: 'This charm is sold out.' }, 422)
        cart.push(...JSON.parse(options.body).items)
        return response({ items: [] })
      }
      return response({ items: cart })
    },
  }
  vm.createContext(context)
  vm.runInContext(bridgeRegion, context)
  context.showBridgeStatus = () => {}
  return { context, beacons }
}

test('a verified cart confirms the designer session once with unique design tokens only', async () => {
  const api = cartBridge()
  await api.context.applyCartBridge()
  assert.equal(api.beacons.length, 1)
  const [{ url, options }] = api.beacons
  assert.equal(url, 'https://design.thecharmeedit.com/api/analytics/confirm')
  assert.equal(options.method, 'POST')
  assert.equal(options.keepalive, true)
  assert.equal(options.credentials, 'omit')
  assert.equal(options.headers['Content-Type'], 'text/plain;charset=UTF-8', 'a simple request: no CORS preflight')
  assert.deepEqual(JSON.parse(options.body), { sessionId: 'session-12345678', designTokens: ['design-a', 'design-b'] })
})

test('the confirmation waits for the cart to be verified', async () => {
  const api = cartBridge({ mode: 'rejected' })
  await api.context.applyCartBridge()
  assert.equal(api.beacons.length, 0, 'a rejected add never reports a confirmed cart')
})

test('nothing is sent without a valid session, current analytics consent, or design tokens', async () => {
  const cases = {
    'no analytics in the payload': { analytics: null },
    'empty analytics': { analytics: {} },
    'short session id': { analytics: { sid: 'short' } },
    'hostile session id': { analytics: { sid: '<img src=x onerror=alert(1)>' } },
    'numeric session id': { analytics: { sid: 123456789012 } },
    'no privacy API': { privacy: null },
    'analytics declined': { privacy: { analyticsProcessingAllowed: () => false } },
    'privacy API throws': { privacy: { analyticsProcessingAllowed: () => { throw new Error('boom') } } },
  }
  for (const [name, options] of Object.entries(cases)) {
    const api = cartBridge(options)
    await api.context.applyCartBridge()
    assert.equal(api.beacons.length, 0, name)
  }
})

test('a failing or throwing beacon never affects the cart', async () => {
  const failing = cartBridge({ beaconFails: true })
  await failing.context.applyCartBridge()
  assert.equal(failing.beacons.length, 1)
  assert.equal(failing.context.location.hash, '', 'the payload is still cleared after a failed beacon')

  const throwing = cartBridge()
  throwing.context.fetch = (url) => {
    if (String(url).startsWith('https://')) throw new Error('synchronous failure')
    return cartBridge().context.fetch(url)
  }
  await assert.doesNotReject(() => throwing.context.applyCartBridge())
})

test('the beacon reports at most 20 designs', async () => {
  const api = cartBridge({ itemCount: 80 })
  await api.context.applyCartBridge()
  const { designTokens } = JSON.parse(api.beacons[0].options.body)
  assert.equal(designTokens.length, 20)
  assert.equal(new Set(designTokens).size, 20)
})
