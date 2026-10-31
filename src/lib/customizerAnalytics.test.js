import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomizerAnalytics } from './customizerAnalytics.js'

test('tracks active decoration time and checkout funnel without personal data', () => {
  let time = Date.parse('2026-09-26T10:00:00.000Z')
  const tracker = createCustomizerAnalytics({ now: () => time, enabled: false, windowRef: null, documentRef: null })
  tracker.updateContext({ productId: 'tote-olive', productKind: 'tote', finalDecorationCount: 0 })
  time += 5_000
  tracker.track('decoration_add', { id: 'patch-a', name: 'Letter A' })
  tracker.updateContext({ finalDecorationCount: 1 })
  time += 12_000
  tracker.track('summary_viewed')
  tracker.track('purchase_clicked')
  tracker.track('checkout_succeeded')

  const record = tracker.snapshot()
  assert.equal(record.activeMs, 17_000)
  assert.equal(record.decorationActiveMs, 12_000)
  assert.equal(record.decorationAdds, 1)
  assert.equal(record.decorationSelections['patch-a'], 1)
  assert.equal(record.purchaseClicked, true)
  assert.equal(record.checkoutSucceeded, true)
  assert.equal('email' in record, false)
})

test('counts a drag as one move during a burst of pointer updates', () => {
  let time = 1000
  const tracker = createCustomizerAnalytics({ now: () => time, enabled: false, windowRef: null, documentRef: null })
  tracker.track('decoration_move')
  time += 100
  tracker.track('decoration_move')
  time += 800
  tracker.track('decoration_move')
  assert.equal(tracker.snapshot().decorationMoves, 2)
})

function consentHarness(options) {
  const sent = []
  const win = { location: { hostname: 'design.thecharmeedit.com' }, innerWidth: 1280, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} }
  const tracker = createCustomizerAnalytics({
    windowRef: win, documentRef: null, endpoint: 'https://example.test/api/analytics',
    fetchImpl: async (url, request) => { sent.push({ url, body: JSON.parse(request.body) }); return { ok: true } },
    ...options,
  })
  return { tracker, sent }
}

test('records nothing and exposes no session link without analytics consent', async () => {
  const { tracker, sent } = consentHarness({ consent: { analytics: false } })
  tracker.start({ productId: 'tote-olive' })
  tracker.track('decoration_add', { id: 'patch-a' })
  assert.equal(await tracker.flush(true), false)
  tracker.stop()
  assert.equal(sent.length, 0)
  assert.equal(tracker.link(), null)
})

test('consented sessions carry sanitized attribution and expose their id for cart confirmation', async () => {
  const { tracker, sent } = consentHarness({
    consent: { analytics: true },
    attribution: { source: 'Instagram', medium: 'paid_social', clickIds: ['FBCLID', 'secret'], email: 'nobody@example.com' },
  })
  tracker.start({ productId: 'tote-olive' })
  await tracker.flush(true)
  tracker.stop()
  assert.ok(sent.length >= 1)
  assert.deepEqual(sent[0].body.attribution, {
    source: 'instagram', medium: 'paid_social', campaign: '', clickIds: ['fbclid'], referrerHost: '', landingPath: '',
  })
  assert.equal('email' in sent[0].body.attribution, false)
  assert.equal(tracker.link().sessionId, sent[0].body.sessionId)
})

test('analytics stays on for callers that supply no consent, and off for localhost', () => {
  assert.equal(consentHarness({}).tracker.link() !== null, true)
  const local = createCustomizerAnalytics({ windowRef: { location: { hostname: 'localhost' } }, documentRef: null })
  assert.equal(local.link(), null)
})
