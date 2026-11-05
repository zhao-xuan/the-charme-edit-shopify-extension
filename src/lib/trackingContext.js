// Consent and campaign context handed from the storefront to the designer.
//
// The designer runs on its own origin (design.thecharmeedit.com), so the link
// the storefront renders is the only channel between the two. The theme snippet
// (shopify/snippets/charme-cart-group.liquid) reads the visitor's Shopify
// Customer Privacy decision and a last-touch campaign summary and appends them
// as `ca`, `cm` and `attr`. Provider IDs are passed separately and only when the
// matching consent is granted; they are never included in the session summary.
import { validGaClientId, validMetaCookie } from './analyticsEvents.js'

/**
 * What the designer does when its link carries no consent signal (direct visit,
 * saved-design link, old theme, blocked privacy API). `false` records nothing.
 */
export const DEFAULT_ANALYTICS_WITHOUT_SIGNAL = false

/** Click identifiers we recognise. Only their *names* are ever kept. */
export const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid', 'twclid', 'epik', 'li_fat_id']

// Hosts whose referral is part of our own journey (editor round trip, checkout
// and payment hand-offs) and therefore never a marketing source.
export const INTERNAL_HOST_SUFFIXES = [
  'thecharmeedit.com',
  'myshopify.com',
  'charme-customizer.pages.dev',
  'shopify.com',
  'shop.app',
  'paypal.com',
]

const hostMatches = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`)

export function isInternalHost(host) {
  const value = String(host || '').toLowerCase()
  return INTERNAL_HOST_SUFFIXES.some((suffix) => hostMatches(value, suffix))
}

const clean = (value, max) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _.\-+/:()]/gu, '')
    .trim()
    .slice(0, max)

function cleanHost(value) {
  const host = String(value ?? '').toLowerCase().trim().replace(/^www\./, '')
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) && !isInternalHost(host) ? host : ''
}

// Paths that can identify a person or grant access are not worth keeping as a
// marketing landing page.
const PRIVATE_PATH = /^\/(?:account|orders?|checkouts?|apps)(?:\/|$)/i

function cleanPath(value) {
  const path = String(value ?? '').split(/[?#]/)[0].slice(0, 120)
  if (!path.startsWith('/') || !/^[A-Za-z0-9/_\-.~%]+$/.test(path)) return ''
  return PRIVATE_PATH.test(path) ? '/' : path
}

/**
 * Normalise an attribution summary. Used by the browser and again by the server,
 * so a forged `attr` can never store more than these bounded, non-personal fields.
 */
export function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const requested = Array.isArray(raw.clickIds) ? raw.clickIds : []
  const clickIds = [...new Set(requested.map((id) => String(id).toLowerCase()))]
    .filter((id) => CLICK_ID_PARAMS.includes(id))
  const out = {
    source: clean(raw.source, 60),
    medium: clean(raw.medium, 60),
    campaign: clean(raw.campaign, 100),
    clickIds,
    referrerHost: cleanHost(raw.referrerHost),
    landingPath: cleanPath(raw.landingPath),
  }
  const meaningful = out.source || out.medium || out.campaign || out.clickIds.length || out.referrerHost
  return meaningful ? out : null
}

/** Decode the base64url JSON `attr` parameter; null when absent or malformed. */
export function decodeAttribution(encoded) {
  if (!encoded || encoded.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return sanitizeAttribution(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

/**
 * Consent + attribution for this designer visit.
 *
 * `search` is the designer URL's query string. `privacy` is Shopify's Customer
 * Privacy API when the designer is mounted inside a storefront page (the legacy
 * widget); on the designer domain it is absent and the link parameters decide.
 */
export function readTrackingContext(search = '', privacy = null) {
  const params = new URLSearchParams(search)
  let analyticsSignal = params.get('ca')
  let marketingSignal = params.get('cm')
  if (analyticsSignal == null && typeof privacy?.analyticsProcessingAllowed === 'function') {
    try {
      analyticsSignal = privacy.analyticsProcessingAllowed() ? '1' : '0'
      marketingSignal = typeof privacy.marketingAllowed === 'function' && privacy.marketingAllowed() ? '1' : '0'
    } catch {
      analyticsSignal = null
    }
  }
  const signal = analyticsSignal === '1' || analyticsSignal === '0'
  const analytics = signal ? analyticsSignal === '1' : DEFAULT_ANALYTICS_WITHOUT_SIGNAL
  const marketing = analytics && marketingSignal === '1'
  const gaClientId = analytics && validGaClientId(params.get('ga')) ? params.get('ga') : ''
  const fbp = marketing && validMetaCookie(params.get('fbp'), 'fb.1.') ? params.get('fbp') : ''
  const fbc = marketing && validMetaCookie(params.get('fbc'), 'fb.1.') ? params.get('fbc') : ''
  return {
    analytics,
    marketing,
    signal,
    attribution: marketing ? decodeAttribution(params.get('attr')) : null,
    identifiers: { gaClientId, fbp, fbc },
  }
}

const CLICK_ID_SOURCES = {
  gclid: 'google', gbraid: 'google', wbraid: 'google',
  fbclid: 'facebook', ttclid: 'tiktok', msclkid: 'bing',
  twclid: 'x', epik: 'pinterest', li_fat_id: 'linkedin',
}
const SEARCH_ENGINES = [
  ['google.', 'google'], ['bing.com', 'bing'], ['yahoo.', 'yahoo'],
  ['duckduckgo.com', 'duckduckgo'], ['ecosia.org', 'ecosia'], ['baidu.com', 'baidu'],
]
const SOCIAL_NETWORKS = [
  ['facebook.com', 'facebook'], ['instagram.com', 'instagram'], ['pinterest.', 'pinterest'],
  ['tiktok.com', 'tiktok'], ['t.co', 'x'], ['reddit.com', 'reddit'],
  ['youtube.com', 'youtube'], ['linkedin.com', 'linkedin'],
]

const matchesHost = (host, [needle]) => (needle.endsWith('.') ? host.includes(`.${needle}`) || host.startsWith(needle) : hostMatches(host, needle))

export const UNATTRIBUTED_LABEL = '(direct / unknown)'

/**
 * One readable source per session, used to group the funnel. Precedence:
 * explicit UTM tags, then a recognised ad click identifier, then the referrer.
 */
export function attributionLabel(attribution) {
  const attr = sanitizeAttribution(attribution)
  if (!attr) return UNATTRIBUTED_LABEL
  if (attr.source || attr.medium) return `${attr.source || '(not set)'} / ${attr.medium || '(not set)'}`
  if (attr.campaign) return `(not set) / (not set) / ${attr.campaign}`
  const clickId = attr.clickIds[0]
  if (clickId) return `${CLICK_ID_SOURCES[clickId]} / ${clickId}`
  const host = attr.referrerHost
  const search = SEARCH_ENGINES.find((entry) => matchesHost(host, entry))
  if (search) return `${search[1]} / organic`
  const social = SOCIAL_NETWORKS.find((entry) => matchesHost(host, entry))
  if (social) return `${social[1]} / referral`
  return `${host} / referral`
}

/** The label for an order's recorded UTM tags / referring host (Shopify's view). */
export function orderSourceLabel({ utmSource = '', utmMedium = '', referringHost = '' } = {}) {
  if (utmSource || utmMedium) return `${utmSource || '(not set)'} / ${utmMedium || '(not set)'}`
  return referringHost ? `${referringHost} / referral` : '(direct / none)'
}
