import { json } from '../_lib.js'
import { StudioError, limitWrites, studioDb } from '../_studio.js'
import { allowedOrigin } from '../analytics.js'
import { installedShop, SHOP_DOMAIN } from '../_shopify_install.js'
import { decryptTrackingCredential, TrackingCredentialError } from '../_tracking-credentials.js'
import {
  buildGa4Payload,
  buildMetaPayload,
  normalizeProviderEvent,
  parseProviderCookies,
  providerCookieHeaders,
} from '../../../src/lib/analyticsProviders.js'

const MAX_BODY_BYTES = 8_192
const GRAPH_API_VERSION = 'v27.0'

const corsHeaders = (request) => ({
  'access-control-allow-origin': request.headers.get('origin') || '',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-credentials': 'true',
  vary: 'Origin',
})

function reply(data, status, headers, cookies = []) {
  const response = json(data, { status, headers })
  const responseHeaders = new Headers(response.headers)
  for (const value of cookies) responseHeaders.append('set-cookie', value)
  return new Response(response.body, { status: response.status, headers: responseHeaders })
}

function canPersistDomainCookies(request) {
  try {
    const host = new URL(request.headers.get('origin') || '').hostname.toLowerCase()
    return host === 'thecharmeedit.com' || host.endsWith('.thecharmeedit.com')
  } catch {
    return false
  }
}

async function readLimited(request) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function newGaClientId() {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return `${values[0]}.${values[1]}`
}

async function sendGa4(settings, gaApiSecret, event, clientId) {
  if (!settings?.ga_measurement_id || !gaApiSecret) return 'not_configured'
  const url = new URL('https://www.google-analytics.com/mp/collect')
  url.searchParams.set('measurement_id', settings.ga_measurement_id)
  url.searchParams.set('api_secret', gaApiSecret)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildGa4Payload(event, clientId)),
    signal: AbortSignal.timeout(8_000),
  })
  return response.ok ? null : `http_${response.status}`
}

async function sendMeta(settings, metaAccessToken, request, event, requestedVersion) {
  if (!settings?.meta_pixel_id || !metaAccessToken) return 'not_configured'
  if (!/^\d{5,30}$/.test(settings.meta_pixel_id)) return 'invalid_pixel_id'
  const version = /^v\d{1,2}\.\d$/.test(requestedVersion || '')
    ? requestedVersion
    : GRAPH_API_VERSION
  const url = new URL(`https://graph.facebook.com/${version}/${settings.meta_pixel_id}/events`)
  url.searchParams.set('access_token', metaAccessToken)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildMetaPayload(event, {
      ip: (request.headers.get('CF-Connecting-IP') || '').slice(0, 100),
      userAgent: (request.headers.get('user-agent') || '').slice(0, 500),
    })),
    signal: AbortSignal.timeout(8_000),
  })
  return response.ok ? null : `http_${response.status}`
}

async function sendProvider(name, send) {
  try {
    const error = await send()
    if (error) console.error(`[analytics-event] ${name}: ${error}`)
    return error
  } catch (error) {
    console.error(`[analytics-event] ${name}: ${error?.message || error}`)
    return 'request_failed'
  }
}

export function onRequestOptions({ request, env }) {
  if (!allowedOrigin(request, env)) return new Response(null, { status: 403 })
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(request), 'access-control-max-age': '86400' },
  })
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request, env)) {
    return new Response(JSON.stringify({ error: 'origin not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const headers = corsHeaders(request)
  const text = await readLimited(request)
  if (text === null) return reply({ error: 'body too large' }, 413, headers)
  let raw
  try { raw = JSON.parse(text) } catch { return reply({ error: 'invalid json' }, 400, headers) }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reply({ error: 'invalid event' }, 400, headers)
  }
  if (raw.consent?.analytics === false) {
    const cleared = providerCookieHeaders({ analytics: false, marketing: false }, {}, canPersistDomainCookies(request))
    return reply({ ok: true, cleared: true }, 200, headers, cleared)
  }
  if (raw.consent?.analytics !== true) return reply({ error: 'invalid consent' }, 400, headers)

  const event = normalizeProviderEvent(raw)
  if (!event) return reply({ error: 'invalid event or consent' }, 400, headers)
  const existing = parseProviderCookies(request.headers.get('cookie') || '')
  const ids = {
    gaClientId: existing.gaClientId || event.gaClientId || newGaClientId(),
    fbp: event.fbp || existing.fbp,
    fbc: event.fbc || existing.fbc,
  }
  const cookies = providerCookieHeaders(event, ids, canPersistDomainCookies(request))
  const shop = event.shop || env.SHOPIFY_STORE || ''
  if (!SHOP_DOMAIN.test(shop)) return reply({ error: 'shop is not connected' }, 403, headers)

  let db
  let settings
  try {
    db = await studioDb(env)
    if (shop !== env.SHOPIFY_STORE && !(await installedShop(db, shop))) {
      return reply({ error: 'shop is not connected' }, 403, headers)
    }
    await limitWrites(db, request, shop, 'analytics')
    settings = await db.prepare(
      `SELECT ga_measurement_id, ga_api_secret_enc, meta_pixel_id, meta_access_token_enc
       FROM studio_tracking_settings WHERE shop_id=?`,
    ).bind(shop).first()
  } catch (error) {
    if (error instanceof StudioError) {
      return reply({ error: error.status === 429 ? 'rate limited' : 'analytics storage unavailable' }, error.status, headers)
    }
    console.error('[analytics-event] rate limit unavailable', error?.message)
    return reply({ error: 'analytics storage unavailable' }, 503, headers)
  }

  let gaApiSecret = ''
  let metaAccessToken = ''
  try {
    if (settings?.ga_api_secret_enc) {
      gaApiSecret = await decryptTrackingCredential(settings.ga_api_secret_enc, shop, 'ga4', env)
    }
    if (event.marketing && settings?.meta_access_token_enc) {
      metaAccessToken = await decryptTrackingCredential(settings.meta_access_token_enc, shop, 'meta', env)
    }
  } catch (error) {
    if (error instanceof TrackingCredentialError) {
      console.error('[analytics-event] provider credential decryption failed')
      return reply({ error: 'provider credentials unavailable' }, 503, headers)
    }
    throw error
  }

  const results = await Promise.all([
    sendProvider('ga4', () => sendGa4(settings, gaApiSecret, event, ids.gaClientId)),
    ...(event.marketing ? [sendProvider('meta', () => sendMeta(settings, metaAccessToken, request, event, env.META_GRAPH_API_VERSION))] : []),
  ])
  const providers = { ga4: results[0] ? 'failed' : 'sent' }
  const errors = {}
  if (results[0]) errors.ga4 = results[0]
  if (event.marketing) {
    providers.meta = results[1] ? 'failed' : 'sent'
    if (results[1]) errors.meta = results[1]
  }
  if (Object.keys(errors).length) return reply({ ok: false, providers, errors }, 502, headers, cookies)
  return reply({ ok: true, providers }, 200, headers, cookies)
}
