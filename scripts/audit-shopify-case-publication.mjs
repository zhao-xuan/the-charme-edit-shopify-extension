#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { shopifyAdmin } from '../functions/api/_lib.js'

const REPORT_PATH = argumentValue('report', '')
const OUTPUT_PATH = argumentValue('output', '')
const CASE_HANDLE = argumentValue('case-handle', 'custom-charm-phone-case')
const METAOBJECT_TYPE = 'charme_product'
const SHOPIFY_PIXEL_TOLERANCE = {
  maximumChannelDelta: 1,
  maximumChangedPixelFraction: 0.00001,
}
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function requireInputs() {
  if (!REPORT_PATH) throw new Error('Pass --report with a Shopify publication report')
  if (path.isAbsolute(REPORT_PATH) || !REPORT_PATH.startsWith('reference/case-history/generated/')) {
    throw new Error('--report must be under reference/case-history/generated')
  }
  if (OUTPUT_PATH && (path.isAbsolute(OUTPUT_PATH) || !OUTPUT_PATH.startsWith('reference/case-history/generated/'))) {
    throw new Error('--output must be under reference/case-history/generated')
  }
  const hasClientCredentials = env.SHOPIFY_STORE && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  const hasAdminToken = env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN
  if (!hasClientCredentials && !hasAdminToken) throw new Error('Missing Shopify credentials')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function admin(query, variables) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await shopifyAdmin(env, query, variables)
    } catch (error) {
      lastError = error
      if (!/THROTTLED|429/i.test(error.message || String(error)) || attempt === 5) throw error
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

const Q_FIND_PRODUCT = `
  query($query: String!) {
    products(first: 1, query: $query) {
      nodes { id handle title }
    }
  }`

const Q_PRODUCT_MEDIA = `
  query($id: ID!, $after: String) {
    node(id: $id) {
      ... on Product {
        media(first: 100, after: $after) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
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
        id type
        fields {
          key value
          reference { ... on MediaImage { id } }
        }
      }
    }
  }`

async function loadScope() {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'))
  const results = report.results || []
  const productMedia = report.productMedia || []
  const requestedTargets = report.requestedTargets || report.createdTargets || []
  if (!results.length) throw new Error('Report contains no image results')
  if (productMedia.length && productMedia.length !== results.length) {
    throw new Error(`Legacy report has ${results.length} image results and ${productMedia.length} product-media records`)
  }

  const resultsByKey = new Map()
  for (const result of results) {
    const key = `${result.modelId}\u0000${result.finish}`
    if (resultsByKey.has(key)) throw new Error(`Duplicate image result for ${result.modelId}/${result.finish}`)
    if (!result.fileId || !result.metaobjectId || !result.fieldKey || !result.pixelSha256 || !result.sourcePath) {
      throw new Error(`Incomplete image result for ${result.modelId}/${result.finish}`)
    }
    resultsByKey.set(key, result)
  }

  const legacyMediaByKey = new Map(productMedia.map((media) => {
    const key = `${media.modelId}\u0000${media.finish}`
    if (!resultsByKey.has(key) || !media.mediaId) {
      throw new Error(`Incomplete legacy product-media record for ${media.modelId}/${media.finish}`)
    }
    return [key, media.mediaId]
  }))
  const entries = results.map((result) => ({
    result,
    legacyMediaId: legacyMediaByKey.get(`${result.modelId}\u0000${result.finish}`) || null,
  }))
  const mediaIds = new Set([...legacyMediaByKey.values()])
  const sourceFileIds = new Set(results.map((result) => result.fileId))
  if (mediaIds.size !== productMedia.length) throw new Error('Legacy report contains duplicate product-media IDs')
  if (sourceFileIds.size !== results.length) throw new Error('Report contains duplicate source File IDs')

  return { report, results, entries, mediaIds, sourceFileIds, requestedTargets }
}

async function findProduct() {
  const data = await admin(Q_FIND_PRODUCT, { query: `handle:${CASE_HANDLE}` })
  const product = data.products.nodes[0]
  if (!product || product.handle !== CASE_HANDLE) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
  return product
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

async function expectedPixels(result, sourceFileUrl) {
  let image = sharp(await readFile(result.sourcePath))
  if (result.sourceCrop) {
    image = image.extract({
      left: result.sourceCrop.left,
      top: result.sourceCrop.top,
      width: result.sourceCrop.width,
      height: result.sourceCrop.height,
    })
  }
  const pixels = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const localPixelSha256 = sha256(pixels.data)
  if (localPixelSha256 === result.pixelSha256) {
    return { pixels, source: 'local-publication-source', localPixelSha256 }
  }

  const response = await fetch(sourceFileUrl, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`CDN returned ${response.status} for ${sourceFileUrl}`)
  const sourceFilePixels = await sharp(Buffer.from(await response.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (sha256(sourceFilePixels.data) !== result.pixelSha256) {
    throw new Error(`Neither local nor live publication pixels match for ${result.modelId}/${result.finish}`)
  }
  return { pixels: sourceFilePixels, source: 'recorded-source-file-hash', localPixelSha256 }
}

function pixelDifference(expected, actual) {
  if (
    expected.info.width !== actual.info.width
    || expected.info.height !== actual.info.height
    || expected.info.channels !== actual.info.channels
  ) {
    return { dimensionsMatch: false, changedPixels: null, changedPixelFraction: 1, alphaChanges: null, maximumChannelDelta: 255 }
  }
  let changedPixels = 0
  let alphaChanges = 0
  let maximumChannelDelta = 0
  for (let offset = 0; offset < expected.data.length; offset += expected.info.channels) {
    let pixelChanged = false
    for (let channel = 0; channel < expected.info.channels; channel += 1) {
      const delta = Math.abs(expected.data[offset + channel] - actual.data[offset + channel])
      if (delta) pixelChanged = true
      if (channel === 3 && delta) alphaChanges += 1
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
    }
    if (pixelChanged) changedPixels += 1
  }
  const totalPixels = expected.info.width * expected.info.height
  return {
    dimensionsMatch: true,
    changedPixels,
    changedPixelFraction: changedPixels / totalPixels,
    alphaChanges,
    maximumChannelDelta,
  }
}

async function fetchDecoded(url, expected) {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`CDN returned ${response.status} for ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const difference = pixelDifference(expected, actual)
  const exact = sha256(actual.data) === sha256(expected.data)
  const acceptable = exact || (
    difference.dimensionsMatch
    && difference.alphaChanges === 0
    && difference.maximumChannelDelta <= SHOPIFY_PIXEL_TOLERANCE.maximumChannelDelta
    && difference.changedPixelFraction <= SHOPIFY_PIXEL_TOLERANCE.maximumChangedPixelFraction
  )
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    byteSha256: sha256(bytes),
    pixelSha256: sha256(actual.data),
    width: actual.info.width,
    height: actual.info.height,
    channels: actual.info.channels,
    exact,
    acceptable,
    difference,
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function main() {
  requireInputs()
  const scope = await loadScope()
  const product = await findProduct()
  const [liveMedia, liveFiles, liveMetaobjects] = await Promise.all([
    productMedia(product.id),
    nodesByIds(Q_FILES, scope.sourceFileIds),
    nodesByIds(Q_METAOBJECTS, new Set(scope.results.map((result) => result.metaobjectId))),
  ])
  const liveMediaIds = new Set(liveMedia.map((media) => media.id))
  const filesById = new Map(liveFiles.map((file) => [file.id, file]))
  const metaobjectsById = new Map(liveMetaobjects.map((metaobject) => [metaobject.id, metaobject]))

  const targetReadback = scope.requestedTargets.map((target) => {
    const result = scope.results.find((entry) => entry.modelId === target.modelId)
    const metaobject = result ? metaobjectsById.get(result.metaobjectId) : null
    const fields = new Map((metaobject?.fields || []).map((item) => [item.key, item.value]))
    const actual = {
      name: fields.get('name') || null,
      kind: fields.get('kind') || null,
      basePrice: Number(fields.get('base_price')),
      widthMm: Number(fields.get('width_mm')),
      heightMm: Number(fields.get('height_mm')),
      legacyId: fields.get('legacy_id') || null,
    }
    const matches = metaobject?.type === METAOBJECT_TYPE
      && actual.name === target.name
      && actual.kind === target.kind
      && actual.basePrice === target.basePrice
      && actual.widthMm === target.widthMm
      && actual.heightMm === target.heightMm
      && actual.legacyId === target.modelId
    return {
      modelId: target.modelId,
      metaobjectId: metaobject?.id || null,
      expected: target,
      actual,
      matches,
    }
  })

  const forbiddenReportedMediaPresent = [...scope.mediaIds].filter((mediaId) => liveMediaIds.has(mediaId))

  const imageReadback = await mapLimit(scope.entries, 3, async (entry) => {
    const { result } = entry
    const file = filesById.get(result.fileId)
    const metaobject = metaobjectsById.get(result.metaobjectId)
    const field = metaobject?.fields.find((item) => item.key === result.fieldKey)
    if (!file?.image?.url) throw new Error(`Source File is missing for ${result.modelId}/${result.finish}`)
    const expected = await expectedPixels(result, file.image.url)
    const sourceFileCdn = await fetchDecoded(file.image.url, expected.pixels)
    return {
      modelId: result.modelId,
      finish: result.finish,
      expectedPixelSource: expected.source,
      localPixelSha256: expected.localPixelSha256,
      sourceFileId: result.fileId,
      sourceFileStatus: file.fileStatus,
      metaobjectId: result.metaobjectId,
      fieldKey: result.fieldKey,
      metaobjectReferenceMatches: metaobject?.type === METAOBJECT_TYPE
        && (field?.reference?.id || field?.value) === result.fileId,
      legacyProductMediaId: entry.legacyMediaId,
      legacyProductMediaAbsent: !entry.legacyMediaId || !liveMediaIds.has(entry.legacyMediaId),
      sourceFileCdn,
    }
  })

  const summary = {
    requestedTargets: targetReadback.length,
    targetDefinitionsMatched: targetReadback.filter((entry) => entry.matches).length,
    images: scope.entries.length,
    localExpectedPixelMatches: imageReadback.filter((entry) => entry.expectedPixelSource === 'local-publication-source').length,
    recordedSourceFileHashFallbacks: imageReadback.filter((entry) => entry.expectedPixelSource === 'recorded-source-file-hash').length,
    sourceFilesReady: imageReadback.filter((entry) => entry.sourceFileStatus === 'READY').length,
    metaobjectReferencesMatched: imageReadback.filter((entry) => entry.metaobjectReferenceMatches).length,
    legacyProductMediaIdsRecorded: scope.mediaIds.size,
    forbiddenReportedProductMediaPresent: forbiddenReportedMediaPresent.length,
    sourceFileExactPixelMatches: imageReadback.filter((entry) => entry.sourceFileCdn.exact).length,
    sourceFileAcceptablePixelMatches: imageReadback.filter((entry) => entry.sourceFileCdn.acceptable).length,
  }
  const expectedImages = scope.entries.length
  const valid = (
    summary.targetDefinitionsMatched === summary.requestedTargets
    && summary.sourceFilesReady === expectedImages
    && summary.metaobjectReferencesMatched === expectedImages
    && summary.forbiddenReportedProductMediaPresent === 0
    && summary.sourceFileAcceptablePixelMatches === expectedImages
  )
  const audit = {
    schemaVersion: 2,
    auditedAt: new Date().toISOString(),
    scope: 'customizer-only-shopify-files-and-charme-product-references',
    productMediaRequired: false,
    variantMediaRequired: false,
    sourceReport: REPORT_PATH,
    product: { id: product.id, handle: product.handle, title: product.title },
    valid,
    summary,
    targets: targetReadback,
    images: imageReadback,
  }
  if (OUTPUT_PATH) {
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify(audit, null, 2)}\n`)
  }
  console.log(JSON.stringify({ valid, summary, output: OUTPUT_PATH || null }, null, 2))
  if (!valid) throw new Error('Shopify publication readback did not match the source report')
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})