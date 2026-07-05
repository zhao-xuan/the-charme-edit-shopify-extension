#!/usr/bin/env node
// Migrate the phone-case ("case with gel") catalogue into the merchant's Shopify
// store: body images → Files API, case metadata (size, colours, gel options,
// keep-outs/printable) → Metaobjects (definition `charme_product`).
// See doc/shopify-storage.md. Reuses the same client_credentials auth + Files
// flow as scripts/migrate-to-shopify.mjs.
//
// PREREQUISITE — export the parsed products first (products.js is code, not JSON):
//   npx esbuild src/data/products.js --bundle --format=esm --platform=node \
//     --banner:js="globalThis.window={CharmeConfig:{}};globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};" \
//     --outfile=/tmp/prod.mjs
//   node -e "import('/tmp/prod.mjs').then(m=>require('fs').writeFileSync('reference/products-export.json',JSON.stringify(m.ALL_PRODUCTS.filter(p=>p.kind==='phone'),null,2)))"
//
// Usage:
//   SHOPIFY_STORE=... SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=shpss_... \
//   node scripts/migrate-products-to-shopify.mjs [--dry-run] [--limit N] [--only <id>]
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
if (!existsSync('reference/products-export.json')) {
  console.error('reference/products-export.json not found — run the esbuild export in this file\u2019s header first.')
  process.exit(1)
}
const products = JSON.parse(readFileSync('reference/products-export.json', 'utf8'))
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
      if (JSON.stringify(body.errors).includes('THROTTLED')) { await sleep(2000 * (attempt + 1)); continue }
      throw new Error(JSON.stringify(body.errors))
    }
    return body.data
  }
  throw new Error('gql retries exhausted')
}

const PRODUCT_FIELDS = [
  ['name', 'Name', 'single_line_text_field'],
  ['kind', 'Kind', 'single_line_text_field'],
  ['brand', 'Brand', 'single_line_text_field'],
  ['base_price', 'Base price', 'number_decimal'],
  ['width_mm', 'Width mm', 'number_decimal'],
  ['height_mm', 'Height mm', 'number_decimal'],
  ['radius_mm', 'Radius mm', 'number_decimal'],
  ['body_image_white', 'Body image (white)', 'file_reference'],
  ['body_image_black', 'Body image (black)', 'file_reference'],
  ['colours', 'Colours', 'json'],
  ['gel_colours', 'Gel colours', 'json'],
  ['printable', 'Printable', 'json'],
  ['gel_render', 'Gel render', 'boolean'],
  ['legacy_id', 'Legacy id', 'single_line_text_field'],
]

const DEF_QUERY = `query($type:String!){ metaobjectDefinitionByType(type:$type){ id type } }`
const DEF_CREATE = `
  mutation($definition: MetaobjectDefinitionCreateInput!){
    metaobjectDefinitionCreate(definition:$definition){ metaobjectDefinition{ id } userErrors{ field message code } }
  }`
async function ensureDefinition() {
  const found = await gql(DEF_QUERY, { type: 'charme_product' })
  if (found.metaobjectDefinitionByType) return console.log('✔ definition charme_product exists')
  if (DRY) return console.log('[dry] would create definition charme_product')
  const definition = {
    name: 'Charmé product',
    type: 'charme_product',
    access: { storefront: 'PUBLIC_READ' },
    displayNameKey: 'name',
    fieldDefinitions: PRODUCT_FIELDS.map(([key, name, type]) => ({ key, name, type })),
  }
  const r = await gql(DEF_CREATE, { definition })
  const e = r.metaobjectDefinitionCreate.userErrors
  if (e && e.length) throw new Error('definition: ' + JSON.stringify(e))
  console.log('✔ created definition charme_product')
}

const LIST = `query($after:String){ metaobjects(type:"charme_product", first:200, after:$after){ nodes{ fields{ key value } } pageInfo{ hasNextPage endCursor } } }`
async function existingLegacyIds() {
  const done = new Set(); let after = null
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

const STAGED = `mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }`
const FILE_CREATE = `mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ id } userErrors{ field message } } }`
async function uploadImage(localPath, filename) {
  const bytes = readFileSync(localPath)
  const st = await gql(STAGED, { input: [{ filename, mimeType: 'image/png', resource: 'FILE', httpMethod: 'POST' }] })
  const target = st.stagedUploadsCreate.stagedTargets[0]
  const form = new FormData()
  for (const p of target.parameters) form.append(p.name, p.value)
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename)
  const up = await fetch(target.url, { method: 'POST', body: form })
  if (!up.ok) throw new Error('staged upload failed ' + up.status)
  const fc = await gql(FILE_CREATE, { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: filename }] })
  const e = fc.fileCreate.userErrors
  if (e && e.length) throw new Error('fileCreate: ' + JSON.stringify(e))
  return fc.fileCreate.files[0].id
}

const MO_CREATE = `mutation($input:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$input){ metaobject{ id } userErrors{ field message code } } }`

async function main() {
  TOKEN = await accessToken()
  await ensureDefinition()
  const done = DRY ? new Set() : await existingLegacyIds()
  console.log(`already migrated: ${done.size}`)

  let list = products
  if (ONLY) list = list.filter((p) => p.id === ONLY)
  let migrated = 0, skipped = 0, failed = 0
  for (const p of list) {
    if (migrated >= LIMIT) break
    if (done.has(p.id)) { skipped++; continue }
    const bi = p.blankImage || {}
    // phone: white/black; tote: natural; frame: parametric (no image).
    const whitePath = bi.white || bi.natural || bi.default
    const blackPath = bi.black || null
    if (DRY) { console.log('[dry] would migrate', p.id, '| white:', whitePath, '| black:', blackPath); migrated++; continue }
    try {
      const whiteGid = whitePath && existsSync('public' + whitePath) ? await uploadImage('public' + whitePath, p.id + '-white.png') : null
      const blackGid = blackPath && existsSync('public' + blackPath) ? await uploadImage('public' + blackPath, p.id + '-black.png') : null
      const f = {
        name: p.name,
        kind: p.kind,
        brand: p.brand || '',
        base_price: String(p.basePrice ?? 0),
        width_mm: String(p.widthMm ?? ''),
        height_mm: String(p.heightMm ?? ''),
        radius_mm: String(p.radiusMm ?? ''),
        body_image_white: whiteGid,
        body_image_black: blackGid,
        colours: JSON.stringify(p.caseColours || p.colors || []),
        gel_colours: JSON.stringify((p.gelColours || []).map((g) => g.id || g)),
        printable: JSON.stringify(p.printable || {}),
        gel_render: String(!!p.gelRender),
        legacy_id: p.id,
      }
      const fields = Object.entries(f).filter(([, v]) => v !== '' && v != null).map(([key, value]) => ({ key, value }))
      const r = await gql(MO_CREATE, { input: { type: 'charme_product', fields } })
      const e = r.metaobjectCreate.userErrors
      if (e && e.length) throw new Error(JSON.stringify(e))
      migrated++
      console.log(`  ✔ ${p.id}`)
      await sleep(350)
    } catch (err) {
      console.warn('  ! failed', p.id, String(err.message || err).slice(0, 160))
      failed++
      await sleep(1000)
    }
  }
  console.log(`\nDone. migrated=${migrated} skipped(existing)=${skipped} failed=${failed}`)
}
main().catch((e) => { console.error('\n✖', e.message || e); process.exit(1) })
