import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGa4Payload,
  buildMetaPayload,
  normalizeProviderEvent,
  parseProviderCookies,
  providerCookieHeaders,
} from './analyticsProviders.js'
import { onRequestOptions, onRequestPost } from '../../functions/api/analytics/event.js'
import { encryptTrackingCredential } from '../../functions/api/_tracking-credentials.js'

const now = Date.parse('2026-11-05T12:00:00.000Z')
const eventBody = (overrides = {}) => ({
  sessionId: 'session-12345',
  shop: 'example.myshopify.com',
  event: 'decoration_add',
  eventId: 'session-12345.decoration_add.1',
  eventTime: now,
  startedAt: new Date(now - 30_000).toISOString(),
  consent: { analytics: true, marketing: true },
  attribution: { source: 'Instagram', medium: 'paid_social', campaign: 'winter' },
  identifiers: {
    gaClientId: '123456789.987654321',
    fbp: 'fb.1.1730000000000.abc123',
    fbc: 'fb.1.1730000000000.xyz789',
  },
  eventSourceUrl: 'https://design.thecharmeedit.com/editor?ga=123456789.987654321',
  productKind: 'tote',
  ...overrides,
})
const liveEventBody = (overrides = {}) => eventBody({
  eventTime: Date.now(),
  startedAt: new Date(Date.now() - 30_000).toISOString(),
  ...overrides,
})

function mockDb(settings = null, installed = true) {
  return {
    async batch() {},
    prepare(sql) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async run() { return { meta: { changes: 1 } } },
        async first() {
          if (sql.includes('shopify_installations')) return installed ? { shop_id: params[0] } : null
          if (sql.includes('studio_tracking_settings')) return settings
          return null
        },
      }
    },
  }
}

test('accepts a fresh allowlisted event and strips sensitive URL query data', () => {
  const event = normalizeProviderEvent(eventBody(), now)
  assert.ok(event)
  assert.equal(event.eventSourceUrl, 'https://design.thecharmeedit.com/editor')
  assert.equal(event.attribution.source, 'instagram')
  assert.equal(event.gaClientId, '123456789.987654321')
})

test('rejects missing analytics consent, unknown events, old events, and untrusted URLs', () => {
  assert.equal(normalizeProviderEvent(eventBody({ consent: { analytics: false, marketing: false } }), now), null)
  assert.equal(normalizeProviderEvent(eventBody({ event: 'purchase' }), now), null)
  assert.equal(normalizeProviderEvent(eventBody({ eventTime: now - 6 * 60_000 }), now), null)
  assert.equal(normalizeProviderEvent(eventBody({ eventSourceUrl: 'https://attacker.example/editor' }), now), null)
  assert.equal(normalizeProviderEvent(eventBody({ shop: 'attacker.example' }), now), null)
})

test('marketing identifiers and attribution are omitted without marketing consent', () => {
  const event = normalizeProviderEvent(eventBody({
    consent: { analytics: true, marketing: false },
  }), now)
  assert.ok(event)
  assert.equal(event.marketing, false)
  assert.equal(event.attribution, null)
  assert.equal(event.fbp, '')
  assert.equal(event.fbc, '')
})

test('GA4 payload uses consent state and does not receive marketing attribution without consent', () => {
  const event = normalizeProviderEvent(eventBody({ consent: { analytics: true, marketing: false } }), now)
  const payload = buildGa4Payload(event, '123456789.987654321')
  assert.equal(payload.consent.ad_user_data, 'DENIED')
  assert.equal(payload.events[0].params.source, undefined)
  assert.equal(payload.events[0].params.session_id, Math.floor((now - 30_000) / 1000))
})

test('Meta payload uses stable event ID and only consented marketing data', () => {
  const event = normalizeProviderEvent(eventBody(), now)
  const payload = buildMetaPayload(event, { ip: '192.0.2.1', userAgent: 'test-agent' })
  assert.equal(payload.data[0].event_name, 'DecorationAdded')
  assert.equal(payload.data[0].event_id, 'session-12345.decoration_add.1')
  assert.equal(payload.data[0].user_data.fbp, 'fb.1.1730000000000.abc123')
  assert.equal(payload.data[0].custom_data.source, 'instagram')
})

test('provider cookies are consent-scoped and malformed cookie IDs are ignored', () => {
  const event = normalizeProviderEvent(eventBody(), now)
  const ids = parseProviderCookies('ce_ga=123456789.987654321; ce_fbp=invalid')
  assert.equal(ids.gaClientId, '123456789.987654321')
  assert.equal(ids.fbp, '')
  const cookies = providerCookieHeaders(event, ids, true)
  assert.ok(cookies.some((value) => value.startsWith('ce_ga=')))
  assert.ok(cookies.some((value) => value.startsWith('ce_attr=')))
  assert.ok(cookies.every((value) => value.includes('Domain=.thecharmeedit.com')))

  const revoked = providerCookieHeaders({ analytics: false, marketing: false }, {}, true)
  assert.equal(revoked.length, 4)
  assert.ok(revoked.every((value) => value.includes('Max-Age=0')))
})

