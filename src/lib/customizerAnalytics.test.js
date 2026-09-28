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
