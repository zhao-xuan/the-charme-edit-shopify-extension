#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { shopifyAdmin, uploadImageFile } from '../functions/api/_lib.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOTE_SOURCE_DIR = path.resolve(process.env.HOME || '', 'Downloads', 'Tote bag cutout photo')
const REPORT_PATH = path.join(ROOT, 'reference', 'shopify-customizer-product-image-sync-report.json')
const CUSTOMIZER_BASE_URL = argValue('customizer-base-url') || 'https://charme-customizer.pages.dev'
const METAOBJECT_TYPE = 'charme_product'
const apply = process.argv.includes('--apply')
const casesOnly = process.argv.includes('--cases-only')
const totesOnly = process.argv.includes('--totes-only')
const includeTotes = !casesOnly
const includeCases = !totesOnly
const createMissing = process.argv.includes('--create-missing')
const onlyArg = argValue('only')
const only = onlyArg ? new Set(onlyArg.split(',').map((item) => item.trim()).filter(Boolean)) : null

if (apply && (!process.env.SHOPIFY_STORE || (!(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) && !process.env.SHOPIFY_ADMIN_TOKEN))) {
  throw new Error('Missing Shopify auth env. Set SHOPIFY_STORE plus SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET or SHOPIFY_ADMIN_TOKEN before --apply.')
}

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function field(node, key) {
  return (node.fields || []).find((item) => item.key === key)
}

function refInfo(node, key) {
  const item = field(node, key)
  return {
    id: item?.reference?.id || item?.value || null,
    url: item?.reference?.image?.url || null,
    status: item?.reference?.fileStatus || null,
  }
}

function fieldsMap(node) {
  return Object.fromEntries((node.fields || []).map((item) => [item.key, item.value]))
}

