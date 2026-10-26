import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { onRequestDelete } from '../../functions/api/admin/charms.js'
import { onRequestGet } from '../../functions/api/catalog.js'
import { fetchCatalog, deleteCharm } from './adminApi.js'
import { loadRemoteCatalog, onRemoteCatalogChange, remoteCatalogFailed } from './remoteCatalog.js'

globalThis.localStorage = { getItem: () => '' }

const env = {
  ADMIN_TOKEN: 'test-only',
  SHOPIFY_STORE: 'sync-test.myshopify.com',
  SHOPIFY_ADMIN_TOKEN: 'test-only',
}
const charmNode = {
  id: 'gid://shopify/Metaobject/1', handle: 'match',
  fields: [
    { key: 'legacy_id', value: 'match' },
    { key: 'name', value: 'Match' },
    { key: 'price', value: '4' },
  ],
}

function shopify(t, { confirmDelete = true, failList = false, pauseList } = {}) {
  let exists = true
  let listCount = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body)
    let data
    if (query.includes('metaobjectDefinitionByType')) {
      data = { metaobjectDefinitionByType: { id: 'def', fieldDefinitions: [{ key: 'legacy_id' }] } }
    } else if (query.includes('metaobjectDefinitionUpdate')) {
      data = { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: 'def', fieldDefinitions: [{ key: 'legacy_id' }] }, userErrors: [] } }
    } else if (query.includes('metaobjectByHandle')) {
      data = { metaobjectByHandle: exists ? charmNode : null }
    } else if (query.includes('metaobjectDelete')) {
      if (confirmDelete) exists = false
      data = { metaobjectDelete: { deletedId: confirmDelete ? charmNode.id : null, userErrors: [] } }
    } else if (query.includes('metaobjects(')) {
      if (failList) return Response.json({ errors: [{ message: 'Catalogue unavailable' }] })
      const nodes = exists && variables.type === 'charme_charm' ? [charmNode] : []
      listCount++
      if (pauseList) await pauseList()
      data = { metaobjects: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false } } }
    } else {
      assert.fail(`Unexpected Shopify operation: ${query}`)
    }
    return Response.json({ data })
  })
  return { get listCount() { return listCount } }
}

const readCatalog = (fresh = true) => onRequestGet({
  env, request: new Request(`https://example.com/api/catalog${fresh ? '?fresh=1' : ''}`),
})
const remove = () => onRequestDelete({
  env,
  request: new Request('https://example.com/api/admin/charms', {
    method: 'DELETE',
    headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'match' }),
  }),
})

test('Shopify delete plus a fresh read removes the actual live charm despite a cached snapshot', async (t) => {
  shopify(t)
  assert.deepEqual((await (await readCatalog()).json()).charms.map((item) => item.id), ['match'])
  assert.equal((await remove()).status, 200)
  assert.deepEqual((await (await readCatalog()).json()).charms, [])
  assert.deepEqual((await (await readCatalog(false)).json()).charms, [])
})

test('deletion is not reported as successful without Shopify deletedId confirmation', async (t) => {
  shopify(t, { confirmDelete: false })
  await assert.rejects(remove, /Shopify did not confirm deletion/)
})

test('fresh reads cannot reuse a catalogue rebuild started before deletion', async (t) => {
  let release
  const paused = new Promise((resolve) => { release = resolve })
  let pause = true
  const mock = shopify(t, { pauseList: () => pause ? paused : undefined })
  const before = readCatalog()
  for (let attempt = 0; attempt < 100 && mock.listCount < 4; attempt++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(mock.listCount, 4)
  assert.equal((await remove()).status, 200)
  const after = readCatalog()
  pause = false
  release()
  assert.equal((await (await before).json()).charms.length, 1)
  assert.deepEqual((await (await after).json()).charms, [])
  assert.equal(mock.listCount, 8)
})

test('Shopify refresh failure returns an error rather than stale success after deletion', async (t) => {
  shopify(t)
  assert.equal((await readCatalog()).status, 200)
  shopify(t, { failList: true })
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 31_000)
  assert.equal((await readCatalog(false)).status, 502)
})

