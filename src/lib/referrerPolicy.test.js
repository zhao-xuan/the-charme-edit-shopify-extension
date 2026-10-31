import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EDITOR_REFERRER_POLICY, applyReferrerPolicy } from './referrerPolicy.js'

function fakeDocument() {
  const children = []
  return {
    children,
    head: { appendChild: (node) => children.push(node) },
    createElement: (tag) => ({ tag, name: '', content: '', remove() { children.splice(children.indexOf(this), 1) } }),
  }
}

test('the editor sends no referrer to other sites', () => {
  assert.equal(EDITOR_REFERRER_POLICY, 'same-origin')
})

test('a referrer meta tag is added and removed again', () => {
  const doc = fakeDocument()
  const undo = applyReferrerPolicy(doc)
  assert.deepEqual(doc.children.map(({ tag, name, content }) => ({ tag, name, content })), [{ tag: 'meta', name: 'referrer', content: 'same-origin' }])
  undo()
  assert.equal(doc.children.length, 0)
})

test('a missing document is ignored', () => {
  assert.equal(typeof applyReferrerPolicy(null), 'function')
  assert.doesNotThrow(() => applyReferrerPolicy({}, 'no-referrer')())
})

// Cloudflare Pages reads these rules; the customer routes must carry the policy
// and the embedded admin app must stay out of it.
test('the customer editor and studio routes are served with the policy, the admin routes are not', async () => {
  const text = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8')
  const rules = new Map()
  let path = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      path = line.trim()
      rules.set(path, [])
    } else if (path) {
      rules.get(path).push(line.trim())
    }
  }
  for (const route of ['/', '/editor', '/editor/*', '/studio', '/studio/*']) {
    assert.ok(rules.get(route)?.includes('Referrer-Policy: same-origin'), `${route} needs the referrer policy`)
  }
  for (const route of ['/admin', '/shopify', '/shopify/*', '/*']) {
    assert.ok(!rules.get(route)?.some((value) => /^Referrer-Policy/i.test(value)), `${route} must not change the referrer policy`)
  }
  assert.ok(rules.get('/admin').some((value) => value.startsWith('Content-Security-Policy: frame-ancestors')), 'the admin frame rule is kept')
})
