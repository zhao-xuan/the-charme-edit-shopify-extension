#!/usr/bin/env node
// Publish only the accepted charm-repair manifest to the merchant's Shopify
// Files + charme_charm metaobjects. Run with --verify before --apply.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const API_VERSION = '2025-01'
const APPLY = process.argv.includes('--apply')
const VERIFY = process.argv.includes('--verify')
const store = process.env.SHOPIFY_STORE
const clientId = process.env.SHOPIFY_CLIENT_ID
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/catalog.json'), 'utf8')).charms
const acceptance = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'reference/charm-repairs/final-acceptance-report.json'), 'utf8'),
)
const publication = acceptance.shopifyPublication
const reportPath = path.join(ROOT, 'reference/charm-repairs/shopify-publication-report.json')

if (!store || !clientId || !clientSecret) {
  throw new Error('Missing SHOPIFY_STORE / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET')
}
if (!VERIFY && !APPLY) {
  throw new Error('Specify --verify or --apply')
}
if (VERIFY && APPLY) {
  throw new Error('Specify only one of --verify or --apply')
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const localPath = (id) => path.join(ROOT, 'public/assets/charms/ref', `${id}.png`)
const allCatalogById = new Map(catalog.map((charm) => [charm.id, charm]))
const updateIds = publication.artworkUpdateIds
const dimensionUpdates = publication.metadataUpdates
const newIds = publication.newRecordIds

function fieldsForNewCharm(charm, fileId) {
  const fields = {
    name: charm.name,
    image: fileId,
    category: charm.category,
    tier: charm.tier,
    collection: charm.collection,
    charm_type: String(charm.type),
    price: String(charm.price),
    width_mm: String(charm.widthMm),
    height_mm: String(charm.heightMm),
    px_w: String(charm.pxW),
    px_h: String(charm.pxH),
    min_scale: String(charm.minScale),
    max_scale: String(charm.maxScale),
    hidden: 'false',
    legacy_id: charm.id,
  }
  return Object.entries(fields).map(([key, value]) => ({ key, value }))
}

let token
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
  if (!response.ok || !body.access_token) throw new Error('Shopify token exchange failed')
  return body.access_token
}

async function gql(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
    })
    if (response.status === 429) {
      await sleep(1000 * (attempt + 1))
      continue
    }
    const body = await response.json()
    if (body.errors?.length) {
      if (JSON.stringify(body.errors).includes('THROTTLED')) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      throw new Error(JSON.stringify(body.errors))
    }
    return body.data
  }
  throw new Error('Shopify GraphQL retry limit exceeded')
}

const Q_METAOBJECTS = `
  query($after:String) {
    metaobjects(type:"charme_charm", first:200, after:$after) {
      nodes { id handle fields { key value reference { ... on MediaImage { image { url } } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`
const M_STAGE = `
  mutation($input:[StagedUploadInput!]!) {
    stagedUploadsCreate(input:$input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`
const M_FILE = `
  mutation($files:[FileCreateInput!]!) {
    fileCreate(files:$files) { files { id } userErrors { field message } }
  }`
const M_UPDATE = `
  mutation($id:ID!,$metaobject:MetaobjectUpdateInput!) {
    metaobjectUpdate(id:$id,metaobject:$metaobject) {
      userErrors { field message code }
    }
  }`
const M_CREATE = `
  mutation($input:MetaobjectCreateInput!) {
    metaobjectCreate(metaobject:$input) {
      metaobject { id } userErrors { field message code }
    }
  }`

async function listCharms() {
  const charms = new Map()
  let after = null
  do {
    const data = await gql(Q_METAOBJECTS, { after })
    for (const node of data.metaobjects.nodes) {
      const byKey = new Map(node.fields.map((field) => [field.key, field]))
      const id = byKey.get('legacy_id')?.value
      if (!id) continue
      charms.set(id, { node, fields: byKey })
    }
    after = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
  } while (after)
  return charms
}

