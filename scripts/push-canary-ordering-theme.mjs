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
  },
]

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET.')
}

const hash = (value) => createHash('sha256').update(value).digest('hex')

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

const results = []
for (const asset of assets) {
  const local = readFileSync(asset.localPath, 'utf8')
  const remote = await request(`themes/${CANARY_THEME_ID}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`)
  const remoteValue = remote.asset?.value || ''
  const localHash = hash(local)
  const remoteHash = hash(remoteValue)
  if (localHash === remoteHash) {
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
  const verified = await request(`themes/${CANARY_THEME_ID}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`)
  const verifiedHash = hash(verified.asset?.value || '')
  if (verifiedHash !== localHash) throw new Error(`${asset.key} readback hash mismatch.`)
  results.push({ key: asset.key, action: 'uploaded', sha256: localHash })
}

console.log(JSON.stringify({ themeId: CANARY_THEME_ID, dryRun, results }, null, 2))