#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const KEY = 'snippets/charme-cart-group.liquid'
const START = '  function syncEditorMarkets() {'
const END = '  var floatingButton;'
const TRACKING = '  // Designer tracking hand-off.'
const hash = (value) => createHash('sha256').update(value).digest('hex')

function boundary(text, marker) {
  const index = text.indexOf(marker)
  if (index < 0 || text.indexOf(marker, index + marker.length) !== -1) {
    throw new Error(`Expected exactly one theme marker: ${marker}`)
  }
  return index
}

export function patchTracking(remote, local) {
  const start = boundary(remote, START)
  const end = boundary(remote, END)
  const localStart = boundary(local, TRACKING)
  const localEnd = boundary(local, END)
  if (end <= start || localEnd <= localStart) throw new Error('Invalid tracking section boundaries')
  const existing = remote.includes(TRACKING) ? boundary(remote, TRACKING) : start
  return remote.slice(0, existing) + local.slice(localStart, localEnd) + remote.slice(end)
}

export function selectLiveTheme(themes, requestedId) {
  const live = themes.filter((theme) => theme.role === 'main')
  if (live.length !== 1) throw new Error('Expected exactly one live Shopify theme')
  if (requestedId !== 'live' && String(live[0].id) !== requestedId) {
    throw new Error('Selected theme is not the live theme')
  }
  return String(live[0].id)
}

export function verifyTracking(remote, local, layout) {
  if (!/\{%-?\s*render\s+['"]charme-cart-group['"]/.test(layout)) {
    throw new Error('Live layout does not render the tracking handoff snippet')
  }
  if (patchTracking(remote, local) !== remote) {
    throw new Error('Live theme tracking handoff is missing or outdated; analytics sessions may be unrecorded')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const check = args.includes('--check')
  const requestedId = args.find((arg) => arg.startsWith('--theme-id='))?.split('=')[1]
  const backupDir = args.find((arg) => arg.startsWith('--backup-dir='))?.slice('--backup-dir='.length)
  if ((requestedId !== 'live' && !/^\d+$/.test(requestedId || '')) || (write && (!backupDir || check))) {
    throw new Error('Usage: node --env-file=.env scripts/push-live-tracking-fix.mjs --theme-id=live|ID [--check | --write --backup-dir=PATH]')
  }
  const store = process.env.SHOPIFY_STORE
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  if (!store || !clientId || !clientSecret) throw new Error('Missing Shopify deployment credentials')
  const response = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  const auth = await response.json()
  if (!response.ok || !auth.access_token) throw new Error(`Shopify token exchange failed (${response.status})`)
  async function request(path, options = {}) {
    const result = await fetch(`https://${store}/admin/api/2025-01/${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': auth.access_token },
    })
    if (!result.ok) throw new Error(`Shopify ${options.method || 'GET'} failed (${result.status})`)
    return result.json()
  }
  const { themes } = await request('themes.json')
  const themeId = selectLiveTheme(themes, requestedId)
  const { asset: layout } = await request(`themes/${themeId}/assets.json?asset[key]=layout%2Ftheme.liquid`)
  if (typeof layout?.value !== 'string') throw new Error('Live layout has no text value')
  const assetUrl = `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(KEY)}`
  const readAsset = async () => {
    const { asset } = await request(`${assetUrl}&cache_bust=${Date.now()}`)
    if (typeof asset?.value !== 'string') throw new Error('Theme asset has no text value')
    return asset.value
  }
  const remote = await readAsset()
  const local = await readFile(new URL(`../shopify/${KEY}`, import.meta.url), 'utf8')
  const patched = patchTracking(remote, local)
  verifyTracking(patched, local, layout.value)
  if (check) {
    verifyTracking(remote, local, layout.value)
    console.log(JSON.stringify({ themeId, key: KEY, action: 'tracking-check-passed', sha256: hash(remote) }))
    return
  }
  if (patched === remote || !write) {
    console.log(JSON.stringify({ themeId, key: KEY, action: patched === remote ? 'unchanged' : 'would-patch', before: hash(remote), after: hash(patched) }))
    return
  }
  await mkdir(backupDir, { recursive: true })
  await writeFile(resolve(backupDir, `theme-${themeId}-cart-group-${hash(remote).slice(0, 12)}.liquid`), remote, { flag: 'wx' })
  if (hash(await readAsset()) !== hash(remote)) throw new Error('Theme changed during preparation; refusing to overwrite')
  const latest = await request('themes.json')
  selectLiveTheme(latest.themes, themeId)
  await request(`themes/${themeId}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key: KEY, value: patched } }),
  })
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000))
    if (hash(await readAsset()) === hash(patched)) {
      console.log(JSON.stringify({ themeId, key: KEY, action: 'patched-and-verified', sha256: hash(patched) }))
      return
    }
  }
  throw new Error('Live theme readback did not match; use the backup to investigate')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
