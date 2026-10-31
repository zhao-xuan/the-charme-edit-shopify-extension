import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ANALYTICS_WITHOUT_SIGNAL,
  UNATTRIBUTED_LABEL,
  attributionLabel,
  decodeAttribution,
  isInternalHost,
  orderSourceLabel,
  readTrackingContext,
  sanitizeAttribution,
} from './trackingContext.js'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

test('without a consent signal the designer records nothing by default', () => {
  assert.equal(DEFAULT_ANALYTICS_WITHOUT_SIGNAL, false)
  assert.deepEqual(readTrackingContext(''), { analytics: false, marketing: false, signal: false, attribution: null })
  assert.equal(readTrackingContext('?ca=maybe').analytics, false)
})

test('the storefront consent decision travels in the link', () => {
  assert.deepEqual(
    readTrackingContext(`?ca=1&cm=1&attr=${encode({ source: 'Instagram', medium: 'paid_social' })}`).attribution,
    { source: 'instagram', medium: 'paid_social', campaign: '', clickIds: [], referrerHost: '', landingPath: '' },
  )
  const analyticsOnly = readTrackingContext(`?ca=1&cm=0&attr=${encode({ source: 'google' })}`)
  assert.equal(analyticsOnly.analytics, true)
  assert.equal(analyticsOnly.marketing, false)
  assert.equal(analyticsOnly.attribution, null, 'campaign data needs marketing consent')
  const declined = readTrackingContext(`?ca=0&cm=1&attr=${encode({ source: 'google' })}`)
  assert.equal(declined.analytics, false)
  assert.equal(declined.marketing, false)
  assert.equal(declined.attribution, null)
})

test('an in-page designer reads Shopify Customer Privacy when the link has no signal', () => {
  const allowed = { analyticsProcessingAllowed: () => true, marketingAllowed: () => false }
  assert.deepEqual(readTrackingContext('', allowed), { analytics: true, marketing: false, signal: true, attribution: null })
  assert.equal(readTrackingContext('', { analyticsProcessingAllowed: () => false }).analytics, false)
  assert.equal(readTrackingContext('', { analyticsProcessingAllowed: () => { throw new Error('blocked') } }).analytics, false)
  assert.equal(readTrackingContext('?ca=0', allowed).analytics, false, 'an explicit link decision wins')
})

test('attribution is bounded, lower-cased and free of query strings or click-id values', () => {
  const clean = sanitizeAttribution({
    source: ' Google ', medium: 'CPC', campaign: 'Spring Sale <script>alert(1)</script>',
    clickIds: ['GCLID', 'gclid', 'password', 'fbclid'],
    referrerHost: 'WWW.Google.com',
    landingPath: '/products/custom-charm-phone-case?utm_source=x&gclid=SECRET#frag',
    email: 'nobody@example.com',
  })
  assert.deepEqual(clean, {
    source: 'google', medium: 'cpc', campaign: 'spring sale scriptalert(1)/script',
    clickIds: ['gclid', 'fbclid'], referrerHost: 'google.com',
    landingPath: '/products/custom-charm-phone-case',
  })
  assert.equal(JSON.stringify(clean).includes('SECRET'), false)
  assert.equal('email' in clean, false)
  assert.equal(sanitizeAttribution({ source: 'x'.repeat(500) }).source.length, 60)
})

test('attribution ignores internal hosts, private pages and empty input', () => {
  for (const referrerHost of ['design.thecharmeedit.com', 'thecharmeedit.com', 'abc.myshopify.com', 'charme-customizer.pages.dev', 'checkout.shopify.com', 'paypal.com']) {
    assert.equal(isInternalHost(referrerHost), true)
    assert.equal(sanitizeAttribution({ referrerHost }), null)
  }
  assert.equal(isInternalHost('notthecharmeedit.com'), false)
  assert.equal(sanitizeAttribution({ source: 'a', landingPath: '/orders/abc/authenticate?key=1' }).landingPath, '/')
  assert.equal(sanitizeAttribution({ source: 'a', landingPath: '/account/login' }).landingPath, '/')
  for (const empty of [null, undefined, 'string', [], {}, { clickIds: ['nope'] }]) assert.equal(sanitizeAttribution(empty), null)
  assert.equal(decodeAttribution('!!!'), null)
  assert.equal(decodeAttribution(encode('not an object')), null)
  assert.equal(decodeAttribution('a'.repeat(2001)), null)
})

test('one readable source per session: UTM, then ad click id, then referrer', () => {
  assert.equal(attributionLabel({ source: 'Facebook', medium: 'paid_social' }), 'facebook / paid_social')
  assert.equal(attributionLabel({ source: 'newsletter' }), 'newsletter / (not set)')
  assert.equal(attributionLabel({ medium: 'email' }), '(not set) / email')
  assert.equal(attributionLabel({ campaign: 'summer' }), '(not set) / (not set) / summer')
  assert.equal(attributionLabel({ clickIds: ['gclid'] }), 'google / gclid')
  assert.equal(attributionLabel({ clickIds: ['fbclid', 'gclid'] }), 'facebook / fbclid')
  assert.equal(attributionLabel({ referrerHost: 'www.google.co.uk' }), 'google / organic')
  assert.equal(attributionLabel({ referrerHost: 'l.instagram.com' }), 'instagram / referral')
  assert.equal(attributionLabel({ referrerHost: 'blog.example.org' }), 'blog.example.org / referral')
  assert.equal(attributionLabel(null), UNATTRIBUTED_LABEL)
  assert.equal(attributionLabel({ referrerHost: 'design.thecharmeedit.com' }), UNATTRIBUTED_LABEL)
})

test("order source label mirrors Shopify's recorded UTM tags and referring host", () => {
  assert.equal(orderSourceLabel({ utmSource: 'google', utmMedium: 'cpc' }), 'google / cpc')
  assert.equal(orderSourceLabel({ referringHost: 'design.thecharmeedit.com' }), 'design.thecharmeedit.com / referral')
  assert.equal(orderSourceLabel({}), '(direct / none)')
})
