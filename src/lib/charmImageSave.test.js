import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequestPost, onRequestPatch } from '../../functions/api/admin/charms.js'

for (const method of ['POST', 'PATCH']) {
  test(`${method}: unfinished Shopify image processing never persists a missing image`, async (t) => {
    const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
    let writes = 0
    t.mock.method(globalThis, 'setTimeout', (callback) => { queueMicrotask(callback); return 0 })
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url === 'https://upload.example.test') return new Response(null, { status: 200 })
      const { query } = JSON.parse(options.body)
      let data
      if (query.includes('metaobjectDefinitionByType')) {
        return Response.json({ errors: [{ message: 'Requires read_metaobject_definitions' }] })
      }

      if (query.includes('metaobjectByHandle')) {
        data = { metaobjectByHandle: { id: 'gid://shopify/Metaobject/1', handle: 'test', fields: [
          { key: 'legacy_id', value: 'test' }, { key: 'name', value: 'Test charm' },
        ] } }
      } else if (query.includes('stagedUploadsCreate')) {
        data = { stagedUploadsCreate: { stagedTargets: [{ url: 'https://upload.example.test', resourceUrl: 'https://staged.example.test/image.png', parameters: [] }], userErrors: [] } }
      } else if (query.includes('fileCreate')) {
        data = { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/1', fileStatus: 'PROCESSING' }], userErrors: [] } }
      } else if (query.includes('fileStatus')) {
        data = { node: { fileStatus: 'PROCESSING' } }
      } else if (query.includes('metaobjectUpdate') || query.includes('metaobjectCreate')) {
        writes++
        assert.fail('must not persist metadata until image processing finishes')
      } else {
        data = { node: { id: 'gid://shopify/ProductVariant/1', price: '2' } }
      }
      return Response.json({ data })
    })
    const record = { id: 'test', name: 'Test charm', shopifyVariantId: '1', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' }
    const response = await (method === 'POST' ? onRequestPost : onRequestPatch)({
      env, request: new Request('https://example.test/api/admin/charms', {
        method, headers: { authorization: 'Bearer test-only' },
        body: JSON.stringify(method === 'POST' ? { charms: [record] } : { ...record, widthMm: 32 }),
      }),
    })
    assert.equal(response.status, 502)
    assert.match((await response.json()).error, /image is still processing/)
    assert.equal(writes, 0)
  })
}

test('Shopify size-only repair saves real pixel dimensions and proportional millimetres without replacing artwork', async (t) => {
  const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  let fields
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    if (query.includes('metaobjectDefinitionByType')) {
      return Response.json({ errors: [{ message: 'Requires read_metaobject_definitions' }] })
    }
    if (query.includes('metaobjectByHandle')) {
      return Response.json({ data: { metaobjectByHandle: {
        id: 'gid://shopify/Metaobject/1', handle: 'test',
        fields: [
          { key: 'legacy_id', value: 'test' }, { key: 'name', value: 'Koi' },
          { key: 'width_mm', value: '20.8' }, { key: 'height_mm', value: '20.8' },
        ],
      } } })
    }
    assert.match(query, /metaobjectUpdate/)
    fields = Object.fromEntries(variables.metaobject.fields.map(({ key, value }) => [key, value]))
    return Response.json({ data: { metaobjectUpdate: { metaobject: { id: variables.id }, userErrors: [] } } })
  })
  const response = await onRequestPatch({
    env, request: new Request('https://example.test/api/admin/charms', {
      method: 'PATCH', headers: { authorization: 'Bearer test-only' },
      body: JSON.stringify({ id: 'test', widthMm: 20.8, heightMm: 20.8, pxW: 111, pxH: 326 }),
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(fields.px_w, '111')
  assert.equal(fields.px_h, '326')
  assert.equal(Number(fields.height_mm), 20.8)
  assert.ok(Math.abs(Number(fields.width_mm) / Number(fields.height_mm) - 111 / 326) < 1e-12)
  assert.equal(fields.image, undefined)
})
