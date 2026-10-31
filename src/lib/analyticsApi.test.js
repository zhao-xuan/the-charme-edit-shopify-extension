import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedOrigin, normalizeAnalyticsSession } from '../../functions/api/analytics.js'

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
test('analytics ingestion stores a bounded attribution summary and nothing a forger adds', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z')
  const base = { sessionId: 'session_12345678', startedAt: '2026-09-26T11:00:00.000Z' }
  const record = normalizeAnalyticsSession({
    ...base,
    attribution: {
      source: 'Instagram', medium: 'paid_social', clickIds: ['fbclid', 'password'],
      landingPath: '/products/case?gclid=SECRET', email: 'must-not-be-stored@example.com',
    },
  }, now)

  assert.deepEqual(record.attribution, {
    source: 'instagram', medium: 'paid_social', campaign: '', clickIds: ['fbclid'],
    referrerHost: '', landingPath: '/products/case',
  })
  assert.equal(JSON.stringify(record).includes('SECRET'), false)
  assert.equal(JSON.stringify(record).includes('must-not-be-stored'), false)
  for (const attribution of [undefined, null, 'x', [], {}]) {
    assert.equal(normalizeAnalyticsSession({ ...base, attribution }, now).attribution, null)
  }
})

test('the analytics origin allow-list covers the storefront, designer and previews only', () => {
  const request = (origin) => new Request('https://design.thecharmeedit.com/api/analytics/confirm', { headers: origin ? { origin } : {} })
  for (const origin of ['https://thecharmeedit.com', 'https://design.thecharmeedit.com', 'https://charme.myshopify.com', 'https://abc.charme-customizer.pages.dev']) {
    assert.equal(allowedOrigin(request(origin), {}), true, origin)
  }
  for (const origin of ['https://evilthecharmeedit.com', 'https://thecharmeedit.com.evil.test', 'https://example.com', 'null', '']) {
    assert.equal(allowedOrigin(request(origin), {}), false, origin)
  }
  assert.equal(allowedOrigin(request('https://partner.example'), { ANALYTICS_ALLOWED_ORIGINS: 'https://partner.example' }), true)
})