async function uploadImage(id, name) {
  const file = localPath(id)
  const bytes = fs.readFileSync(file)
  const staged = await gql(M_STAGE, {
    input: [{ resource: 'FILE', filename: `${id}.png`, mimeType: 'image/png', httpMethod: 'POST' }],
  })
  const stagedErrors = staged.stagedUploadsCreate.userErrors || []
  if (stagedErrors.length) throw new Error(`stage ${id}: ${JSON.stringify(stagedErrors)}`)
  const target = staged.stagedUploadsCreate.stagedTargets[0]
  const form = new FormData()
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value)
  form.append('file', new Blob([bytes], { type: 'image/png' }), `${id}.png`)
  const uploaded = await fetch(target.url, { method: 'POST', body: form })
  if (!uploaded.ok) throw new Error(`upload ${id}: HTTP ${uploaded.status}`)
  const created = await gql(M_FILE, {
    files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: name }],
  })
  const errors = created.fileCreate.userErrors || []
  if (errors.length) throw new Error(`file ${id}: ${JSON.stringify(errors)}`)
  const fileId = created.fileCreate.files[0]?.id
  if (!fileId) throw new Error(`file ${id}: no file id returned`)
  return fileId
}

async function updateFields(id, metaobjectId, fields) {
  const result = await gql(M_UPDATE, { id: metaobjectId, metaobject: { fields } })
  const errors = result.metaobjectUpdate.userErrors || []
  if (errors.length) throw new Error(`update ${id}: ${JSON.stringify(errors)}`)
}

