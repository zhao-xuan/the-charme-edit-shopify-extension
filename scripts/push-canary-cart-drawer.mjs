#!/usr/bin/env node
// Restore the default cart drawer while keeping Charmé grouped cart lines and
// disabling the third-party cart overlay that bypasses grouped counts.
// The theme IDs and asset allow-list are fixed so this script cannot target an
// unrelated theme.
//
// Usage:
//   set -a; source .env; set +a
//   node scripts/push-canary-cart-drawer.mjs [--dry-run]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API_VERSION = '2025-01'
const CANARY_THEME_IDS = ['185622528378']
const LAYOUT_KEY = 'layout/theme.liquid'
const SETTINGS_KEY = 'config/settings_data.json'
const THEME_ASSETS = [
  ['snippets/charme-cart-group.liquid', 'shopify/snippets/charme-cart-group.liquid'],
  ['snippets/charme-cart-line.liquid', 'shopify/snippets/charme-cart-line.liquid'],
  ['snippets/cart-products.liquid', 'shopify/snippets/cart-products.liquid'],
  ['snippets/cart-drawer.liquid', 'shopify/snippets/cart-drawer.liquid'],
]
const THIRD_PARTY_BLOCK_ID = '2391397090251692709'
const THIRD_PARTY_BLOCK_TYPE = 'shopify://apps/cartylabs-upsellcart/blocks/app-embed/87f48470-496b-4581-9be3-6b264b1ba440'
const CART_GROUP_RENDER = "{% render 'charme-cart-group' %}"
const DRAWER_RENDER = `{% render 'charme-cart-drawer',
  free_shipping_threshold: 0,
  announcement_text: '10% off ending soon: Summer10',
  cross_sell_collection: 'accessories',
  cross_sell_title: 'Buy 2 cases, get a FREE phone strap'
%}`

const dryRun = process.argv.includes('--dry-run')
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET.')
}

const hash = value => createHash('sha256').update(value).digest('hex')
const checksum = value => createHash('md5').update(value).digest('hex')
const count = (value, pattern) => (value.match(pattern) || []).length

function parseSettings(value) {
  const prefix = value.match(/^(\/\*[\s\S]*?\*\/\s*)/)?.[1] || ''
  return { prefix, data: JSON.parse(value.slice(prefix.length)) }
}

