#!/usr/bin/env node
// Migrate the bundled charm catalogue into the merchant's OWN Shopify store,
// Shopify-native (no self-hosted DB): images → Files API, charm metadata →
// Metaobjects (definition `charme_charm`). See doc/shopify-storage.md.
//
// Auth reuses the dev-dashboard app credentials (client_credentials grant).
// The app MUST have scopes: write_metaobjects, write_files (+ read for resume).
//
// Usage:
//   SHOPIFY_STORE=7ftyeu-0m.myshopify.com \
//   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=shpss_... \
//   node scripts/migrate-to-shopify.mjs [--dry-run] [--limit N] [--only <id>]
//
// Idempotent: skips charms already migrated (matched by legacy_id metafield),
// so you can re-run to resume. Throttled to respect Admin API rate limits.
import { readFileSync, existsSync } from 'fs'

const API_VERSION = '2025-01'
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
const DRY = process.argv.includes('--dry-run')
const limIdx = process.argv.indexOf('--limit')
const LIMIT = limIdx !== -1 ? Number(process.argv[limIdx + 1]) : Infinity
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null

if (!store || !clientId || !clientSecret) {
  console.error('Missing env SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET')
  process.exit(1)
}

const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const overrides = existsSync('src/data/charm-overrides.generated.json')
  ? JSON.parse(readFileSync('src/data/charm-overrides.generated.json', 'utf8'))
  : {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function accessToken() {
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) throw new Error('token exchange failed: ' + JSON.stringify(d))
  return d.access_token
}

let TOKEN
async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': TOKEN },
      body: JSON.stringify({ query, variables }),
    })
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue }
    const body = await res.json()
    if (body.errors) {
      const throttled = JSON.stringify(body.errors).includes('THROTTLED')
      if (throttled) { await sleep(2000 * (attempt + 1)); continue }
      throw new Error(JSON.stringify(body.errors))
    }
    return body.data
  }
  throw new Error('gql retries exhausted')
}

// ---- 1. Ensure the charme_charm metaobject definition exists ---------------
const CHARM_FIELDS = [
  ['name', 'Name', 'single_line_text_field'],
  ['image', 'Image', 'file_reference'],
  ['category', 'Category', 'single_line_text_field'],
  ['tier', 'Tier', 'single_line_text_field'],
  ['collection', 'Collection', 'single_line_text_field'],
  ['charm_type', 'Charm type', 'number_integer'],
  ['price', 'Price', 'number_decimal'],
  ['width_mm', 'Width mm', 'number_decimal'],
  ['height_mm', 'Height mm', 'number_decimal'],
  ['px_w', 'Px width', 'number_integer'],
  ['px_h', 'Px height', 'number_integer'],
  ['min_scale', 'Min scale', 'number_decimal'],
  ['max_scale', 'Max scale', 'number_decimal'],
  ['hidden', 'Hidden', 'boolean'],
  ['shopify_variant_id', 'Shopify variant id', 'single_line_text_field'],
  ['legacy_id', 'Legacy id', 'single_line_text_field'],
]

const DEF_QUERY = `query($type:String!){ metaobjectDefinitionByType(type:$type){ id type } }`
const DEF_CREATE = `
  mutation($definition: MetaobjectDefinitionCreateInput!){
    metaobjectDefinitionCreate(definition:$definition){
      metaobjectDefinition{ id type }
      userErrors{ field message code }
    }
  }`

async function ensureDefinition() {
  const found = await gql(DEF_QUERY, { type: 'charme_charm' })
  if (found.metaobjectDefinitionByType) return console.log('✔ definition charme_charm exists')
  if (DRY) return console.log('[dry] would create definition charme_charm')
  const definition = {
    name: 'Charmé charm',
    type: 'charme_charm',
    access: { storefront: 'PUBLIC_READ' },
    displayNameKey: 'name',
    fieldDefinitions: CHARM_FIELDS.map(([key, name, type]) => ({ key, name, type })),
  }
  const r = await gql(DEF_CREATE, { definition })
  const e = r.metaobjectDefinitionCreate.userErrors
  if (e && e.length) throw new Error('definition: ' + JSON.stringify(e))
  console.log('✔ created definition charme_charm')
}

// ---- 2. Resume: which legacy_ids are already migrated? ---------------------
const LIST = `
  query($after:String){
    metaobjects(type:"charme_charm", first:200, after:$after){
      nodes{ id fields{ key value } }
      pageInfo{ hasNextPage endCursor }
    }
  }`
