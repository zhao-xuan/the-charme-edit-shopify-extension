import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingPublishPlan, publishPendingDrafts, removePublishedDraft } from './publishDrafts.js'
import { onRequestPost } from '../../functions/api/admin/charms.js'

const charm = (id, shopifyVariantId = '123') => ({ id, name: id, shopifyVariantId, src: 'data:image/png;base64,AA==' })
const emptyCatalog = { charms: [], products: [] }

test('preflight reports every unlinked legacy/extracted draft without making any writes', async () => {
  const calls = []
  await assert.rejects(() => publishPendingDrafts({
    customCharms: [charm('valid'), charm('Gold matchstick', ''), charm('extracted', null)],
    customProducts: [{ id: 'product' }],
  }, {
    fetchCatalog: async () => emptyCatalog,
    addCharms: async () => calls.push('charm'),
    addProduct: async () => calls.push('product'),
    onConfirmed: () => calls.push('confirmed'),
  }), /Gold matchstick, extracted/)
  assert.deepEqual(calls, [])
})

test('already-live IDs are not republished, even when the stale draft lacks a variant', async () => {
  const live = { ...charm('live'), widthMm: 10 }
  const draft = { customCharms: [{ ...live, shopifyVariantId: '', widthMm: 40 }, charm('new')], customProducts: [{ id: 'product' }] }
  const created = []
  const confirmed = []
  const result = await publishPendingDrafts(draft, {
    fetchCatalog: async () => ({ charms: [live], products: [{ id: 'product' }] }),
    addCharms: async (items) => created.push(...items),
    addProduct: async () => assert.fail('already-live product must not be overwritten'),
    onConfirmed: (field, id) => confirmed.push([field, id]),
  })
  assert.deepEqual(created.map((item) => item.id), ['new'])
  assert.equal(live.widthMm, 10)
  assert.deepEqual(confirmed, [['customCharms', 'live'], ['customProducts', 'product'], ['customCharms', 'new']])
  assert.deepEqual(result, { charms: 1, products: 0, alreadyPublished: 2 })
})

test('similar names are never treated as proof a local draft is published', () => {
  const plan = pendingPublishPlan({ customCharms: [{ id: 'local', name: 'Gold matchstick' }] }, {
    charms: [{ id: 'shopify', name: 'Gold Matchstick' }], products: [],
  })
  assert.equal(plan.charms.length, 1)
  assert.equal(plan.alreadyPublished.length, 0)
})

test('partial failure removes only confirmed drafts and preserves newer additions', async () => {
  let draft = { customCharms: [charm('one'), charm('two')], customProducts: [{ id: 'product' }], charmSizes: { live: 1.2 } }
  await assert.rejects(() => publishPendingDrafts(draft, {
    fetchCatalog: async () => emptyCatalog,
    addCharms: async ([item]) => {
      if (item.id === 'two') throw new Error('Shopify unavailable')
      draft = { ...draft, customCharms: [...draft.customCharms, charm('added-during-publish')] }
    },
    addProduct: async () => assert.fail('must stop after failure'),
    onConfirmed: (field, id) => { draft = removePublishedDraft(draft, field, id) },
  }), /Shopify unavailable/)
  assert.deepEqual(draft.customCharms.map((item) => item.id), ['two', 'added-during-publish'])
  assert.deepEqual(draft.customProducts, [{ id: 'product' }])
  assert.deepEqual(draft.charmSizes, { live: 1.2 })
})

test('failed or malformed fresh catalogue read never permits publishing', async () => {
  for (const fetchCatalog of [async () => { throw new Error('offline') }, async () => ({})]) {
    await assert.rejects(() => publishPendingDrafts({ customCharms: [charm('one')] }, {
      fetchCatalog,
      addCharms: async () => assert.fail('must not write'),
      onConfirmed: () => assert.fail('must not discard drafts'),
    }))
  }
})

const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
const request = (charms) => new Request('https://example.test/api/admin/charms', {
  method: 'POST', headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
  body: JSON.stringify({ charms }),
})

test('server preflights later invalid drafts before any Shopify calls', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not upload or write any item'))
  const result = await onRequestPost({ env, request: request([charm('first'), charm('Gold matchstick', '')]) })
  assert.equal(result.status, 400)
  assert.match((await result.json()).error, /Gold matchstick/)
})

test('server preflights missing/deleted variants before uploading any image', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    assert.match(query, /on ProductVariant/)
    calls++
    return Response.json({ data: { node: variables.id.endsWith('/404') ? null : { id: variables.id, price: '2' } } })
  })
  const result = await onRequestPost({ env, request: request([charm('first'), charm('deleted', '404')]) })
  assert.equal(result.status, 400)
  assert.equal(calls, 2)
  assert.match((await result.json()).error, /variant was not found/)
})
