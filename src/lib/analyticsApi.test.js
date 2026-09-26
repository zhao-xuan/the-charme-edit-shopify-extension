import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalyticsSession } from '../../functions/api/analytics.js'

test('analytics ingestion keeps only bounded non-personal session fields', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z')
  const record = normalizeAnalyticsSession({
    sessionId: 'session_12345678',
    startedAt: '2026-09-26T11:00:00.000Z',
    lastSeenAt: '2026-09-26T11:10:00.000Z',
    activeMs: 600_000,
    decorationActiveMs: 700_000,
    productKind: 'tote',
    purchaseClicked: true,
    checkoutSucceeded: false,
    decorationSelections: { patch_a: 2 },
    decorationNames: { patch_a: 'Letter A' },
    email: 'must-not-be-stored@example.com',
  }, now)

  assert.equal(record.decorationActiveMs, 600_000)
  assert.equal(record.purchaseClicked, true)
  assert.deepEqual(record.decorationSelections, { patch_a: 2 })
  assert.equal(record.decorationStartedAt, null)
  assert.equal('email' in record, false)
})

test('analytics ingestion rejects invalid session ids and future starts', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z')
  assert.equal(normalizeAnalyticsSession({ sessionId: 'bad', startedAt: new Date(now).toISOString() }, now), null)
  assert.equal(normalizeAnalyticsSession({
    sessionId: 'session_12345678',
    startedAt: new Date(now + 600_000).toISOString(),
  }, now), null)
})