import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOrderAttribution, designTokensOf, MAX_ORDER_DESIGN_TOKENS } from './orderAttribution.js'

const NOW = Date.parse('2026-06-10T12:00:00Z')

const order = (overrides = {}) => ({
  id: 5550001112223,
  name: '#1042',
  processed_at: '2026-06-09T18:30:00+01:00',
  currency: 'gbp',
  total_price: '47.98',
  test: false,
  source_name: 'web',
  landing_site: '/products/custom-charm-phone-case?utm_source=Instagram&utm_medium=paid_social&utm_campaign=Summer_Case&fbclid=SECRET-CLICK-ID',
  referring_site: 'https://www.instagram.com/',
  email: 'buyer@example.com',
  phone: '+44 7700 900000',
  customer: { id: 99, email: 'buyer@example.com', first_name: 'Ada', last_name: 'Lovelace' },
  billing_address: { name: 'Ada Lovelace', address1: '1 Analytical Way', zip: 'N1 1AA' },
  shipping_address: { name: 'Ada Lovelace', address1: '1 Analytical Way', zip: 'N1 1AA' },
  browser_ip: '203.0.113.9',
  line_items: [
    { id: 1, title: 'Custom phone case', properties: [{ name: '_design_token', value: 'cd_ylh7pg6g' }, { name: '_layout', value: '{"charms":[]}' }] },
    { id: 2, title: 'Charm', properties: [{ name: '_design_token', value: 'cd_ylh7pg6g' }, { name: '_role', value: 'charm' }] },
    { id: 3, title: 'Tote', properties: [{ name: '_design_token', value: 'cd_second-1' }] },
  ],
  ...overrides,
})

test('a paid designer order keeps only non-personal attribution facts', () => {
  const summary = extractOrderAttribution(order(), NOW)
  assert.deepEqual(summary, {
    orderId: '5550001112223',
    orderName: '#1042',
    paidAt: '2026-06-09T17:30:00.000Z',
    currency: 'GBP',
    total: 47.98,
    isTest: false,
    sourceName: 'web',
    utmSource: 'instagram',
    utmMedium: 'paid_social',
    utmCampaign: 'summer_case',
    referringHost: 'instagram.com',
    designTokens: ['cd_ylh7pg6g', 'cd_second-1'],
  })
  const serialized = JSON.stringify(summary)
  for (const secret of ['buyer@example.com', 'Lovelace', 'Analytical', 'N1 1AA', '203.0.113.9', '44 7700', 'SECRET-CLICK-ID', '_layout']) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be kept`)
  }
})

test('orders without a design token are not designer orders', () => {
  assert.equal(extractOrderAttribution(order({ line_items: [{ id: 1, properties: [{ name: 'Gift note', value: 'hi' }] }] }), NOW), null)
  assert.equal(extractOrderAttribution(order({ line_items: [{ id: 1, properties: [] }, { id: 2 }] }), NOW), null)
  assert.equal(extractOrderAttribution(order({ line_items: undefined }), NOW), null)
})

test('an order without a usable numeric id cannot be deduplicated and is ignored', () => {
  for (const id of [undefined, null, '', 'abc', 'gid://shopify/Order/1', '1'.repeat(30)]) {
    assert.equal(extractOrderAttribution(order({ id }), NOW), null, String(id))
  }
})

test('design tokens are validated, deduplicated and bounded', () => {
  const properties = (values) => [{ properties: values.map((value) => ({ name: '_design_token', value })) }]
  assert.deepEqual(designTokensOf({ line_items: properties(['ok_1', 'ok_1', '../bad', '', 'has space', 'x'.repeat(129), 'ok-2']) }), ['ok_1', 'ok-2'])
  const many = Array.from({ length: 80 }, (_, i) => `d${i}`)
  assert.equal(designTokensOf({ line_items: properties(many) }).length, MAX_ORDER_DESIGN_TOKENS)
  assert.deepEqual(designTokensOf({ line_items: [{ properties: [{ name: '_Design_Token', value: 'nope' }] }] }), [])
  assert.deepEqual(designTokensOf(null), [])
})

test('shopify source facts are optional and tolerate hostile values', () => {
  const bare = extractOrderAttribution(order({ landing_site: null, referring_site: '', source_name: undefined, currency: 'pounds', total_price: 'free', processed_at: 'not a date', created_at: undefined, name: undefined, test: 'true' }), NOW)
  assert.equal(bare.utmSource, '')
  assert.equal(bare.utmMedium, '')
  assert.equal(bare.referringHost, '')
  assert.equal(bare.sourceName, '')
  assert.equal(bare.currency, '')
  assert.equal(bare.total, 0)
  assert.equal(bare.paidAt, new Date(NOW).toISOString(), 'falls back to the receive time')
  assert.equal(bare.orderName, '')
  assert.equal(bare.isTest, false, 'only a real boolean marks a test order')

  const hostile = extractOrderAttribution(order({
    landing_site: 'http://[bad/?utm_source=' + 'a'.repeat(500) + '&utm_medium=%3Cscript%3E',
    referring_site: 'javascript:alert(1)',
    source_name: 'WEB<script>',
  }), NOW)
  assert.ok(hostile.utmSource.length <= 60)
  assert.equal(hostile.referringHost, '')
  assert.equal(hostile.sourceName, 'webscript')
})

test('the recorded referrer keeps the designer domain, which is the evidence of a stolen source', () => {
  const summary = extractOrderAttribution(order({ referring_site: 'https://design.thecharmeedit.com/editor/?product=x', landing_site: '/' }), NOW)
  assert.equal(summary.referringHost, 'design.thecharmeedit.com')
  assert.equal(summary.utmSource, '')
})

test('test orders are flagged so reports can exclude them', () => {
  assert.equal(extractOrderAttribution(order({ test: true }), NOW).isTest, true)
})
