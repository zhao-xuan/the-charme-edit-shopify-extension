#!/usr/bin/env node
// Update only the Canary theme's global header-logo dimensions.
// Usage:
//   set -a; source .env; set +a
//   node scripts/push-canary-logo-size.mjs [--dry-run]
import { createHash } from 'node:crypto'

const API_VERSION = '2025-01'
const CANARY_THEME_ID = '185473892730'
const SETTINGS_KEY = 'config/settings_data.json'
const LOGO_HEIGHT = 44
const LOGO_HEIGHT_MOBILE = 34
const dryRun = process.argv.includes('--dry-run')
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET.')
}

const hash = value => createHash('sha256').update(value).digest('hex')
const checksum = value => createHash('md5').update(value).digest('hex')

function parseSettings(value) {
  const prefix = value.match(/^(\/\*[\s\S]*?\*\/\s*)/)?.[1] || ''
  return { prefix, data: JSON.parse(value.slice(prefix.length)) }
}

async function accessToken() {
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) throw new Error(`Shopify token exchange failed (${response.status}).`)
  return body.access_token
}

const token = await accessToken()
async function request(path, options = {}) {
  const response = await fetch(`https://${store}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': token,
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Shopify ${options.method || 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`)
  return body
}

async function getSettings(cacheBust = '') {
  const suffix = cacheBust ? `&cache_bust=${encodeURIComponent(cacheBust)}` : ''
  const body = await request(`themes/${CANARY_THEME_ID}/assets.json?asset[key]=${encodeURIComponent(SETTINGS_KEY)}${suffix}`)
  return body.asset?.value || ''
}

async function getSettingsChecksum() {
  const body = await request(`themes/${CANARY_THEME_ID}/assets.json`)
  return body.assets?.find(asset => asset.key === SETTINGS_KEY)?.checksum || null
}

const currentValue = await getSettings()
const { prefix, data } = parseSettings(currentValue)
if (!data.current || typeof data.current !== 'object') throw new Error('Canary settings have no current object.')

const changed = data.current.logo_height !== LOGO_HEIGHT || data.current.logo_height_mobile !== LOGO_HEIGHT_MOBILE
data.current.logo_height = LOGO_HEIGHT
data.current.logo_height_mobile = LOGO_HEIGHT_MOBILE
const nextValue = `${prefix}${JSON.stringify(data, null, 2)}\n`

if (changed && !dryRun) {
  await request(`themes/${CANARY_THEME_ID}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key: SETTINGS_KEY, value: nextValue } }),
  })

  let verified = false
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await getSettingsChecksum() === checksum(nextValue)) {
      verified = true
      break
    }
    const { data: remote } = parseSettings(await getSettings(`${Date.now()}-${attempt}`))
    if (remote.current?.logo_height === LOGO_HEIGHT && remote.current?.logo_height_mobile === LOGO_HEIGHT_MOBILE) {
      verified = true
      break
    }
  }
  if (!verified) throw new Error(`${SETTINGS_KEY} readback verification failed.`)
}

console.log(JSON.stringify({
  themeId: CANARY_THEME_ID,
  dryRun,
  changed,
  logoHeight: LOGO_HEIGHT,
  logoHeightMobile: LOGO_HEIGHT_MOBILE,
}, null, 2))