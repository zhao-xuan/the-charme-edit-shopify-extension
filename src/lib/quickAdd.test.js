import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../shopify/assets/quick-add.js', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('export class QuickAddComponent'), source.indexOf("if (!customElements.get('quick-add-component'))")).replace('export class', 'class')
function harness(fetchImpl) {
  const warnings = []
  const navigations = []
  let opens = 0
  class Component {
    isConnected = true
    url = 'https://thecharmeedit.com/products/first'
    attributes = new Map()
    connectedCallback() {}
    disconnectedCallback() {}
    closest() { return { getProductCardLink: () => ({ href: this.url }), getSelectedVariantId: () => null } }
    setAttribute(key, value) { this.attributes.set(key, value) }
    removeAttribute(key) { this.attributes.delete(key) }
    toggleAttribute() {}
  }
  class QuickAddDialog {
    addEventListener() {}
    showDialog() { opens++ }
  }
  const timers = new Map()
  const context = {
    Component, QuickAddDialog, URL, AbortController, console: { warn: (...args) => warnings.push(args) },
    setTimeout(callback) { const timer = Symbol(); timers.set(timer, callback); return timer },
    clearTimeout(timer) { timers.delete(timer) },
    window: { location: { assign: url => navigations.push(url) } },
    document: { getElementById: () => new QuickAddDialog() },
    mediaQueryLarge: { addEventListener() {}, removeEventListener() {} },
    DialogCloseEvent: { eventName: 'close' },
    DOMParser: class { parseFromString(text) { return { querySelector: () => text === 'empty' ? null : { cloneNode: () => ({ text, cloneNode() { return this } }) } } } },
    fetch: fetchImpl,
  }
  const Constructor = vm.runInNewContext(`${code}\nQuickAddComponent`, context)
  const component = new Constructor()
  const renders = []
  component.updateQuickAddModal = async grid => { renders.push(grid.text) }
  return { component, warnings, navigations, renders, timers, opens: () => opens }
}
const event = { preventDefault() {} }
const response = text => ({ ok: true, status: 200, text: async () => text })

test('quick add shares prefetch and click requests, ignores duplicate clicks, then opens once', async () => {
  let resolve
  let requests = 0
  const api = harness(() => { requests++; return new Promise(done => { resolve = done }) })
  const prefetch = api.component.fetchProductPage(api.component.url)
  const click = api.component.handleClick(event)
  await api.component.handleClick(event)
  assert.equal(requests, 1)
  resolve(response('first'))
  await Promise.all([prefetch, click])
  assert.equal(api.opens(), 1)
  assert.deepEqual(api.renders, ['first'])
  assert.equal(api.component.attributes.has('aria-busy'), false)
  assert.equal(api.timers.size, 0)
})

test('quick add handles aborts for every waiter without warnings or an empty modal', async () => {
  const api = harness(async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) })
  await Promise.all([api.component.fetchProductPage(api.component.url), api.component.handleClick(event)])
  assert.equal(api.warnings.length, 0)
  assert.equal(api.opens(), 0)
  assert.deepEqual(api.navigations, [api.component.url])
})

test('quick add reports real failures, falls back to PDP and permits a later retry', async () => {
  let requests = 0
  const api = harness(async () => ++requests === 1 ? { ok: false, status: 503 } : response('recovered'))
  await api.component.handleClick(event)
  assert.equal(api.warnings[0][1].status, 503)
  assert.equal(api.navigations.length, 1)
  assert.equal(api.opens(), 0)
  await api.component.handleClick(event)
  assert.equal(requests, 2)
  assert.equal(api.opens(), 1)
})

test('quick add never opens stale product content when another selection supersedes it', async () => {
  const resolvers = new Map()
  const api = harness(url => new Promise(resolve => resolvers.set(url, resolve)))
  const firstUrl = api.component.url
  const first = api.component.handleClick(event)
  api.component.url = 'https://thecharmeedit.com/products/second'
  const second = api.component.handleClick(event)
  resolvers.get(api.component.url)(response('second'))
  await second
  resolvers.get(firstUrl)(response('first'))
  await first
  assert.deepEqual(api.renders, ['second'])
  assert.equal(api.opens(), 1)
  assert.equal(api.navigations.length, 0)
})

test('quick add aborts removed components quietly and bounds stalled requests', async () => {
  for (const mode of ['removed', 'timeout']) {
    const api = harness((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new TypeError('Load failed')))
    }))
    const click = api.component.handleClick(event)
    if (mode === 'removed') {
      api.component.isConnected = false
      api.component.disconnectedCallback()
    } else [...api.timers.values()][0]()
    await click
    assert.equal(api.opens(), 0)
    assert.equal(api.warnings.length, mode === 'timeout' ? 1 : 0)
    assert.equal(api.navigations.length, mode === 'timeout' ? 1 : 0)
    assert.equal(api.component.attributes.has('aria-busy'), false)
  }
})

test('quick add falls back to PDP instead of opening a modal without product content', async () => {
  const api = harness(async () => response('empty'))
  await api.component.handleClick(event)
  assert.equal(api.opens(), 0)
  assert.equal(api.navigations.length, 1)
})