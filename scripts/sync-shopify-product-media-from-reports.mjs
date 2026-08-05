#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { shopifyAdmin } from '../functions/api/_lib.js'

const SOURCE_REPORT_PATHS = argumentValues('source-report')
const COVERAGE_AUDIT_PATH = argumentValue('coverage-audit', '')
const OUTPUT_PATH = argumentValue('output', '')
const CASE_HANDLE = argumentValue('case-handle', 'custom-charm-phone-case')
const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

if (apply && verify) throw new Error('Pass either --verify or --apply, not both')
if (apply) {
  throw new Error('Product-media writes are disabled: case images are customizer-only Shopify Files/metaobject references')
}

function argumentValues(name) {
  return process.argv.flatMap((argument, index) => (
    argument === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ))
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function requireInputs() {
  if (!SOURCE_REPORT_PATHS.length && !COVERAGE_AUDIT_PATH) {
    throw new Error('Pass at least one --source-report or --coverage-audit')
  }
  for (const reportPath of SOURCE_REPORT_PATHS) {
    if (path.isAbsolute(reportPath) || !reportPath.startsWith('reference/case-history/generated/')) {
      throw new Error('--source-report must be under reference/case-history/generated')
    }
  }
  if (COVERAGE_AUDIT_PATH && (
    path.isAbsolute(COVERAGE_AUDIT_PATH)
    || !COVERAGE_AUDIT_PATH.startsWith('reference/case-history/generated/')
  )) throw new Error('--coverage-audit must be under reference/case-history/generated')
  if (apply && (!OUTPUT_PATH || path.isAbsolute(OUTPUT_PATH) || !OUTPUT_PATH.startsWith('reference/case-history/generated/'))) {
    throw new Error('--apply requires --output under reference/case-history/generated')
  }
  const hasClientCredentials = env.SHOPIFY_STORE && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  const hasAdminToken = env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN
  if (!hasClientCredentials && !hasAdminToken) throw new Error('Missing Shopify credentials')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function mapLimit(items, concurrency, callback) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await callback(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

async function fetchPixelIdentity(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'image/png', 'cache-control': 'no-cache' },
      })
      if (!response.ok) throw new Error(`CDN returned ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return {
        pixelSha256: sha256(data),
        pixelWidth: info.width,
        pixelHeight: info.height,
        pixelChannels: info.channels,
      }
    } catch (error) {
      lastError = error
      if (attempt === attempts) throw error
      await sleep(attempt * 500)
    }
  }
  throw lastError
}

function samePixels(left, right) {
  return left?.pixelSha256 === right?.pixelSha256
    && left.pixelWidth === right.pixelWidth
    && left.pixelHeight === right.pixelHeight
    && left.pixelChannels === right.pixelChannels
}

async function admin(query, variables, { retryTransient = true } = {}) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await shopifyAdmin(env, query, variables)
    } catch (error) {
      lastError = error
      const message = error.message || String(error)
      const retryable = /THROTTLED|429/i.test(message)
        || (retryTransient && /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(message))
      if (!retryable || attempt === 5) throw error
      await sleep(attempt * 1000)
    }
  }
  throw lastError
}

function chunks(items, size) {
  const groups = []
  for (let offset = 0; offset < items.length; offset += size) groups.push(items.slice(offset, offset + size))
  return groups
}

function field(node, key) {
  return (node.fields || []).find((item) => item.key === key)
}

function slugModel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const COLOUR_HINTS = ['colour', 'color', 'gel', 'finish']
const MODEL_HINTS = ['model', 'phone', 'device']

function matchesOption(name, hints) {
  return hints.some((hint) => String(name || '').toLowerCase().includes(hint))
}

function optionRoles(options) {
  const colour = options.find((option) => matchesOption(option.name, COLOUR_HINTS))
  const model = options.find((option) => option !== colour && matchesOption(option.name, MODEL_HINTS))
    || options.find((option) => option !== colour)
  return { colour, model }
}

function selectedOption(variant, optionName) {
  return variant.selectedOptions.find((option) => option.name === optionName)?.value || ''
}

function variantFinish(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized.startsWith('black')) return 'black'
  if (normalized.startsWith('white') && !normalized.includes('glitter')) return 'white'
  return null
}

function resultKey(result) {
  return `${result.modelId}\u0000${result.finish}`
}

function productMediaAlt(result) {
  return `Charme without gel ${result.modelId} ${result.finish} ${result.sha256.slice(0, 12)}`
}

function normalizeSourcePath(result) {
  if (result.sourcePath || !result.sourceUrl) return result
  const sourceUrl = new URL(result.sourceUrl)
  if (
    sourceUrl.origin !== 'https://charme-customizer.pages.dev'
    || !sourceUrl.pathname.startsWith('/assets/cases/case-without-gel/')
  ) return result
  return { ...result, sourcePath: `public${decodeURIComponent(sourceUrl.pathname)}` }
}

const Q_FIND_PRODUCT = `
  query($query: String!) {
    products(first: 1, query: $query) {
      nodes { id handle title options { name } }
    }
  }`

const Q_PRODUCT_VARIANTS = `
  query($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        variants(first: 100, after: $after) {
          nodes {
            id
            selectedOptions { name value }
            media(first: 20) {
              nodes { id }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const Q_PRODUCT_MEDIA = `
  query($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        media(first: 100, after: $after) {
          nodes {
            id alt mediaContentType status
            ... on MediaImage { image { url width height } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const Q_MEDIA = `
  query($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id alt mediaContentType status
        image { url width height }
      }
    }
  }`

const Q_FILES = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage { id fileStatus image { url width height } }
    }
  }`

const Q_METAOBJECTS = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject {
        id
        fields {
          key value
          reference { ... on MediaImage { id } }
        }
      }
    }
  }`

const M_MEDIA = `
  mutation($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id alt } }
      mediaUserErrors { field message }
    }
  }`

const M_VARIANTS = `
  mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`

const M_FILE_ALT = `
  mutation($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id alt }
      userErrors { field message code }
    }
  }`

async function loadEntries() {
  let selection = null
  let sourceReportPaths = SOURCE_REPORT_PATHS
  if (COVERAGE_AUDIT_PATH) {
    const audit = JSON.parse(await readFile(COVERAGE_AUDIT_PATH, 'utf8'))
    selection = new Map()
    for (const model of audit.gapModels || []) {
      for (const [finish, target] of Object.entries(model.finishes || {})) {
        const evidence = target.bodyImage?.evidence
        if (!evidence?.reportPath || !target.bodyImage?.id) continue
        const key = `${model.modelId}\u0000${finish}`
        selection.set(key, { fileId: target.bodyImage.id, reportPath: evidence.reportPath })
      }
    }
    if (!selection.size) throw new Error('Coverage audit contains no proven body-image gaps to sync')
    sourceReportPaths = [...new Set([...selection.values()].map((item) => item.reportPath))]
  }

  const entriesByKey = new Map()
  for (const reportPath of sourceReportPaths) {
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    if (!/without-gel/i.test(`${report.campaign || ''} ${report.scope || ''}`)) {
      throw new Error(`Source report is not a Without gel publication: ${reportPath}`)
    }
    const reportMediaByKey = new Map((report.productMedia || []).map((media) => [
      `${media.modelId}\u0000${media.finish}`,
      media,
    ]))
    for (const sourceResult of report.results || []) {
      const result = normalizeSourcePath(sourceResult)
      if (
        !result.modelId
        || !['black', 'white'].includes(result.finish)
        || !result.sha256
        || !result.fileId
        || !result.metaobjectId
        || !result.fieldKey
        || !result.pixelSha256
      ) throw new Error(`Incomplete source result in ${reportPath}`)
      const key = resultKey(result)
      const selected = selection?.get(key)
      if (selection && (
        !selected
        || selected.fileId !== result.fileId
        || selected.reportPath !== reportPath
      )) continue
      const reportedMediaId = reportMediaByKey.get(key)?.mediaId || null
      const existing = entriesByKey.get(key)
      if (existing && existing.result.fileId !== result.fileId) {
        throw new Error(`Conflicting source reports for ${result.modelId}/${result.finish}`)
      }
      if (existing?.reportedMediaId && reportedMediaId && existing.reportedMediaId !== reportedMediaId) {
        throw new Error(`Conflicting Product Media reports for ${result.modelId}/${result.finish}`)
      }
      entriesByKey.set(key, {
        result,
        reportPath,
        reportedMediaId: reportedMediaId || existing?.reportedMediaId || null,
      })
    }
  }
  if (!entriesByKey.size) throw new Error('Source reports contain no image results')
  if (selection) {
    const missing = [...selection.keys()].filter((key) => !entriesByKey.has(key))
    if (missing.length) throw new Error(`Coverage audit selections missing from source reports: ${missing.join(', ')}`)
  }
  return {
    entries: [...entriesByKey.values()].sort((left, right) => resultKey(left.result).localeCompare(resultKey(right.result))),
    sourceReportPaths,
  }
}

async function findProduct() {
  const data = await admin(Q_FIND_PRODUCT, { query: `handle:${CASE_HANDLE}` })
  const product = data.products.nodes[0]
  if (!product || product.handle !== CASE_HANDLE) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
  return product
}

async function productVariants(productId) {
  const variants = []
  let after = null
  do {
    const data = await admin(Q_PRODUCT_VARIANTS, { id: productId, after })
    const page = data.node?.variants
    if (!page) throw new Error(`Could not read variants for ${productId}`)
    variants.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return variants
}

async function productMedia(productId) {
  const media = []
  let after = null
  do {
    const data = await admin(Q_PRODUCT_MEDIA, { id: productId, after })
    const page = data.node?.media
    if (!page) throw new Error(`Could not read media for ${productId}`)
    media.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return media
}

async function nodesByIds(query, ids) {
  const nodes = []
  for (const batch of chunks([...ids], 100)) {
    const data = await admin(query, { ids: batch })
    nodes.push(...(data.nodes || []).filter(Boolean))
  }
  return nodes
}

async function verifySources(entries) {
  const [files, metaobjects] = await Promise.all([
    nodesByIds(Q_FILES, new Set(entries.map(({ result }) => result.fileId))),
    nodesByIds(Q_METAOBJECTS, new Set(entries.map(({ result }) => result.metaobjectId))),
  ])
  const filesById = new Map(files.map((file) => [file.id, file]))
  const metaobjectsById = new Map(metaobjects.map((metaobject) => [metaobject.id, metaobject]))
  await mapLimit(entries, 6, async (entry) => {
    const { result } = entry
    const file = filesById.get(result.fileId)
    if (!file?.image?.url || file.fileStatus !== 'READY') {
      throw new Error(`Source File is missing or not READY for ${result.modelId}/${result.finish}`)
    }
    const metaobject = metaobjectsById.get(result.metaobjectId)
    const bodyField = metaobject && field(metaobject, result.fieldKey)
    if ((bodyField?.reference?.id || bodyField?.value) !== result.fileId) {
      throw new Error(`Metaobject source reference changed for ${result.modelId}/${result.finish}`)
    }
    entry.liveUrl = file.image.url
    entry.sourcePixels = await fetchPixelIdentity(file.image.url)
    const recordedPixels = {
      pixelSha256: result.cdn.pixelSha256,
      pixelWidth: result.cdn.pixelWidth,
      pixelHeight: result.cdn.pixelHeight,
      pixelChannels: result.cdn.pixelChannels,
    }
    if (!samePixels(entry.sourcePixels, recordedPixels)) {
      throw new Error(`Source File pixels changed for ${result.modelId}/${result.finish}`)
    }
  })
}

function targetVariants(entries, product, variants) {
  const { colour, model } = optionRoles(product.options || [])
  if (!colour || !model) throw new Error(`Could not identify model and colour options on ${CASE_HANDLE}`)
  const variantsByKey = new Map()
  for (const variant of variants) {
    const modelId = slugModel(selectedOption(variant, model.name))
    const finish = variantFinish(selectedOption(variant, colour.name))
    if (!modelId || !finish) continue
    if (variant.media.pageInfo.hasNextPage) throw new Error(`Variant ${variant.id} has more than 20 media records`)
    const key = `${modelId}\u0000${finish}`
    variantsByKey.set(key, [...(variantsByKey.get(key) || []), variant])
  }
  for (const entry of entries) {
    const targetVariants = variantsByKey.get(resultKey(entry.result)) || []
    entry.variantIds = targetVariants.map((variant) => variant.id)
    entry.variantMedia = targetVariants.map((variant) => ({
      variantId: variant.id,
      mediaIds: variant.media.nodes.map((item) => item.id),
    }))
    entry.linkedMediaIds = [...new Set(targetVariants.flatMap((variant) => variant.media.nodes.map((item) => item.id)))]
    if (!entry.variantIds.length) {
      throw new Error(`Shopify has no variants for ${entry.result.modelId}/${entry.result.finish}`)
    }
  }
}

async function planReusableMedia(entries, media) {
  const mediaById = new Map(media.map((item) => [item.id, item]))
  await mapLimit(entries, 4, async (entry) => {
    const expectedAlt = productMediaAlt(entry.result)
    const candidateOrigins = new Map()
    function addCandidate(mediaId, origin) {
      if (!mediaId) return
      candidateOrigins.set(mediaId, new Set([...(candidateOrigins.get(mediaId) || []), origin]))
    }
    for (const item of media) {
      if (item.alt === expectedAlt) addCandidate(item.id, 'stable-alt')
    }
    addCandidate(entry.reportedMediaId, 'source-report')
    for (const mediaId of entry.linkedMediaIds) addCandidate(mediaId, 'variant-link')

    const matches = []
    for (const [mediaId, origins] of candidateOrigins) {
      const item = mediaById.get(mediaId)
      if (!item || item.status !== 'READY' || item.mediaContentType !== 'IMAGE' || !item.image?.url) continue
      const pixels = await fetchPixelIdentity(item.image.url)
      if (samePixels(pixels, entry.sourcePixels)) {
        matches.push({ item, origins })
      } else if (origins.has('stable-alt') || origins.has('source-report')) {
        throw new Error(`Recorded Product Media pixels changed for ${entry.result.modelId}/${entry.result.finish}`)
      }
    }
    if (matches.length > 1) {
      throw new Error(`Multiple exact Product Media match ${entry.result.modelId}/${entry.result.finish}`)
    }
    const match = matches[0]
    entry.reusableMediaId = match?.item.id || null
    entry.reuseSource = match
      ? ['stable-alt', 'source-report', 'variant-link'].find((origin) => match.origins.has(origin))
      : null
    entry.currentVariantIds = entry.reusableMediaId
      ? entry.variantMedia
        .filter((variant) => variant.mediaIds.includes(entry.reusableMediaId))
        .map((variant) => variant.variantId)
      : []
  })
}

async function ensureProductMedia(mediaId, expectedAlt, expectedPixels) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const data = await admin(Q_MEDIA, { id: mediaId })
    const media = data.node
    if (!media) throw new Error(`Shopify Product Media ${mediaId} was not found`)
    if (media.status === 'FAILED') throw new Error(`Shopify Product Media ${mediaId} failed processing`)
    if (media.status !== 'READY') {
      await sleep(1000)
      continue
    }
    if (!media.image?.url || !samePixels(await fetchPixelIdentity(media.image.url), expectedPixels)) {
      throw new Error(`Product Media pixels changed for ${mediaId}`)
    }
    if (media.alt === expectedAlt) return 'current'

    const updated = await admin(M_FILE_ALT, { files: [{ id: mediaId, alt: expectedAlt }] })
    const errors = updated.fileUpdate.userErrors || []
    if (errors.length) throw new Error(`fileUpdate: ${JSON.stringify(errors)}`)
    const readback = await admin(Q_MEDIA, { id: mediaId })
    if (readback.node?.alt !== expectedAlt) {
      throw new Error(`Product Media alt readback failed for ${mediaId}`)
    }
    return 'updated'
  }
  throw new Error(`Shopify Product Media ${mediaId} did not become READY`)
}

async function createOrReuseMedia(product, media, entry) {
  const alt = productMediaAlt(entry.result)
  let mediaId = entry.reusableMediaId
  let mediaStatus = 'reused'
  if (!mediaId) {
    const created = await admin(M_MEDIA, {
      productId: product.id,
      media: [{ originalSource: entry.liveUrl, mediaContentType: 'IMAGE', alt }],
    }, { retryTransient: false })
    const errors = created.productCreateMedia.mediaUserErrors || []
    if (errors.length) throw new Error(`productCreateMedia: ${JSON.stringify(errors)}`)
    mediaId = created.productCreateMedia.media[0]?.id || null
    if (!mediaId) throw new Error(`Shopify created no media for ${entry.result.modelId}/${entry.result.finish}`)
    media.push({ id: mediaId, alt })
    mediaStatus = 'created'
  }

  const altStatus = await ensureProductMedia(mediaId, alt, entry.sourcePixels)
  const variantIdsUpdated = entry.variantIds.filter((variantId) => !entry.currentVariantIds.includes(variantId))
  for (const batch of chunks(variantIdsUpdated, 100)) {
    const updated = await admin(M_VARIANTS, {
      productId: product.id,
      variants: batch.map((id) => ({ id, mediaId })),
    })
    const errors = updated.productVariantsBulkUpdate.userErrors || []
    if (errors.length) throw new Error(`productVariantsBulkUpdate: ${JSON.stringify(errors)}`)
  }
  return {
    modelId: entry.result.modelId,
    finish: entry.result.finish,
    mediaId,
    mediaStatus,
    altStatus,
    expectedAlt: alt,
    variantIds: entry.variantIds,
    variantIdsUpdated,
  }
}

async function assertReadback(product, synced) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const [media, variants] = await Promise.all([productMedia(product.id), productVariants(product.id)])
    const mediaById = new Map(media.map((item) => [item.id, item]))
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]))
    const complete = synced.every((item) => (
      mediaById.get(item.mediaId)?.status === 'READY'
      && mediaById.get(item.mediaId)?.alt === item.expectedAlt
      && item.variantIds.every((variantId) => (
        variantsById.get(variantId)?.media.nodes.some((mediaItem) => mediaItem.id === item.mediaId)
      ))
    ))
    if (complete) return
    if (attempt < 20) await sleep(1000)
  }
  throw new Error('Product Media or variant associations did not become READY during readback')
}

async function main() {
  requireInputs()
  const { entries, sourceReportPaths } = await loadEntries()
  const product = await findProduct()
  const [variants, media] = await Promise.all([productVariants(product.id), productMedia(product.id)])
  await verifySources(entries)
  targetVariants(entries, product, variants)
  await planReusableMedia(entries, media)
  const associationCount = entries.reduce((count, entry) => count + entry.variantIds.length, 0)
  const existingAssociationCount = entries.reduce((count, entry) => count + entry.currentVariantIds.length, 0)
  const existingMediaCount = entries.filter((entry) => entry.reusableMediaId).length
  console.log(`${apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY RUN'}: ${entries.length} validated Files -> ${associationCount} variants`)
  console.log(`- exact reusable Product Media: ${existingMediaCount}/${entries.length}`)
  console.log(`- creation required: ${entries.length - existingMediaCount}/${entries.length}`)
  console.log(`- current exact variant associations: ${existingAssociationCount}/${associationCount}`)
  if (!apply) return

  const synced = []
  for (const entry of entries) {
    const result = await createOrReuseMedia(product, media, entry)
    synced.push(result)
    console.log(`${result.mediaStatus === 'created' ? 'Created' : 'Reused'}: ${result.modelId}/${result.finish} -> ${result.variantIds.length} variants`)
  }
  await assertReadback(product, synced)
  const report = {
    schemaVersion: 1,
    campaign: 'report-backed-without-gel-product-media-sync',
    appliedAt: new Date().toISOString(),
    sourceReports: sourceReportPaths,
    scope: 'Previously validated Without gel Shopify Files; Product Media and variant associations only; no File or metaobject updates.',
    summary: {
      selected: entries.length,
      productMediaCreated: synced.filter((item) => item.mediaStatus === 'created').length,
      productMediaReused: synced.filter((item) => item.mediaStatus === 'reused').length,
      productMediaAltsUpdated: synced.filter((item) => item.altStatus === 'updated').length,
      productVariantsUpdated: synced.reduce((count, item) => count + item.variantIdsUpdated.length, 0),
      productTargetsCreated: 0,
    },
    results: entries.map((entry) => entry.result),
    productMedia: synced,
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Completed readback: ${synced.length} READY Product Media -> ${associationCount} variants`)
  console.log(`Report: ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})