function prepareLayout(value) {
  const drawerCount = count(value, /render\s+['"]charme-cart-drawer['"]/g)
  if (drawerCount > 1) throw new Error(`Canary layout has ${drawerCount} custom drawer renders.`)
  if (drawerCount === 1) {
    if (!value.includes(DRAWER_RENDER)) {
      throw new Error('Canary layout has an unexpected custom drawer render; refusing to remove it.')
    }
    value = value.replace(`\n${DRAWER_RENDER}`, '').replace(DRAWER_RENDER, '')
  }
  if (count(value, /\{%\s*render\s+['"]charme-cart-group['"]\s*%\}/g) !== 1) {
    throw new Error('Expected exactly one charme-cart-group render in Canary layout.')
  }
  return value
}

function prepareSettings(value) {
  const { prefix, data } = parseSettings(value)
  const current = data.current
  if (!current || typeof current !== 'object') throw new Error('Canary settings have no current object.')
  const block = current.blocks?.[THIRD_PARTY_BLOCK_ID]
  if (!block || block.type !== THIRD_PARTY_BLOCK_TYPE) {
    throw new Error('The guarded Cartylabs cart app embed was not found in Canary settings.')
  }
  if (block.disabled !== true && block.disabled !== false) {
    throw new Error('The Cartylabs cart app embed has an unexpected disabled state.')
  }
  if (current.cart_type !== 'drawer' && current.cart_type !== 'page') {
    throw new Error(`Unexpected Canary cart_type: ${String(current.cart_type)}`)
  }
  block.disabled = true
  current.cart_type = 'drawer'
  return {
    data,
    value: `${prefix}${JSON.stringify(data, null, 2)}\n`,
  }
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
  if (!response.ok || !body.access_token) {
    throw new Error(`Shopify token exchange failed (${response.status}).`)
  }
  return body.access_token
}

const token = await accessToken()

async function request(path, options = {}, allowNotFound = false) {
  const response = await fetch(`https://${store}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': token,
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (allowNotFound && response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Shopify ${options.method || 'GET'} ${path} failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return body
}

async function getAsset(themeId, key, cacheBust = '') {
  const suffix = cacheBust ? `&cache_bust=${encodeURIComponent(cacheBust)}` : ''
  const body = await request(
    `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}${suffix}`,
    {},
    true,
  )
  return body ? { exists: true, value: body.asset?.value || '' } : { exists: false, value: '' }
}

async function putAsset(themeId, key, value) {
  await request(`themes/${themeId}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({ asset: { key, value } }),
  })
}

async function deleteAsset(themeId, key) {
  await request(`themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
}

async function getAssetChecksum(themeId, key) {
  const body = await request(`themes/${themeId}/assets.json`)
  return body.assets?.find(asset => asset.key === key)?.checksum || null
}

async function verify(themeId, key, value, matches) {
  const expectedChecksum = checksum(value)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await getAssetChecksum(themeId, key) === expectedChecksum) return
    const remote = await getAsset(themeId, key, `${Date.now()}-${attempt}`)
    if (remote.exists && matches(remote.value)) return
  }
  throw new Error(`${key} readback verification failed.`)
}

for (const themeId of CANARY_THEME_IDS) {
  const originals = {
    [LAYOUT_KEY]: await getAsset(themeId, LAYOUT_KEY),
    [SETTINGS_KEY]: await getAsset(themeId, SETTINGS_KEY),
  }
  for (const [key] of THEME_ASSETS) originals[key] = await getAsset(themeId, key)
  if (!originals[LAYOUT_KEY].exists || !originals[SETTINGS_KEY].exists) {
    throw new Error(`Canary ${themeId} layout or settings asset is missing.`)
  }

  const layoutValue = prepareLayout(originals[LAYOUT_KEY].value)
  const preparedSettings = prepareSettings(originals[SETTINGS_KEY].value)
  const currentSettings = parseSettings(originals[SETTINGS_KEY].value).data.current
  const plans = [
    ...THEME_ASSETS.map(([key, localPath]) => {
      const value = readFileSync(localPath, 'utf8')
      return {
        key,
        value,
        changed: !originals[key].exists || hash(originals[key].value) !== hash(value),
        matches: remoteValue => hash(remoteValue) === hash(value),
      }
    }),
    {
      key: SETTINGS_KEY,
      value: preparedSettings.value,
      changed: currentSettings.blocks[THIRD_PARTY_BLOCK_ID].disabled !== true || currentSettings.cart_type !== 'drawer',
      matches: value => JSON.stringify(parseSettings(value).data) === JSON.stringify(preparedSettings.data),
    },
    {
      key: LAYOUT_KEY,
      value: layoutValue,
      changed: hash(originals[LAYOUT_KEY].value) !== hash(layoutValue),
      matches: value => hash(value) === hash(layoutValue),
    },
  ]

  if (dryRun) {
    console.log(JSON.stringify({
      themeId,
      dryRun,
      thirdPartyBlockId: THIRD_PARTY_BLOCK_ID,
      cartType: { from: currentSettings.cart_type, to: 'drawer' },
      assets: plans.map(plan => ({
        key: plan.key,
        action: plan.changed ? 'would-upload' : 'unchanged',
        localSha256: hash(plan.value),
        remoteSha256: originals[plan.key].exists ? hash(originals[plan.key].value) : null,
      })),
    }, null, 2))
    continue
  }

  const changed = []
  try {
    for (const plan of plans) {
      if (!plan.changed) continue
      await putAsset(themeId, plan.key, plan.value)
      changed.push(plan.key)
      await verify(themeId, plan.key, plan.value, plan.matches)
    }
  } catch (error) {
    const rollbackErrors = []
    for (const key of changed.reverse()) {
      try {
        if (originals[key].exists) await putAsset(themeId, key, originals[key].value)
        else await deleteAsset(themeId, key)
      } catch (rollbackError) {
        rollbackErrors.push(`${key}: ${rollbackError.message}`)
      }
    }
    const suffix = rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join('; ')}` : ' Original assets restored.'
    throw new Error(`${error.message}${suffix}`)
  }

  console.log(JSON.stringify({
    themeId,
    dryRun,
    thirdPartyBlockId: THIRD_PARTY_BLOCK_ID,
    cartType: 'drawer',
    assets: plans.map(plan => ({
      key: plan.key,
      action: plan.changed ? 'uploaded' : 'unchanged',
      sha256: hash(plan.value),
    })),
  }, null, 2))
}