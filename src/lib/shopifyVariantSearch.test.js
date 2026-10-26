import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestGet } from '../../functions/api/admin/shopify-variants.js'
import { searchShopifyVariants } from './adminApi.js'

globalThis.localStorage = { getItem: () => '' }

const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
const request = (query, after) => new Request(`https://example.test/api/admin/shopify-variants?${new URLSearchParams({
  q: query, ...(after ? { after } : {}),
})}`, { headers: { authorization: 'Bearer test-only' } })

test('search finds a product by name and paginates all its variants including sold-out results', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    calls.push(variables)
    if (query.includes('products(first:')) {
      assert.equal(variables.query, '(title:little* AND title:harvest*) OR handle:little-harvest*')
      return Response.json({ data: { products: { nodes: [{ id: 'gid://shopify/Product/12' }], pageInfo: { hasNextPage: false } } } })
    }
    assert.equal(variables.query, 'product_id:12')
    return Response.json({ data: { productVariants: {
      edges: [{ node: {
        id: `gid://shopify/ProductVariant/${variables.after ? '52' : '51'}`,
        title: 'Pumpkin', price: '4.50', availableForSale: false,
        product: { title: 'Little Harvest', handle: 'little-harvest' },
      } }],
      pageInfo: { hasNextPage: !variables.after, endCursor: 'next-page' },
    } } })
  })
  const first = await onRequestGet({ request: request('little harvest'), env })
  assert.equal(first.status, 200)
  const page = await first.json()
  assert.equal(page.after, 'next-page')
  assert.equal(page.variants[0].productTitle, 'Little Harvest')
  assert.equal(page.variants[0].price, 4.5)
  assert.equal(page.variants[0].available, false)
  const second = await onRequestGet({ request: request('little harvest', page.after), env })
  const next = await second.json()
  assert.equal(next.variants[0].id, '52')
  assert.equal(next.after, null)
  assert.equal(calls.length, 4)
})

test('numeric search resolves a variant directly without a full catalogue scan', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    assert.match(query, /nodes\(ids:/)
    assert.deepEqual(variables.ids, ['gid://shopify/ProductVariant/51'])
    return Response.json({ data: { nodes: [{
      id: variables.ids[0], title: 'Default Title', price: '3',
      product: { title: 'Little Harvest', handle: 'little-harvest' },
    }] } })
  })
  const response = await onRequestGet({ request: request('51'), env })
  assert.equal((await response.json()).variants[0].id, '51')
})

test('no matches, overly broad searches, invalid input and Shopify failures are distinguishable', async (t) => {
  let mode = 'empty'
  t.mock.method(globalThis, 'fetch', async () => {
    if (mode === 'error') return Response.json({ errors: [{ message: 'Access denied' }] })
    return Response.json({ data: { products: { nodes: [], pageInfo: { hasNextPage: mode === 'broad' } } } })
  })
  assert.deepEqual(await (await onRequestGet({ request: request('missing'), env })).json(), { variants: [], after: null })
  mode = 'broad'
  const broad = await onRequestGet({ request: request('charm'), env })
  assert.equal(broad.status, 400)
  assert.match((await broad.json()).error, /more specific/)
  mode = 'error'
  const failed = await onRequestGet({ request: request('harvest'), env })
  assert.equal(failed.status, 502)
  assert.match((await failed.json()).error, /Access denied/)
  for (const input of ['', '!()', 'a'.repeat(201)]) {
    assert.equal((await onRequestGet({ request: request(input), env })).status, 400)
  }
  const unconfigured = await onRequestGet({ request: request('harvest'), env: { ADMIN_TOKEN: 'test-only' } })
  assert.equal(unconfigured.status, 409)
  assert.match((await unconfigured.json()).error, /Configure Shopify/)
})

test('client search encodes product names, loads later pages and surfaces API failures', async (t) => {
  t.mock.property(globalThis, 'localStorage', { getItem: () => 'test-only' })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    const params = new URL(url, 'https://example.test').searchParams
    calls.push(params)
    assert.equal(params.get('q'), 'Little Harvest & Autumn')
    return Response.json({ variants: [{ id: params.has('after') ? '52' : '51' }], after: params.has('after') ? null : 'next cursor' })
  })
  const result = await searchShopifyVariants('Little Harvest & Autumn')
  assert.deepEqual(result.variants.map((variant) => variant.id), ['51', '52'])
  assert.equal(calls[1].get('after'), 'next cursor')
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Shopify unavailable' }, { status: 502 }))
  await assert.rejects(() => searchShopifyVariants('test'), /Shopify unavailable/)
})