async function admin(query, variables) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await shopifyAdmin(process.env, query, variables)
    } catch (error) {
      if (!/THROTTLED|429/i.test(error.message || String(error)) || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
}

const Q_DEFINITION = `
  query {
    metaobjectDefinitionByType(type: "${METAOBJECT_TYPE}") {
      fieldDefinitions { key }
    }
  }`
const Q_PRODUCTS = `
  query($after: String) {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 250, after: $after) {
      edges {
        node {
          id
          handle
          fields {
            key
            value
            reference {
              ... on MediaImage { id fileStatus image { url width height } }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`
const M_UPDATE = `
  mutation($id: ID!, $fields: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      userErrors { field message code }
    }
  }`
const M_CREATE = `
  mutation($input: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $input) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }`

async function productMetaobjects() {
  const byLegacy = new Map()
  let after = null
  do {
    const data = await admin(Q_PRODUCTS, { after })
    const connection = data.metaobjects
    for (const edge of connection.edges || []) {
      const legacyId = field(edge.node, 'legacy_id')?.value || edge.node.handle
      if (legacyId) byLegacy.set(legacyId, edge.node)
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
  } while (after)
  return byLegacy
}

async function bundledProducts() {
  if (!globalThis.__CHARME_REMOTE__) {
    const response = await fetch(new URL('/api/catalog', CUSTOMIZER_BASE_URL).href, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (response.ok) globalThis.__CHARME_REMOTE__ = await response.json()
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'charme-products-'))
  const outfile = path.join(temp, 'products.mjs')
  try {
    execFileSync(
      path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
      [
        path.join(ROOT, 'src', 'data', 'products.js'),
        '--bundle',
        '--format=esm',
        '--platform=node',
        `--banner:js=globalThis.window={CharmeConfig:{apiBase:${JSON.stringify(CUSTOMIZER_BASE_URL)}},location:{hostname:'charme-customizer.pages.dev'}};globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};`,
        `--outfile=${outfile}`,
      ],
      { cwd: ROOT, stdio: 'pipe' },
    )
    const mod = await import(pathToFileURL(outfile).href)
    return mod.allProducts()
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function productSource(relativePath) {
  if (!relativePath) return null
  if (/^https?:/i.test(relativePath)) return relativePath
  const localPath = path.join(ROOT, relativePath.replace(/^\//, 'public/'))
  return existsSync(localPath) ? localPath : new URL(relativePath, CUSTOMIZER_BASE_URL).href
}

function toteTargets() {
  const specs = [
    ['tote-cream-white', 'The Charmé Edit Tote - Cream White', 'Cream White - Front.png', 'Cream White - Back.png'],
    ['tote-deep-navy', 'The Charmé Edit Tote - Deep Navy', 'Deep Navy - Front.png', 'Deep Navy - Back.png'],
    ['tote-olive-green', 'The Charmé Edit Tote - Olive Green', 'Olive Green- Front.png', 'Olive Green - Back.png'],
  ]
  const widthMm = 420
  const heightMm = Number((widthMm * (6160 / 4640)).toFixed(1))
  return specs.flatMap(([id, name, frontName, backName]) => {
    if (only && !only.has(id)) return []
    return [
      {
        id,
        name,
        kind: 'tote',
        basePrice: 16,
        widthMm,
        heightMm,
        fieldKey: 'body_image_white',
        finish: 'front',
        source: path.join(TOTE_SOURCE_DIR, frontName),
      },
      {
        id,
        name,
        kind: 'tote',
        basePrice: 16,
        widthMm,
        heightMm,
        fieldKey: 'body_image_black',
        finish: 'back',
        source: path.join(TOTE_SOURCE_DIR, backName),
      },
    ]
  })
}

async function phoneTargets() {
  const products = await bundledProducts()
  const targets = []
  for (const product of products) {
    if (product.kind !== 'phone') continue
    if (only && !only.has(product.id)) continue
    const images = product.blankImage || {}
    for (const [finish, fieldKey] of [['white', 'body_image_white'], ['black', 'body_image_black']]) {
      const source = productSource(images[finish])
      if (!source) continue
      targets.push({
        id: product.id,
        name: product.name,
        kind: 'phone',
        basePrice: Number(product.basePrice) || 26,
        widthMm: Number(product.widthMm) || 75,
        heightMm: Number(product.heightMm) || 150,
        shopifyVariantId: product.shopifyVariantId || '',
        fieldKey,
        finish,
        source,
      })
    }
  }
  return targets
}

async function sourceBytes(source) {
  if (/^https?:/i.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`fetch ${response.status}: ${source}`)
    return Buffer.from(await response.arrayBuffer())
  }
  if (!existsSync(source)) throw new Error(`missing source: ${source}`)
  return readFile(source)
}

async function sourceEvidence(source, target) {
  let bytes = await sourceBytes(source)
  let meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height) throw new Error(`cannot decode image: ${source}`)
  if (target.kind === 'tote' && meta.width * meta.height > 20_000_000) {
    bytes = await sharp(bytes)
      .resize({ width: 1800, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer()
    meta = await sharp(bytes).metadata()
  }
  return { bytes, sha256: sha256(bytes), width: meta.width, height: meta.height, hasAlpha: !!meta.hasAlpha }
}

function createFields(target, fileId) {
  const fields = [
    { key: 'name', value: target.name },
    { key: 'kind', value: target.kind },
    { key: 'base_price', value: String(target.basePrice) },
    { key: 'width_mm', value: String(target.widthMm) },
    { key: 'height_mm', value: String(target.heightMm) },
    { key: target.fieldKey, value: fileId },
    { key: 'legacy_id', value: target.id },
  ]
  if (target.shopifyVariantId) fields.push({ key: 'shopify_variant_id', value: String(target.shopifyVariantId) })
  return fields
}

async function createTarget(target, fileId) {
  const result = await admin(M_CREATE, {
    input: { type: METAOBJECT_TYPE, handle: slug(target.id), fields: createFields(target, fileId) },
  })
  const errors = result.metaobjectCreate.userErrors || []
  if (errors.length) throw new Error(`create ${target.id}: ${JSON.stringify(errors)}`)
  return result.metaobjectCreate.metaobject.id
}

async function updateTarget(metaobject, target, fileId) {
  const fields = [
    { key: target.fieldKey, value: fileId },
    { key: 'name', value: target.name },
    { key: 'kind', value: target.kind },
    { key: 'width_mm', value: String(target.widthMm) },
    { key: 'height_mm', value: String(target.heightMm) },
  ]
  if (target.kind === 'tote') fields.push({ key: 'base_price', value: String(target.basePrice) })
  const result = await admin(M_UPDATE, { id: metaobject.id, fields })
  const errors = result.metaobjectUpdate.userErrors || []
  if (errors.length) throw new Error(`update ${target.id}: ${JSON.stringify(errors)}`)
}

async function main() {
  const targets = [
    ...(includeTotes ? toteTargets() : []),
    ...(includeCases ? await phoneTargets() : []),
  ]
  const evidences = []
  for (const target of targets) {
    let evidence
    try {
      evidence = await sourceEvidence(target.source, target)
    } catch (error) {
      throw new Error(`${target.id}/${target.finish}: ${error.message || error} (${target.source})`)
    }
    evidences.push({ target, evidence })
  }

  if (!apply) {
    for (const { target, evidence } of evidences) {
      console.log(`[dry] ${target.id} ${target.finish} ${target.fieldKey} ${evidence.width}x${evidence.height} alpha=${evidence.hasAlpha} ${target.source}`)
    }
    console.log(`[dry] planned ${evidences.length} image field update(s). Pass --apply to write Shopify Files + ${METAOBJECT_TYPE}; Product Media is never touched.`)
    return
  }

  const definition = await admin(Q_DEFINITION)
  const definitionKeys = new Set((definition.metaobjectDefinitionByType?.fieldDefinitions || []).map((item) => item.key))
  for (const required of ['legacy_id', 'name', 'kind', 'base_price', 'width_mm', 'height_mm', 'body_image_white', 'body_image_black']) {
    if (!definitionKeys.has(required)) throw new Error(`${METAOBJECT_TYPE} definition is missing ${required}`)
  }

  const metaobjects = await productMetaobjects()
  const results = []
  for (const { target, evidence } of evidences) {
    const existing = metaobjects.get(target.id)
    if (!existing && !createMissing && target.kind === 'phone') {
      results.push({ status: 'missing-metaobject', id: target.id, finish: target.finish, sourceSha256: evidence.sha256 })
      console.log(`Missing metaobject: ${target.id} ${target.finish}`)
      continue
    }
    const current = existing ? refInfo(existing, target.fieldKey) : { id: null, url: null }
    const filename = `${target.id}-${target.finish}-customizer-${evidence.sha256.slice(0, 12)}.png`
    const file = await uploadImageFile(process.env, evidence.bytes, {
      filename,
      contentType: 'image/png',
      alt: `${target.name} ${target.finish} customizer image`,
    })
    if (!file.id || !file.url) throw new Error(`Shopify file was not ready for ${target.id}/${target.finish}`)
    let metaobjectId = existing?.id || null
    if (existing) await updateTarget(existing, target, file.id)
    else {
      metaobjectId = await createTarget(target, file.id)
      metaobjects.set(target.id, { id: metaobjectId, fields: [] })
    }
    results.push({
      status: current.id === file.id ? 'already-current' : 'updated',
      id: target.id,
      name: target.name,
      kind: target.kind,
      finish: target.finish,
      fieldKey: target.fieldKey,
      metaobjectId,
      fileId: file.id,
      url: file.url,
      sourceSha256: evidence.sha256,
      width: evidence.width,
      height: evidence.height,
    })
    console.log(`Updated ${target.id} ${target.finish} -> ${file.url}`)
  }

  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    policy: 'Shopify Files + charme_product body image fields only; no Product Media or variant media updates.',
    counts: {
      targets: evidences.length,
      updated: results.filter((item) => item.status === 'updated').length,
      missingMetaobject: results.filter((item) => item.status === 'missing-metaobject').length,
    },
    results,
  }, null, 2)}\n`)
  console.log(`Report written: ${path.relative(ROOT, REPORT_PATH)}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
