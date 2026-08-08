import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const liquid = readFileSync(
  new URL('../../shopify/snippets/charme-cart-drawer.liquid', import.meta.url),
  'utf8',
)
const script = liquid.match(/<script>([\s\S]*?)<\/script>/)?.[1]

function drawerApi(currency = 'GBP', lang = 'en-GB') {
  assert.ok(script, 'Drawer script is missing')
  const root = {
    getAttribute(name) {
      return {
        'data-currency': currency,
        'data-money-format': '£{{amount}}',
        'data-rec-intent': 'related',
        'data-threshold': '0',
      }[name] || ''
    },
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
  const context = {
    console,
    document: {
      documentElement: { lang },
      getElementById: () => root,
    },
    window: { __CHARME_CART_TEST__: true },
  }

  vm.runInNewContext(script, context, { filename: 'charme-cart-drawer.inline.js' })
  return context.window.__CHARME_CART_TEST__
}

const base = {
  final_line_price: 4899,
  handle: 'custom-charm-phone-case',
  image: '/case.png',
  key: 'base:1',
  original_line_price: 4899,
  product_title: 'Custom case',
  properties: { Proof: '/proof.png', _design_token: 'design-1' },
  quantity: 1,
  variant_title: 'White (Glitter Gel) / iPhone 17 Pro',
}
const charmA = {
  final_line_price: 300,
  key: 'charm:1',
  original_line_price: 300,
  product_title: 'Gold Star',
  properties: { _design_token: 'design-1', _role: 'charm' },
  quantity: 1,
}
const charmB = {
  final_line_price: 600,
  key: 'charm:2',
  original_line_price: 600,
  product_title: 'Pearl',
  properties: { _design_token: 'design-1', _role: 'charm' },
  quantity: 2,
}
const ordinary = {
  final_line_price: 5600,
  image: '/eros.png',
  key: 'ordinary:1',
  original_line_price: 5600,
  product_title: 'Eros Light',
  properties: {},
  quantity: 2,
  variant_title: 'White / iPhone',
}

test('drawer folds every design token into one removable item', () => {
  const api = drawerApi()
  const html = api.renderItems({ items: [base, charmA, charmB, ordinary] })

  assert.equal((html.match(/cc-item--design/g) || []).length, 1)
  assert.equal((html.match(/Custom Charm Case/g) || []).length, 1)
  assert.match(html, /data-keys="base:1,charm:1,charm:2"/)
  assert.match(html, /£57\.99/)
  assert.doesNotMatch(html, /data-key="charm:[12]"/)
  assert.match(html, /data-key="ordinary:1"/)
  assert.equal(api.logicalCount({ items: [base, charmA, charmB, ordinary] }), 3)
})

test('drawer keeps a base-only custom design folded', () => {
  assert.match(drawerApi().renderItems({ items: [base] }), /Custom Charm Case/)
})

test('drawer formats cart prices in the active market currency', () => {
  const html = drawerApi('USD', 'en-US').renderLine({
    ...ordinary,
    final_line_price: 4899,
    original_line_price: 4899,
  })

  assert.match(html, /\$48\.99/)
  assert.doesNotMatch(html, /£48\.99/)
})