async function verifyLocalManifest() {
  const ids = [...updateIds, ...newIds]
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Publication manifest duplicates ${id}`)
    seen.add(id)
    const charm = allCatalogById.get(id)
    if (!charm) throw new Error(`Local catalogue record missing for ${id}`)
    const file = localPath(id)
    if (!fs.existsSync(file)) throw new Error(`Local artwork missing for ${id}`)
    const metadata = await sharp(file).metadata()
    if (metadata.width !== charm.pxW || metadata.height !== charm.pxH) {
      throw new Error(`${id}: local PNG ${metadata.width}x${metadata.height} differs from catalogue ${charm.pxW}x${charm.pxH}`)
    }
  }
  for (const patch of dimensionUpdates) {
    const charm = allCatalogById.get(patch.id)
    if (!charm) throw new Error(`Local dimensions target missing for ${patch.id}`)
    if (charm.widthMm !== patch.widthMm || charm.heightMm !== patch.heightMm) {
      throw new Error(`${patch.id}: local physical dimensions do not match publication manifest`)
    }
  }
}

function remoteImageUrl(charm) {
  return charm.fields.get('image')?.reference?.image?.url || null
}

async function compareDecodedImage(id, url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${id}: Shopify image returned HTTP ${response.status}`)
  const remote = Buffer.from(await response.arrayBuffer())
  const local = fs.readFileSync(localPath(id))
  const [remoteRaw, localRaw] = await Promise.all([
    sharp(remote).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(local).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  if (remoteRaw.info.width !== localRaw.info.width || remoteRaw.info.height !== localRaw.info.height) {
    throw new Error(`${id}: decoded Shopify image dimensions differ from local artwork`)
  }
  let maxColourDifference = 0
  for (let offset = 0; offset < localRaw.data.length; offset += 4) {
    if (localRaw.data[offset + 3] !== remoteRaw.data[offset + 3]) {
      throw new Error(`${id}: decoded Shopify alpha differs from accepted local artwork`)
    }
    for (let channel = 0; channel < 3; channel++) {
      maxColourDifference = Math.max(
        maxColourDifference,
        Math.abs(localRaw.data[offset + channel] - remoteRaw.data[offset + channel]),
      )
    }
  }
  // Shopify's PNG pipeline can normalize a few RGB values by one level.
  if (maxColourDifference > 1) {
    throw new Error(`${id}: decoded Shopify colour pixels differ from accepted local artwork`)
  }
  return url
}

async function verifyPublishedState(charms) {
  const expectedCount = publication.liveSnapshotRecords + newIds.length
  if (charms.size !== expectedCount) throw new Error(`Expected ${expectedCount} Shopify charms after publication, found ${charms.size}`)
  for (const patch of dimensionUpdates) {
    const fields = charms.get(patch.id).fields
    if (Number(fields.get('width_mm')?.value) !== patch.widthMm || Number(fields.get('height_mm')?.value) !== patch.heightMm) {
      throw new Error(`${patch.id}: Shopify physical dimensions did not persist`)
    }
  }

  const verifiedImages = {}
  let current = charms
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      for (const id of [...updateIds, ...newIds]) {
        const url = remoteImageUrl(current.get(id))
        if (!url) throw new Error(`${id}: Shopify image reference missing`)
        verifiedImages[id] = await compareDecodedImage(id, url)
      }
      break
    } catch (error) {
      if (attempt === 11) throw error
      await sleep(1500)
      current = await listCharms()
    }
  }
  const report = {
    publishedAt: new Date().toISOString(),
    expectedCount,
    actualCount: current.size,
    applied: { artwork: updateIds, dimensions: dimensionUpdates.map((patch) => patch.id), created: newIds },
    decodedImageVerification: Object.keys(verifiedImages),
    imageUrls: verifiedImages,
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

async function main() {
  await verifyLocalManifest()
  token = await accessToken()
  const before = await listCharms()
  const missingUpdates = updateIds.filter((id) => !before.has(id))
  const missingDimensions = dimensionUpdates.map((patch) => patch.id).filter((id) => !before.has(id))
  const existingNew = newIds.filter((id) => before.has(id))
  if (missingUpdates.length || missingDimensions.length || (APPLY && existingNew.length)) {
    throw new Error(JSON.stringify({ missingUpdates, missingDimensions, existingNew }))
  }

  console.log(`${APPLY ? 'APPLY' : 'VERIFY'}: ${updateIds.length} artwork updates, ${dimensionUpdates.length} dimension updates, ${newIds.length} new records`)
  if (!APPLY) {
    if (existingNew.length) {
      if (existingNew.length !== newIds.length) throw new Error(`Only ${existingNew.length}/${newIds.length} new records exist; manual recovery required`)
      const report = await verifyPublishedState(before)
      console.log(`Verified published state: ${report.actualCount} Shopify charms and ${report.decodedImageVerification.length} decoded CDN images.`)
      return
    }
    console.log(`Verified ${before.size} existing Shopify charm records and ${[...new Set([...updateIds, ...newIds])].length} local artwork files.`)
    return
  }

  const applied = { artwork: [], dimensions: [], created: [] }
  for (const id of updateIds) {
    const charm = allCatalogById.get(id)
    const imageId = await uploadImage(id, charm.name)
    await updateFields(id, before.get(id).node.id, [{ key: 'image', value: imageId }])
    applied.artwork.push(id)
    console.log(`Updated artwork ${applied.artwork.length}/${updateIds.length}: ${id}`)
  }
  for (const patch of dimensionUpdates) {
    await updateFields(patch.id, before.get(patch.id).node.id, [
      { key: 'width_mm', value: String(patch.widthMm) },
      { key: 'height_mm', value: String(patch.heightMm) },
    ])
    applied.dimensions.push(patch.id)
    console.log(`Updated dimensions ${applied.dimensions.length}/${dimensionUpdates.length}: ${patch.id}`)
  }
  for (const id of newIds) {
    const charm = allCatalogById.get(id)
    const imageId = await uploadImage(id, charm.name)
    const result = await gql(M_CREATE, {
      input: { type: 'charme_charm', handle: id.toLowerCase(), fields: fieldsForNewCharm(charm, imageId) },
    })
    const errors = result.metaobjectCreate.userErrors || []
    if (errors.length) throw new Error(`create ${id}: ${JSON.stringify(errors)}`)
    applied.created.push(id)
    console.log(`Created charm ${applied.created.length}/${newIds.length}: ${id}`)
  }

  const report = await verifyPublishedState(await listCharms())
  console.log(`Published and verified ${applied.artwork.length} artwork updates, ${applied.dimensions.length} dimension updates, and ${applied.created.length} new charms.`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exit(1)
})