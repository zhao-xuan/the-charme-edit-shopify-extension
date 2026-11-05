import { ANALYTICS_EVENTS, validGaClientId, validMetaCookie } from './analyticsEvents.js'
import { sanitizeAttribution } from './trackingContext.js'

const SESSION_ID = /^[A-Za-z0-9_-]{8,80}$/
const EVENT_ID = /^[A-Za-z0-9._:-]{8,160}$/
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/
const EVENT_SOURCE_HOSTS = [
  'thecharmeedit.com',
  'charme-customizer.pages.dev',
]
const MAX_EVENT_AGE_MS = 5 * 60_000
const COOKIE_AGE_SECONDS = 90 * 24 * 60 * 60

const hostMatches = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`)

function safeEventSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return ''
    if (!EVENT_SOURCE_HOSTS.some((host) => hostMatches(url.hostname.toLowerCase(), host))
      && !['localhost', '127.0.0.1'].includes(url.hostname)) return ''
    return `${url.origin}${url.pathname.slice(0, 512)}`
  } catch {
    return ''
  }
}

export function normalizeProviderEvent(raw, now = Date.now()) {
  const consent = raw?.consent
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || consent?.analytics !== true
    || !SESSION_ID.test(String(raw.sessionId || ''))
    || !EVENT_ID.test(String(raw.eventId || ''))
    || (raw.shop != null && !SHOP_DOMAIN.test(String(raw.shop).toLowerCase()))
    || !Object.hasOwn(ANALYTICS_EVENTS, raw.event)) return null

  const eventTime = Number(raw.eventTime)
  if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > MAX_EVENT_AGE_MS) return null
  const startedAt = Date.parse(raw.startedAt)
  if (!Number.isFinite(startedAt) || startedAt > eventTime + 60_000) return null
  const eventSourceUrl = safeEventSourceUrl(raw.eventSourceUrl)
  if (!eventSourceUrl) return null

  const marketing = consent.marketing === true
  const attribution = marketing ? sanitizeAttribution(raw.attribution) : null
  return {
    sessionId: raw.sessionId,
    shop: typeof raw.shop === 'string' ? raw.shop.toLowerCase() : '',
    event: raw.event,
    eventId: raw.eventId,
    eventTime: Math.floor(eventTime / 1000),
    startedAt: Math.floor(startedAt / 1000),
    analytics: true,
    marketing,
    attribution,
    gaClientId: validGaClientId(raw.identifiers?.gaClientId) ? raw.identifiers.gaClientId : '',
    fbp: marketing && validMetaCookie(raw.identifiers?.fbp, 'fb.1.') ? raw.identifiers.fbp : '',
    fbc: marketing && validMetaCookie(raw.identifiers?.fbc, 'fb.1.') ? raw.identifiers.fbc : '',
    eventSourceUrl,
    productKind: ['phone', 'tote', 'frame'].includes(raw.productKind) ? raw.productKind : 'unknown',
  }
}

export function parseProviderCookies(header = '') {
  const cookies = {}
  for (const item of String(header).split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0) continue
    const key = item.slice(0, separator).trim()
    if (!['ce_ga', 'ce_fbp', 'ce_fbc'].includes(key)) continue
    try { cookies[key] = decodeURIComponent(item.slice(separator + 1).trim()) } catch {}
  }
  return {
    gaClientId: validGaClientId(cookies.ce_ga) ? cookies.ce_ga : '',
    fbp: validMetaCookie(cookies.ce_fbp, 'fb.1.') ? cookies.ce_fbp : '',
    fbc: validMetaCookie(cookies.ce_fbc, 'fb.1.') ? cookies.ce_fbc : '',
  }
}

function encodeAttribution(attribution) {
  const bytes = new TextEncoder().encode(JSON.stringify(attribution))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Domain=.thecharmeedit.com; SameSite=Lax; Secure`
}

export function providerCookieHeaders(event, ids, persistOnDomain) {
  if (!persistOnDomain) return []
  const headers = []
  if (!event.analytics) {
    headers.push(cookie('ce_ga', '', 0))
  } else if (ids.gaClientId) {
    headers.push(cookie('ce_ga', ids.gaClientId, COOKIE_AGE_SECONDS))
  }

  if (!event.marketing) {
    headers.push(cookie('ce_attr', '', 0), cookie('ce_fbp', '', 0), cookie('ce_fbc', '', 0))
  } else {
    if (event.attribution) headers.push(cookie('ce_attr', encodeAttribution(event.attribution), COOKIE_AGE_SECONDS))
    if (ids.fbp) headers.push(cookie('ce_fbp', ids.fbp, COOKIE_AGE_SECONDS))
    if (ids.fbc) headers.push(cookie('ce_fbc', ids.fbc, COOKIE_AGE_SECONDS))
  }
  return headers
}

export function buildGa4Payload(event, clientId) {
  const params = {
    session_id: event.startedAt,
    engagement_time_msec: 1,
    page_location: event.eventSourceUrl,
    product_kind: event.productKind,
  }
  if (event.attribution?.source) params.source = event.attribution.source
  if (event.attribution?.medium) params.medium = event.attribution.medium
  if (event.attribution?.campaign) params.campaign = event.attribution.campaign
  return {
    client_id: clientId,
    consent: {
      ad_user_data: event.marketing ? 'GRANTED' : 'DENIED',
      ad_personalization: event.marketing ? 'GRANTED' : 'DENIED',
    },
    events: [{
      name: ANALYTICS_EVENTS[event.event].ga4,
      params,
    }],
  }
}

export function buildMetaPayload(event, requestInfo = {}) {
  const userData = {}
  if (event.fbp) userData.fbp = event.fbp
  if (event.fbc) userData.fbc = event.fbc
  if (requestInfo.ip) userData.client_ip_address = requestInfo.ip
  if (requestInfo.userAgent) userData.client_user_agent = requestInfo.userAgent
  const customData = { content_category: event.productKind }
  if (event.attribution?.source) customData.source = event.attribution.source
  if (event.attribution?.medium) customData.medium = event.attribution.medium
  if (event.attribution?.campaign) customData.campaign = event.attribution.campaign
  return {
    data: [{
      event_name: ANALYTICS_EVENTS[event.event].meta,
      event_time: event.eventTime,
      event_id: event.eventId,
      action_source: 'website',
      event_source_url: event.eventSourceUrl,
      user_data: userData,
      custom_data: customData,
    }],
  }
}
