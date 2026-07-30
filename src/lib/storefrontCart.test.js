import test from 'node:test'
import assert from 'node:assert/strict'
import { storefrontCartBridgeUrl, storefrontCartFields } from './storefrontCart.js'

function decodeBridgePayload(url) {
  const encoded = new URL(url).hash.replace(/^#charme-cart=/, '')
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
}

test('encodes multiple Shopify cart lines with line-item properties', () => {
  const fields = storefrontCartFields([
    {
      id: 101,
      quantity: 1,
      properties: { _design_token: 'design-1', Design: '3 charms' },
    },
    {
      id: 202,
      quantity: 2,
      properties: { _design_token: 'design-1', _role: 'charm' },
    },
  ])

  assert.deepEqual(fields, [
    ['items[0][id]', '101'],
    ['items[0][quantity]', '1'],
    ['items[0][properties][_design_token]', 'design-1'],
    ['items[0][properties][Design]', '3 charms'],
    ['items[1][id]', '202'],
    ['items[1][quantity]', '2'],
    ['items[1][properties][_design_token]', 'design-1'],
    ['items[1][properties][_role]', 'charm'],
    ['return_to', '/cart'],
  ])
})

test('preserves a preview theme in the Shopify cart return path', () => {
  const fields = storefrontCartFields(
    [{ id: 101, quantity: 1, properties: {} }],
    '/cart?preview_theme_id=185473892730',
  )

  assert.deepEqual(fields.at(-1), [
    'return_to',
    '/cart?preview_theme_id=185473892730',
  ])
})

test('builds a same-origin cart bridge URL without losing the preview theme', () => {
  const items = [
    {
      id: 101,
      quantity: 1,
      properties: { _design_token: 'new-design', Design: 'Étoile' },
    },
  ]
  const url = storefrontCartBridgeUrl(
    'https://thecharmeedit.com',
    items,
    '/cart?preview_theme_id=185473892730',
    'old-design',
  )

  assert.equal(new URL(url).pathname, '/cart')
  assert.equal(new URL(url).search, '?preview_theme_id=185473892730')
  assert.deepEqual(decodeBridgePayload(url), {
    version: 1,
    items,
    replaceDesignToken: 'old-design',
  })
})

test('rejects an off-store cart destination for the bridge', () => {
  const url = storefrontCartBridgeUrl(
    'https://thecharmeedit.com',
    [{ id: 101, quantity: 1, properties: {} }],
    'https://example.com/cart?preview_theme_id=1',
  )

  assert.equal(new URL(url).origin, 'https://thecharmeedit.com')
  assert.equal(new URL(url).pathname, '/cart')
  assert.equal(new URL(url).search, '')
})