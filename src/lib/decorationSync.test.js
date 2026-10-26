import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDecorationSync, decorationSyncPreview, importedDecoration } from './decorationSync.js'
import { listShopifyVariants, shopifyVariantPage, shopifyVariantBatch } from '../../functions/api/admin/shopify-variants.js'
import { onRequestPost } from '../../functions/api/admin/sync-decorations.js'

const variant = (id, extra = {}) => ({
  id, productTitle: 'Gold Charm', title: 'Default Title', handle: 'gold-charm',
  imageUrl: 'https://cdn.shopify.com/charm.png', price: 3, available: true, ...extra,
})
const variants = [variant('1'), variant('2', { title: 'Heart', available: false }), variant('3', { productTitle: 'Canvas patch', handle: 'canvas-patch' })]
const records = [{ id: 'custom-heart', name: 'My renamed heart', shopifyVariantId: '1', hidden: true, widthMm: 31, src: '/art.png', price: 2 }]

test('preview excludes every already-linked variant, including hidden and duplicate associations', () => {
  const result = decorationSyncPreview(variants, [...records, { ...records[0], id: 'another' }])
  assert.deepEqual(result.missing.map((item) => item.id), ['2', '3'])
  assert.equal(result.existing.length, 2)
  assert.equal(result.existing[0].name, 'My renamed heart')
})

test('optional naming rule matches product, variant and handle case-insensitively', () => {
  assert.equal(decorationSyncPreview(variants, records, ' CHARM ').missing.length, 1)
  assert.equal(decorationSyncPreview(variants, records, 'heart').missing[0].id, '2')
  assert.equal(decorationSyncPreview(variants, records, 'canvas-patch').missing[0].id, '3')
  assert.equal(decorationSyncPreview(variants, records, '').missing.length, 2)
  assert.equal(decorationSyncPreview(variants, records, 'no-match').missing.length, 0)
})

test('preview keeps unlinked / deleted associations visible without treating them as a new link', () => {
  const result = decorationSyncPreview(variants, [{ id: 'unlinked' }, { id: 'deleted', shopifyVariantId: '999' }])
  assert.equal(result.missing.length, 3)
  assert.ok(result.existing.every((item) => item.variant === null))
})

test('imports have stable per-kind IDs, meaningful default-variant names and explicit sizing defaults', () => {
  const charm = importedDecoration('charm', variants[0])
  const patch = importedDecoration('patch', variants[0])
  assert.equal(charm.id, 'shopify-charm-1')
  assert.equal(patch.id, 'shopify-patch-1')
  assert.equal(charm.name, 'Gold Charm')
  assert.equal(importedDecoration('charm', variants[1]).name, 'Gold Charm - Heart')
  assert.equal(charm.widthMm, 16)
  assert.equal(charm.heightMm, 16)
  assert.equal(charm.shopifyVariantId, '1')
  assert.throws(() => importedDecoration('charm', variant('x')), /Invalid Shopify variant/)
  assert.throws(() => importedDecoration('charm', variant('1', { imageUrl: '' })), /no Shopify image/)
  assert.throws(() => importedDecoration('charm', variant('1', { price: NaN })), /Invalid Shopify price/)
})

function syncOptions(extra = {}) {
  const saved = []
  let uploads = 0
  return {
    saved, get uploads() { return uploads },
    kind: 'charm', variants, records: structuredClone(records),
    variantIds: [], existingIds: [],
    save: async (record, images) => { saved.push({ record, images }) },
    storeImage: async () => { uploads++; return { id: 'gid://shopify/MediaImage/55', url: 'https://cdn.shopify.com/imported.png' } },
    ...extra,
  }
}

test('only selected missing variants are created and selected existing items update price only', async () => {
  const options = syncOptions({ variantIds: ['2', '2'], existingIds: ['custom-heart'] })
  const result = await applyDecorationSync(options)
  assert.deepEqual(result.created, ['variant:2'])
  assert.deepEqual(result.updated, ['existing:custom-heart'])
  assert.equal(options.saved.length, 2)
  assert.equal(options.uploads, 1)
  assert.equal(options.saved[0].images.image, 'gid://shopify/MediaImage/55')
  assert.deepEqual(options.saved[1].record, { ...records[0], price: 3 })
  assert.deepEqual(options.saved[1].images, {})
})

