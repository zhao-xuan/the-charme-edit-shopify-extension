import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { patchTracking } from '../../scripts/push-live-tracking-fix.mjs'

const local = readFileSync(new URL('../../shopify/snippets/charme-cart-group.liquid', import.meta.url), 'utf8')
const prefix = 'LIVE CSS AND IMAGE RECOVERY\n  function syncEditorMarket(link) { /* fixed-market guard */ }\n\n'
const suffix = '  var floatingButton;\nLIVE CART AND PROOF LOGIC'
const remote = `${prefix}  function syncEditorMarkets() {\n  /* old handoff */\n  }\n${suffix}`

test('tracking deployment preserves all live-only code outside the handoff', () => {
  const patched = patchTracking(remote, local)
  assert.ok(patched.startsWith(prefix))
  assert.ok(patched.endsWith(suffix))
  assert.match(patched, /function syncEditorTracking/)
  assert.match(patched, /window.addEventListener\(type, syncPressedEditorMarket, true\)/)
  assert.match(patched, /consent-tracking-api/)
  assert.equal(patched.includes('old handoff'), false)
  assert.equal(patchTracking(patched, local), patched)
})

test('tracking deployment refuses missing, repeated or reversed boundaries', () => {
  for (const invalid of ['', remote + remote, suffix + '\n  function syncEditorMarkets() {']) {
    assert.throws(() => patchTracking(invalid, local), /marker|boundaries/)
  }
  assert.throws(() => patchTracking(remote, ''), /marker/)
})
