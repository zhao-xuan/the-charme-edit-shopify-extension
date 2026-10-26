import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../shopify/assets/cart-icon.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '')

function setup(fetch) {
  let CartIcon
  const storage = new Map([['cart-count', JSON.stringify({ value: '11', timestamp: Date.now() })]])
  const context = {
    Component: class {},
    onAnimationEnd: async () => {},
    ThemeEvents: { cartUpdate: 'cart:update' },
    customElements: { get: () => null, define: (name, implementation) => { CartIcon = implementation } },
    window: { Shopify: { routes: { root: '/en-us/' } } },
    sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key) },
    fetch,
  }
  vm.runInNewContext(source, context)
  const icon = new CartIcon()
  const node = () => ({ textContent: '1', classList: { toggle() {}, remove() {} } })
  icon.refs = { cartBubble: node(), cartBubbleText: node(), cartBubbleCount: node() }
  icon.classList = node().classList
  return { icon, storage }
}

test('cart icon counts design bases and ordinary quantities, never raw charm quantities', async () => {
  const { icon, storage } = setup(async (url) => {
    assert.equal(url, '/en-us/cart.js')
    return { ok: true, json: async () => ({ items: [
      { quantity: 1, properties: { _design_token: 'design' } },
      { quantity: 10, properties: { _role: 'charm', _design_token: 'design' } },
      { quantity: 2, properties: {} },
    ] }) }
  })
  await icon.onCartUpdate({ detail: { data: { itemCount: 13, source: 'product-form-component' } } })
  assert.equal(icon.currentCartCount, 3)
  assert.equal(JSON.parse(storage.get('charme-cart-count')).value, '3')
})

test('cart icon ignores stale responses and old raw-count storage', async () => {
  const pending = []
  const { icon } = setup(() => new Promise((resolve) => pending.push(resolve)))
  const older = icon.ensureCartBubbleIsCorrect()
  const newer = icon.onCartUpdate({})
  pending[1]({ ok: true, json: async () => ({ items: [] }) })
  await newer
  pending[0]({ ok: true, json: async () => ({ items: [{ quantity: 1 }] }) })
  await older
  assert.equal(icon.currentCartCount, 0)
})

test('cart count failure preserves the rendered logical count', async () => {
  const { icon } = setup(async () => { throw new Error('Load failed') })
  await icon.ensureCartBubbleIsCorrect()
  assert.equal(icon.currentCartCount, 1)
})