test('confirm rechecks links and retry does not duplicate records or upload images again', async () => {
  const options = syncOptions({ variantIds: ['1', '2'] })
  await applyDecorationSync(options)
  options.records.push(options.saved[0].record)
  const retry = await applyDecorationSync(options)
  assert.deepEqual(retry.skipped, ['variant:1', 'variant:2'])
  assert.equal(options.saved.length, 1)
  assert.equal(options.uploads, 1)
})

test('unchecked existing records stay untouched and patches store their hosted image reference', async () => {
  const options = syncOptions({ kind: 'patch', variantIds: ['3'] })
  const result = await applyDecorationSync(options)
  assert.equal(result.updated.length, 0)
  assert.equal(options.saved.length, 1)
  assert.equal(options.saved[0].record.imageFileId, 'gid://shopify/MediaImage/55')
  assert.deepEqual(options.saved[0].images, {})
})

for (const kind of ['charm', 'patch']) {
  test(`${kind}: optional existing-image reprocessing replaces artwork but preserves merchant metadata`, async () => {
    const options = syncOptions({ kind, existingIds: ['custom-heart'], reprocessExisting: true })
    const result = await applyDecorationSync(options)
    assert.deepEqual(result.updated, ['existing:custom-heart'])
    assert.equal(options.uploads, 1)
    const saved = options.saved[0]
    assert.equal(saved.record.src, 'https://cdn.shopify.com/imported.png')
    for (const key of ['name', 'widthMm', 'hidden', 'shopifyVariantId']) {
      assert.equal(saved.record[key], records[0][key])
    }
    if (kind === 'charm') assert.equal(saved.images.image, 'gid://shopify/MediaImage/55')
    else assert.equal(saved.record.imageFileId, 'gid://shopify/MediaImage/55')
  })
}

test('failed background-removed image uploads never save original artwork or partial price updates', async () => {
  const options = syncOptions({
    variantIds: ['2'], existingIds: ['custom-heart'], reprocessExisting: true,
    storeImage: async (_record, key) => { throw new Error(`Image processing failed for ${key}`) },
  })
  const result = await applyDecorationSync(options)
  assert.deepEqual(result.created, [])
  assert.deepEqual(result.updated, [])
  assert.deepEqual(result.failed.map((item) => item.key), ['variant:2', 'existing:custom-heart'])
  assert.equal(options.saved.length, 0)
})

test('missing image, deleted variant, failed writes and missing existing record surface item failures', async () => {
  const options = syncOptions({
    variants: [...variants, variant('4', { imageUrl: '' })],
    variantIds: ['2', '3', '4', '999'],
    existingIds: ['gone'],
    save: async (record) => {
      if (record.shopifyVariantId === '2') throw new Error('Shopify rejected write')
    },
  })
  const result = await applyDecorationSync(options)
  assert.deepEqual(result.created, ['variant:3'])
  assert.deepEqual(result.failed.map((item) => item.key), ['variant:2', 'variant:4', 'variant:999', 'existing:gone'])
  assert.match(result.failed[0].error, /rejected write/)
})

test('stable-ID collisions cannot overwrite an unrelated catalogue record', async () => {
  const options = syncOptions({ variantIds: ['2'], records: [{ id: 'shopify-charm-2', shopifyVariantId: '999' }] })
  const result = await applyDecorationSync(options)
  assert.match(result.failed[0].error, /already belongs/)
  assert.equal(options.uploads, 0)
  assert.equal(options.saved.length, 0)
})