test('admin reads and deletion use the shared API and bypass the browser cache', async (t) => {
  t.mock.property(globalThis, 'localStorage', { getItem: () => 'test-only' })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return Response.json({ products: [], charms: [], patches: [] })
  })
  await deleteCharm('match')
  await fetchCatalog()
  assert.equal(calls[0].url, '/api/admin/charms')
  assert.deepEqual(JSON.parse(calls[0].options.body), { id: 'match' })
  assert.equal(calls[1].url, '/api/catalog?fresh=1')
  assert.equal(calls[1].options.cache, 'no-store')
})

function catalogHarness() {
  let remote = null
  const item = (id) => ({ id, name: id, category: 'gold', type: 2, widthMm: 10, heightMm: 10 })
  const source = readFileSync(new URL('./catalog.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/^export \{.*\}$/gm, '')
    .replaceAll('export ', '')
  const context = vm.createContext({
    charmData: { charms: [item('bundled')] },
    patchData: { patches: [item('bundled-patch')] },
    charmOverrides: {},
    resolveAsset: (src) => src,
    remoteCatalog: () => remote,
    loadAdmin: () => ({
      charmHidden: { kept: true }, charmPrices: {}, charmSizes: {},
      customCharms: [item('deleted'), item('draft-only')],
    }),
    settings: () => ({}),
    orderByTaxonomy: (items) => items,
  })
  vm.runInContext(source, context)
  return {
    setRemote: (value) => { remote = value },
    ids: (kind = 'phone') => Array.from(vm.runInContext(`itemsByType('${kind}')[2].map((item) => item.id)`, context)),
    item,
  }
}

test('live catalogue changes invalidate memoization and never resurrect local drafts or bundled decorations', () => {
  const catalog = catalogHarness()
  catalog.setRemote({ charms: [catalog.item('deleted'), catalog.item('kept')], patches: [catalog.item('patch')] })
  assert.deepEqual(catalog.ids(), ['deleted', 'kept'])
  catalog.setRemote({ charms: [catalog.item('kept')], patches: [] })
  assert.deepEqual(catalog.ids(), ['kept'])
  assert.deepEqual(catalog.ids('tote'), [])
  catalog.setRemote({ charms: [], patches: [] })
  assert.deepEqual(catalog.ids(), [])
})

test('remote visibility overrides apply to managed charms and bundled fallback stays local-only', () => {
  const catalog = catalogHarness()
  assert.ok(catalog.ids().includes('bundled'))
  catalog.setRemote({
    charms: [catalog.item('hidden'), catalog.item('kept')],
    overrides: { charmHidden: { hidden: true } },
  })
  assert.deepEqual(catalog.ids(), ['kept'])
})

test('remote loader bypasses server cache on open and notifies already-open consumers on refresh', async (t) => {
  const urls = []
  let count = 0
  let updates = 0
  const unsubscribe = onRemoteCatalogChange(() => { updates++ })
  t.after(unsubscribe)
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return Response.json({ products: [], charms: count++ ? [] : [{ id: 'match' }], patches: [] })
  })
  assert.equal((await loadRemoteCatalog()).charms.length, 1)
  assert.deepEqual((await loadRemoteCatalog({ fresh: false, preserveOnFailure: true })).charms, [])
  assert.deepEqual(urls, ['/api/catalog?fresh=1', '/api/catalog'])
  assert.equal(updates, 2)
  assert.equal(remoteCatalogFailed(), false)
})

