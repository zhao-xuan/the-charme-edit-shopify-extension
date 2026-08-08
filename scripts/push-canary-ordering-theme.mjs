#!/usr/bin/env node
// Upload only the Canary ordering section and its template. The theme ID and
// asset allow-list are intentionally fixed so this command cannot target Live.
//
// Usage:
//   set -a; source .env; set +a
//   node scripts/push-canary-ordering-theme.mjs [--dry-run]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API_VERSION = '2025-01'
const CANARY_THEME_ID = '185473892730'
const dryRun = process.argv.includes('--dry-run')
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

const assets = [
  {
    key: 'sections/charme-product-ordering.liquid',
    localPath: 'shopify/sections/charme-product-ordering.liquid',
  },
  {
    key: 'templates/product.charme-ordering.json',
    localPath: 'shopify/templates/product.charme-ordering.json',
    matches: templateMatches,
  },
]

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET.')
}

const hash = (value) => createHash('sha256').update(value).digest('hex')

function templateMain(value) {
  return JSON.parse(value.replace(/^\/\*[\s\S]*?\*\/\s*/, '')).sections?.main
}

function templateMatches(remoteValue, localValue) {
  const remote = templateMain(remoteValue)
  const local = templateMain(localValue)
  return remote?.type === local?.type
    && JSON.stringify(remote?.settings) === JSON.stringify(local?.settings)
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

async function verifyAsset(asset, local, expectedHash) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `&cache_bust=${Date.now()}-${attempt}`
    const remote = await request(`themes/${CANARY_THEME_ID}/assets.json?asset[key]=${encodeURIComponent(asset.key)}${suffix}`)
    const remoteValue = remote.asset?.value || ''
    if (asset.matches ? asset.matches(remoteValue, local) : hash(remoteValue) === expectedHash) return
  }
  throw new Error(`${asset.key} readback verification failed.`)
}

const results = []
for (const asset of assets) {
  const local = readFileSync(asset.localPath, 'utf8')
  const remote = await request(`themes/${CANARY_THEME_ID}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`)
  const remoteValue = remote.asset?.value || ''
  const localHash = hash(local)
  const remoteHash = hash(remoteValue)
  if (asset.matches ? asset.matches(remoteValue, local) : localHash === remoteHash) {
    results.push({ key: asset.key, action: 'unchanged', sha256: localHash })
    continue
  }
  if (dryRun) {
    results.push({ key: asset.key, action: 'would-upload', localSha256: localHash, remoteSha256: remoteHash })
    continue
  }
  await request(`themes/${CANARY_THEME_ID}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key: asset.key, value: local } }),
  })
  await verifyAsset(asset, local, localHash)
  results.push({ key: asset.key, action: 'uploaded', sha256: localHash })
}

console.log(JSON.stringify({ themeId: CANARY_THEME_ID, dryRun, results }, null, 2))