async function existingLegacyIds() {
  const done = new Set()
  let after = null
  do {
    const d = await gql(LIST, { after })
    for (const n of d.metaobjects.nodes) {
      const f = n.fields.find((x) => x.key === 'legacy_id')
      if (f && f.value) done.add(f.value)
    }
    after = d.metaobjects.pageInfo.hasNextPage ? d.metaobjects.pageInfo.endCursor : null
  } while (after)
  return done
}

// ---- 3. Upload an image to Files API → returns file GID --------------------
const STAGED = `
  mutation($input:[StagedUploadInput!]!){
    stagedUploadsCreate(input:$input){
      stagedTargets{ url resourceUrl parameters{ name value } }
      userErrors{ field message }
    }
  }`
const FILE_CREATE = `
  mutation($files:[FileCreateInput!]!){
    fileCreate(files:$files){ files{ id } userErrors{ field message } }
  }`

async function uploadImage(localPath, filename) {
  const bytes = readFileSync(localPath)
  const st = await gql(STAGED, {
    input: [{ filename, mimeType: 'image/png', resource: 'FILE', httpMethod: 'POST' }],
  })
  const target = st.stagedUploadsCreate.stagedTargets[0]
  const form = new FormData()
  for (const p of target.parameters) form.append(p.name, p.value)
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename)
  const up = await fetch(target.url, { method: 'POST', body: form })
  if (!up.ok) throw new Error('staged upload failed ' + up.status)
  const fc = await gql(FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: filename }],
  })
  const e = fc.fileCreate.userErrors
  if (e && e.length) throw new Error('fileCreate: ' + JSON.stringify(e))
  return fc.fileCreate.files[0].id
}

// ---- 4. Create the charme_charm metaobject ---------------------------------
const MO_CREATE = `
  mutation($input:MetaobjectCreateInput!){
    metaobjectCreate(metaobject:$input){ metaobject{ id } userErrors{ field message code } }
  }`

function charmFields(c, fileGid) {
  const ov = overrides[c.id] || {}
  const f = {
    name: c.name,
    image: fileGid,
    category: c.category || '',
    tier: c.tier || '',
    collection: c.collection || '',
    charm_type: String(c.type ?? ''),
    price: String(ov.price ?? c.price ?? 0),
    width_mm: String(c.widthMm ?? ''),
    height_mm: String(c.heightMm ?? ''),
    px_w: String(c.pxW ?? ''),
    px_h: String(c.pxH ?? ''),
    min_scale: String(c.minScale ?? 1),
    max_scale: String(c.maxScale ?? 1),
    hidden: String(!!ov.unavailable),
    shopify_variant_id: ov.variantId ? String(ov.variantId) : '',
    legacy_id: c.id,
  }
  return Object.entries(f)
    .filter(([, v]) => v !== '' && v != null)
    .map(([key, value]) => ({ key, value }))
}

async function main() {
  TOKEN = await accessToken()
  await ensureDefinition()
  const done = DRY ? new Set() : await existingLegacyIds()
  console.log(`already migrated: ${done.size}`)

  let charms = catalog.charms
  if (ONLY) charms = charms.filter((c) => c.id === ONLY)
  let migrated = 0, skipped = 0, failed = 0
  for (const c of charms) {
    if (migrated >= LIMIT) break
    if (done.has(c.id)) { skipped++; continue }
    const local = 'public' + c.src
    if (!existsSync(local)) { console.warn('  ! missing image', local); failed++; continue }
    if (DRY) { console.log('[dry] would migrate', c.id, c.name); migrated++; continue }
    try {
      const fileGid = await uploadImage(local, c.id + '.png')
      const r = await gql(MO_CREATE, { input: { type: 'charme_charm', fields: charmFields(c, fileGid) } })
      const e = r.metaobjectCreate.userErrors
      if (e && e.length) throw new Error(JSON.stringify(e))
      migrated++
      if (migrated % 20 === 0) console.log(`  … ${migrated} migrated`)
      await sleep(350) // gentle throttle
    } catch (err) {
      console.warn('  ! failed', c.id, String(err.message || err).slice(0, 160))
      failed++
      await sleep(1000)
    }
  }
  console.log(`\nDone. migrated=${migrated} skipped(existing)=${skipped} failed=${failed}`)
}

main().catch((e) => { console.error('\n✖', e.message || e); process.exit(1) })