test('Shopify discovery paginates variants directly, including products with more than 250 variants', async (t) => {
  const calls = []
  const node = (id) => ({ id: `gid://shopify/ProductVariant/${id}`, title: 'Default Title', price: '3', availableForSale: true, product: { title: 'Charms', handle: 'charms' } })
  const connection = (nodes, more, cursor) => ({ edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: more, endCursor: cursor } })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    calls.push(variables)
    assert.match(query, /productVariants\(first: 100/)
    const offset = Number(variables.after || 0)
    const count = offset < 200 ? 100 : 51
    const data = { productVariants: connection(Array.from({ length: count }, (_, index) => node(String(offset + index + 1))), offset < 200, String(offset + count)) }
    return Response.json({ data })
  })
  const result = await listShopifyVariants({ SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' })
  assert.equal(result.length, 251)
  assert.equal(result[250].id, '251')
  assert.equal(result[250].productTitle, 'Charms')
  assert.equal(calls.length, 3)
})

test('sync API rejects unauthenticated, unconfigured and invalid requests before querying Shopify', async () => {
  const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  const request = (body, token = 'test-only') => new Request('https://example.test/api/admin/sync-decorations', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })
  assert.equal((await onRequestPost({ request: request({}, 'wrong'), env })).status, 401)
  assert.equal((await onRequestPost({ request: request({}), env: { ADMIN_TOKEN: 'test-only' } })).status, 409)
  for (const body of [
    { kind: 'product', action: 'preview' },
    { kind: 'charm', action: 'invalid' },
    { kind: 'charm', action: 'preview', keyword: [] },
    { kind: 'charm', action: 'preview', after: {} },
    { kind: 'charm', action: 'apply', reprocessExisting: 'yes', variantIds: [], existingIds: [] },
    { kind: 'charm', action: 'apply', images: [], variantIds: [], existingIds: [] },
    { kind: 'patch', action: 'apply', variantIds: ['bad'], existingIds: [] },
    { kind: 'patch', action: 'apply', variantIds: Array(51).fill('1'), existingIds: [] },
  ]) assert.equal((await onRequestPost({ request: request(body), env })).status, 400)
})

test('scan batches bound Shopify requests and return a resumable cursor', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++
    const offset = Number(JSON.parse(options.body).variables.after || 0)
    return Response.json({ data: { productVariants: {
      edges: [{ node: { id: `gid://shopify/ProductVariant/${offset + 1}`, price: '3', product: { title: 'Charm' } } }],
      pageInfo: { hasNextPage: offset < 6, endCursor: String(offset + 1) },
    } } })
  })
  const env = { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  const first = await shopifyVariantBatch(env)
  assert.equal(first.variants.length, 5)
  assert.equal(first.after, '5')
  assert.equal(calls, 5)
  const second = await shopifyVariantBatch(env, first.after)
  assert.equal(second.variants.length, 2)
  assert.equal(second.after, null)
  assert.equal(calls, 7)
})

test('Shopify scan retries throttling with bounded backoff but does not hide other errors', async (t) => {
  const delays = []
  let attempts = 0
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay)
    queueMicrotask(callback)
    return 0
  })
  t.mock.method(globalThis, 'fetch', async () => {
    attempts++
    return attempts < 3
      ? Response.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] })
      : Response.json({ data: { productVariants: { edges: [], pageInfo: { hasNextPage: false } } } })
  })
  const env = { SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  await shopifyVariantPage(env)
  // shopifyAdmin backs off exponentially (500ms, 1s) plus up to 250ms jitter.
  assert.equal(delays.length, 2)
  assert.ok(delays[0] >= 500 && delays[0] < 750, `first delay ${delays[0]}`)
  assert.ok(delays[1] >= 1000 && delays[1] < 1250, `second delay ${delays[1]}`)
  assert.equal(attempts, 3)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ errors: [{ message: 'Permission denied' }] }))
  await assert.rejects(() => shopifyVariantPage(env), /Permission denied/)
  assert.equal(delays.length, 2)
})