test('event endpoint only accepts approved origins and clears cookies when analytics consent is withdrawn', async () => {
  const forbidden = await onRequestPost({
    request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ consent: { analytics: false } }),
    }),
    env: {},
  })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.headers.get('access-control-allow-origin'), null)

  const revoked = await onRequestPost({
    request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
      method: 'POST',
      headers: { origin: 'https://design.thecharmeedit.com', 'content-type': 'application/json' },
      body: JSON.stringify({ consent: { analytics: false } }),
    }),
    env: {},
  })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.headers.get('access-control-allow-origin'), 'https://design.thecharmeedit.com')
  assert.equal(revoked.headers.get('access-control-allow-credentials'), 'true')
  assert.match(revoked.headers.get('set-cookie'), /ce_ga=.*Max-Age=0/)

  const missingConsent = await onRequestPost({
    request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
      method: 'POST',
      headers: { origin: 'https://design.thecharmeedit.com', 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'decoration_add' }),
    }),
    env: {},
  })
  assert.equal(missingConsent.status, 400)
})

test('event preflight reflects only an approved origin', () => {
  const allowed = onRequestOptions({
    request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
      method: 'OPTIONS',
      headers: { origin: 'https://design.thecharmeedit.com' },
    }),
    env: {},
  })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://design.thecharmeedit.com')
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
})

test('event endpoint forwards consented events to GA4 using server credentials', async () => {
  const originalFetch = globalThis.fetch
  const encryptionKey = Buffer.alloc(32, 7).toString('base64')
  const gaApiSecretEnc = await encryptTrackingCredential('ga-secret-test-value', 'example.myshopify.com', 'ga4', {
    TRACKING_CREDENTIALS_KEY: encryptionKey,
  })
  let requestUrl
  let requestBody
  globalThis.fetch = async (url, options) => {
    requestUrl = new URL(url)
    requestBody = JSON.parse(options.body)
    return new Response(null, { status: 204 })
  }
  try {
    const response = await onRequestPost({
      request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
        method: 'POST',
        headers: {
          origin: 'https://design.thecharmeedit.com',
          'content-type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        body: JSON.stringify(liveEventBody({ consent: { analytics: true, marketing: false } })),
      }),
      env: {
        DB: mockDb({ ga_measurement_id: 'G-TEST123', ga_api_secret_enc: gaApiSecretEnc }, false),
        SHOPIFY_STORE: 'example.myshopify.com',
        TRACKING_CREDENTIALS_KEY: encryptionKey,
      },
    })
    assert.equal(response.status, 200)
    assert.equal(requestUrl.hostname, 'www.google-analytics.com')
    assert.equal(requestUrl.searchParams.get('api_secret'), 'ga-secret-test-value')
    assert.equal(requestBody.client_id, '123456789.987654321')
    assert.equal(requestBody.events[0].name, 'decoration_added')
    assert.equal(requestBody.consent.ad_user_data, 'DENIED')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Meta forwarding is marketing-consent gated and uses the configured Graph API version', async () => {
  const originalFetch = globalThis.fetch
  const encryptionKey = Buffer.alloc(32, 7).toString('base64')
  const [gaApiSecretEnc, metaAccessTokenEnc] = await Promise.all([
    encryptTrackingCredential('ga-secret-test-value', 'example.myshopify.com', 'ga4', {
      TRACKING_CREDENTIALS_KEY: encryptionKey,
    }),
    encryptTrackingCredential('meta-token-test-value', 'example.myshopify.com', 'meta', {
      TRACKING_CREDENTIALS_KEY: encryptionKey,
    }),
  ])
  let requestUrl
  let requestBody
  globalThis.fetch = async (url, options) => {
    requestUrl = new URL(url)
    requestBody = JSON.parse(options.body)
    return Response.json({ events_received: 1 })
  }
  try {
    const response = await onRequestPost({
      request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
        method: 'POST',
        headers: {
          origin: 'https://design.thecharmeedit.com',
          'content-type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
          'user-agent': 'test-agent',
        },
        body: JSON.stringify(liveEventBody()),
      }),
      env: {
        DB: mockDb({
          ga_measurement_id: 'G-TEST123',
          ga_api_secret_enc: gaApiSecretEnc,
          meta_pixel_id: '123456789012345',
          meta_access_token_enc: metaAccessTokenEnc,
        }),
        TRACKING_CREDENTIALS_KEY: encryptionKey,
      },
    })
    assert.equal(response.status, 200)
    assert.equal(requestUrl.pathname, '/v27.0/123456789012345/events')
    assert.equal(requestUrl.searchParams.get('access_token'), 'meta-token-test-value')
    assert.equal(requestBody.data[0].event_name, 'DecorationAdded')
    assert.equal(requestBody.data[0].user_data.client_ip_address, '192.0.2.1')
    assert.equal(requestBody.data[0].user_data.client_user_agent, 'test-agent')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider configuration failures are surfaced rather than acknowledged as successful sends', async () => {
  const response = await onRequestPost({
    request: new Request('https://design.thecharmeedit.com/api/analytics/event', {
      method: 'POST',
      headers: {
        origin: 'https://design.thecharmeedit.com',
        'content-type': 'application/json',
        'CF-Connecting-IP': '192.0.2.1',
      },
      body: JSON.stringify(liveEventBody({ consent: { analytics: true, marketing: false } })),
    }),
    env: { DB: mockDb() },
  })
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), {
    ok: false,
    providers: { ga4: 'failed' },
    errors: { ga4: 'not_configured' },
  })
})