test('production refresh failure retains the last snapshot but blocks checkout until recovery', async () => {
  const source = readFileSync(new URL('./remoteCatalog.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replaceAll('export ', '')
  let fail = false
  const snapshot = { products: [], charms: [{ id: 'kept' }], patches: [] }
  const api = vm.runInNewContext(`${source}\n({loadRemoteCatalog, remoteCatalogFailed, remoteCatalog})`, {
    API_BASE: 'https://api.example', PROD_API_BASE: 'https://api.example',
    fetch: () => {},
    fetchPriceJson: async () => {
      if (fail) throw new Error('Shopify unavailable')
      return snapshot
    },
    setTimeout: (callback) => callback(),
    console: { warn: () => {} },
  })
  await api.loadRemoteCatalog()
  fail = true
  await api.loadRemoteCatalog({ fresh: false, preserveOnFailure: true })
  assert.equal(api.remoteCatalog(), snapshot)
  assert.equal(api.remoteCatalogFailed(), true)
  fail = false
  await api.loadRemoteCatalog({ fresh: false, preserveOnFailure: true })
  assert.equal(api.remoteCatalogFailed(), false)
})

test('admin deletion success requires a fresh catalogue without the deleted id', async () => {
  const source = readFileSync(new URL('../components/AdminPage.jsx', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('  const removeCharm = (c) => modal.confirm'), source.indexOf('  const repriceCharm =', source.indexOf('  const removeCharm = (c) => modal.confirm')))
  let remains = true
  let successes = 0
  let errors = 0
  let draft = { customCharms: [{ id: 'match' }, { id: 'draft' }] }
  const removeCharm = vm.runInNewContext(`${code}\nremoveCharm`, {
    modal: { confirm: (options) => options.onOk() },
    deleteCharm: async () => {},
    refresh: async (options) => {
      assert.equal(options.throwOnError, true)
      return { charms: remains ? [{ id: 'match' }] : [] }
    },
    set: (callback) => { draft = callback(draft) },
    loadAdmin: () => draft,
    saveAdmin: (saved) => { draft = saved },
    message: { success: () => { successes++ }, error: () => { errors++ } },
  })
  await assert.rejects(() => removeCharm({ id: 'match', name: 'Match' }), /still in the live catalogue/)
  assert.equal(successes, 0)
  assert.equal(errors, 1)
  remains = false
  await removeCharm({ id: 'match', name: 'Match' })
  assert.equal(successes, 1)
  assert.deepEqual(draft.customCharms.map((item) => item.id), ['draft'])
})

test('open editor refreshes at 30 seconds and on mobile page return, pruning removed design items', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('    const unsubscribe = onRemoteCatalogChange')
  const stop = source.indexOf('  }, [])', start)
  const events = new Map()
  let refreshes = 0
  let interval
  let notify
  let versions = 0
  const context = {
    document: { visibilityState: 'visible', addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name) },
    window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: (name) => events.delete(name) },
    onRemoteCatalogChange: (callback) => { notify = callback; return () => { notify = null } },
    setCatalogVersion: (callback) => { versions = callback(versions) },
    loadRemoteCatalog: async (options) => { assert.equal(options.fresh, false); refreshes++ },
    setInterval: (callback, delay) => { assert.equal(delay, 30_000); interval = callback; return 1 },
    clearInterval: () => { interval = null },
  }
  const cleanup = vm.runInNewContext(`(() => {${source.slice(start, stop)}})()`, context)
  return (async () => {
    await interval()
    await events.get('pageshow')()
    context.document.visibilityState = 'hidden'
    await events.get('visibilitychange')()
    assert.equal(refreshes, 2)
    notify()
    assert.equal(versions, 1)
    cleanup()
    assert.equal(events.size, 0)
    assert.equal(notify, null)

    const pruneStart = source.indexOf('    if (remoteCatalogFailed() || !remoteCatalog()) return')
    const pruneStop = source.indexOf('  }, [catalogVersion, placed, message])', pruneStart)
    let placed = [{ charmId: 'kept' }, { charmId: 'deleted' }]
    const stash = { current: { front: [], back: [{ charmId: 'hidden' }] } }
    let warnings = 0
    vm.runInNewContext(`(() => {${source.slice(pruneStart, pruneStop)}})()`, {
      remoteCatalogFailed: () => false, remoteCatalog: () => ({}),
      placed, toteSideStash: stash,
      itemById: (id) => id === 'kept',
      setPlaced: (next) => { placed = next },
      message: { warning: () => { warnings++ } },
    })
    assert.deepEqual(placed.map((item) => item.charmId), ['kept'])
    assert.equal(stash.current.back.length, 0)
    assert.equal(warnings, 1)
  })()
})