test('API preview is read-only; confirmation persists a typed charm image and retry sees the saved link', async (t) => {
  const nodes = []
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  let writes = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://upload.example.test') {
      const file = options.body.get('file')
      assert.equal(file.type, 'image/png')
      assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), png.split(',')[1])
      return new Response(null, { status: 200 })
    }
    const { query, variables } = JSON.parse(options.body)
    let data
    if (query.includes('metaobjectDefinitionByType')) {
      const keys = ['legacy_id', 'name', 'image', 'category', 'tier', 'collection', 'charm_type', 'price', 'width_mm', 'height_mm', 'px_w', 'px_h', 'min_scale', 'max_scale', 'hidden', 'shopify_variant_id', 'bundle', 'bundle_max', 'source']
      data = { metaobjectDefinitionByType: { id: 'definition', fieldDefinitions: keys.map((key) => ({ key })) } }
    } else if (query.includes('productVariants(first:') || query.includes('nodes(ids:')) {
      const variantNode = {
        id: 'gid://shopify/ProductVariant/2', title: 'Heart', price: '3',
        image: { url: variants[1].imageUrl }, availableForSale: true,
        product: { title: 'Gold Charm', handle: 'gold-charm' },
      }
      data = query.includes('nodes(ids:')
        ? { nodes: [variantNode] }
        : { productVariants: { edges: [{ node: variantNode }], pageInfo: { hasNextPage: false } } }
    } else if (query.includes('metaobjectByHandle')) {
      data = { metaobjectByHandle: nodes.find((node) => node.handle === variables.handle.handle) || null }
    } else if (query.includes('metaobjects(type:')) {
      data = { metaobjects: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false } } }
    } else if (query.includes('stagedUploadsCreate(')) {
      data = { stagedUploadsCreate: { stagedTargets: [{
        url: 'https://upload.example.test', resourceUrl: 'https://staged.example.test/cutout.png', parameters: [],
      }], userErrors: [] } }
    } else if (query.includes('fileCreate(')) {
      writes++
      assert.equal(variables.files[0].originalSource, 'https://staged.example.test/cutout.png')
      data = { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/55', image: { url: 'https://cdn.shopify.com/imported.png' } }], userErrors: [] } }
    } else if (query.includes('metaobjectCreate(')) {
      writes++
      assert.equal(variables.input.type, 'charme_charm')
      const node = { id: 'gid://shopify/Metaobject/1', handle: variables.input.handle, fields: variables.input.fields.map((field) => ({
        ...field, ...(field.key === 'image' ? { reference: { image: { url: 'https://cdn.shopify.com/imported.png' } } } : {}),
      })) }
      assert.equal(node.fields.find((field) => field.key === 'image').value, 'gid://shopify/MediaImage/55')
      nodes.push(node)
      data = { metaobjectCreate: { metaobject: node, userErrors: [] } }
    } else {
      throw new Error(`Unexpected GraphQL query: ${query}`)
    }
    return Response.json({ data })
  })
  const env = { ADMIN_TOKEN: 'test-only', SHOPIFY_STORE: 'example.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'test-only' }
  const call = async (body) => {
    const response = await onRequestPost({ env, request: new Request('https://example.test/api/admin/sync-decorations', {
      method: 'POST', headers: { authorization: 'Bearer test-only' }, body: JSON.stringify({ kind: 'charm', ...body }),
    }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const beforePage = await call({ action: 'preview' })
  const before = decorationSyncPreview(beforePage.variants, beforePage.records)
  assert.equal(before.missing.length, 1)
  assert.equal(writes, 0)
  for (const images of [undefined, { 'variant:2': variants[1].imageUrl }, { 'variant:2': 'data:image/jpeg;base64,abcd' }]) {
    const failed = await call({ action: 'apply', variantIds: ['2'], existingIds: [], images })
    assert.deepEqual(failed.created, [])
    assert.match(failed.failed[0].error, /background-removed PNG is required/)
    assert.equal(writes, 0)
  }
  const saved = await call({ action: 'apply', variantIds: ['2'], existingIds: [], images: { 'variant:2': png } })
  assert.deepEqual(saved.created, ['variant:2'])
  assert.equal(writes, 2)
  const retry = await call({ action: 'apply', variantIds: ['2'], existingIds: [] })
  assert.deepEqual(retry.skipped, ['variant:2'])
  assert.equal(writes, 2)
  const afterPage = await call({ action: 'preview' })
  const after = decorationSyncPreview(afterPage.variants, afterPage.records)
  assert.equal(after.missing.length, 0)
  assert.equal(after.existing[0].src, 'https://cdn.shopify.com/imported.png')
  assert.equal(after.existing[0].shopifyVariantId, '2')
})
