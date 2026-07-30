#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { shopifyAdmin } from '../functions/api/_lib.js'

const REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-all-case-review-source-upload-report.json'
const CASE_HANDLE = argumentValue('case-handle', 'custom-charm-phone-case')
const EXPECTED_MEDIA_COUNT = 68
const EXPECTED_ASSOCIATION_COUNT = 136
const apply = process.argv.includes('--apply')

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

function requireCredentials() {
  const hasClientCredentials = env.SHOPIFY_STORE && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  const hasAdminToken = env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN
  if (!hasClientCredentials && !hasAdminToken) {
    throw new Error('Missing Shopify credentials')
  }
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

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function chunks(items, size) {
  const groups = []
  for (let offset = 0; offset < items.length; offset += size) groups.push(items.slice(offset, offset + size))
  return groups
}

function pairKey(variantId, mediaId) {
  return `${variantId}\u0000${mediaId}`
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
          nodes { id alt mediaContentType status }
          pageInfo { hasNextPage endCursor }
        }
      }
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
            media(first: 5) {
              nodes { id }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const Q_VARIANT_MEDIA = `
  query($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProductVariant {
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
      ... on MediaImage { id fileStatus image { url } }
    }
  }`

const Q_METAOBJECTS = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Metaobject {
        id
        fields {
          key
          value
          reference { ... on MediaImage { id } }
        }
      }
    }
  }`

const M_DETACH = `
  mutation($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      product { id }
      userErrors { field message }
    }
  }`

const M_DELETE_PRODUCT_MEDIA = `
  mutation($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors { field message }
    }
  }`

async function loadScope() {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'))
  const productMedia = report.productMedia || []
  if (productMedia.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error(`Expected ${EXPECTED_MEDIA_COUNT} report media records, found ${productMedia.length}`)
  }

  const resultsByKey = new Map((report.results || []).map((result) => [
    `${result.modelId}\u0000${result.finish}`,
    result,
  ]))
  const entries = productMedia.map((media) => {
    const result = resultsByKey.get(`${media.modelId}\u0000${media.finish}`)
    if (!result) throw new Error(`Missing source result for ${media.modelId}/${media.finish}`)
    if (media.mediaStatus !== 'created') {
      throw new Error(`Refusing non-created product media ${media.mediaId}`)
    }
    return {
      ...media,
      expectedAlt: `Charme without gel ${media.modelId} ${media.finish} ${result.sha256.slice(0, 12)}`,
      sourceFileId: result.fileId,
      metaobjectId: result.metaobjectId,
      fieldKey: result.fieldKey,
    }
  })

  const mediaIds = new Set(entries.map((entry) => entry.mediaId))
  const sourceFileIds = new Set(entries.map((entry) => entry.sourceFileId))
  const pairs = entries.flatMap((entry) => entry.variantIds.map((variantId) => ({
    variantId,
    mediaId: entry.mediaId,
  })))
  const pairIds = new Set(pairs.map(({ variantId, mediaId }) => pairKey(variantId, mediaId)))
  const variantIds = new Set(pairs.map(({ variantId }) => variantId))

  if (mediaIds.size !== EXPECTED_MEDIA_COUNT) throw new Error('Report contains duplicate product media IDs')
  if (sourceFileIds.size !== EXPECTED_MEDIA_COUNT) throw new Error('Report contains duplicate source File IDs')
  if ([...mediaIds].some((id) => sourceFileIds.has(id))) {
    throw new Error('Product media IDs overlap source File IDs')
  }
  if (pairs.length !== EXPECTED_ASSOCIATION_COUNT || pairIds.size !== EXPECTED_ASSOCIATION_COUNT) {
    throw new Error(`Expected ${EXPECTED_ASSOCIATION_COUNT} unique associations, found ${pairIds.size}`)
  }
  if (variantIds.size !== EXPECTED_ASSOCIATION_COUNT) {
    throw new Error('A report variant is associated with more than one target media record')
  }

  return { entries, mediaIds, sourceFileIds, pairs, pairIds, variantIds }
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

async function allVariantMedia(variantId) {
  const media = []
  let after = null
  do {
    const data = await admin(Q_VARIANT_MEDIA, { id: variantId, after })
    const page = data.node?.media
    if (!page) throw new Error(`Could not read media for variant ${variantId}`)
    media.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return media
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

  for (const variant of variants.filter((item) => item.media.pageInfo.hasNextPage)) {
    variant.media.nodes = await allVariantMedia(variant.id)
  }
  return variants
}

async function audit(product, scope) {
  const [media, variants, filesData, metaobjectsData] = await Promise.all([
    productMedia(product.id),
    productVariants(product.id),
    admin(Q_FILES, { ids: [...scope.sourceFileIds] }),
    admin(Q_METAOBJECTS, { ids: [...new Set(scope.entries.map((entry) => entry.metaobjectId))] }),
  ])
  const mediaById = new Map(media.map((item) => [item.id, item]))
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]))
  const filesById = new Map((filesData.nodes || []).filter(Boolean).map((file) => [file.id, file]))
  const metaobjectsById = new Map((metaobjectsData.nodes || []).filter(Boolean).map((node) => [node.id, node]))

  const presentPairs = scope.pairs.filter(({ variantId, mediaId }) => (
    variantsById.get(variantId)?.media.nodes.some((item) => item.id === mediaId)
  ))
  const liveReportPairs = new Set()
  for (const variant of variants) {
    for (const item of variant.media.nodes) {
      if (scope.mediaIds.has(item.id)) liveReportPairs.add(pairKey(variant.id, item.id))
    }
  }

  const metaobjectMatches = scope.entries.filter((entry) => {
    const metaobject = metaobjectsById.get(entry.metaobjectId)
    const field = metaobject?.fields.find((item) => item.key === entry.fieldKey)
    return (field?.reference?.id || field?.value) === entry.sourceFileId
  })

  return {
    media,
    variants,
    productMediaIds: new Set(media.map((item) => item.id)),
    reportedMediaPresent: scope.entries.filter((entry) => mediaById.has(entry.mediaId)),
    wrongAlts: scope.entries.flatMap((entry) => {
      const actual = mediaById.get(entry.mediaId)?.alt
      return actual !== undefined && actual !== entry.expectedAlt
        ? [{ mediaId: entry.mediaId, expected: entry.expectedAlt, actual }]
        : []
    }),
    missingVariants: [...scope.variantIds].filter((id) => !variantsById.has(id)),
    presentPairs,
    absentPairs: scope.pairs.filter((pair) => !presentPairs.includes(pair)),
    unexpectedPairs: [...liveReportPairs].filter((key) => !scope.pairIds.has(key)),
    sourceFilesPresent: [...scope.sourceFileIds].filter((id) => filesById.has(id)),
    sourceFilesNotReady: [...filesById.values()].filter((file) => file.fileStatus !== 'READY'),
    metaobjectMatches,
  }
}

function printAudit(label, auditResult) {
  console.log(`${label}:`)
  console.log(`- product media: ${auditResult.media.length}`)
  console.log(`- reported product media present: ${auditResult.reportedMediaPresent.length}/${EXPECTED_MEDIA_COUNT}`)
  console.log(`- reported variant associations present: ${auditResult.presentPairs.length}/${EXPECTED_ASSOCIATION_COUNT}`)
  console.log(`- unexpected associations to reported media: ${auditResult.unexpectedPairs.length}`)
  console.log(`- product media alt differences (informational): ${auditResult.wrongAlts.length}`)
  if (auditResult.wrongAlts.length) console.log(`  ${JSON.stringify(auditResult.wrongAlts.slice(0, 3))}`)
  console.log(`- source Shopify Files preserved: ${auditResult.sourceFilesPresent.length}/${EXPECTED_MEDIA_COUNT}`)
  console.log(`- metaobject body-image references preserved: ${auditResult.metaobjectMatches.length}/${EXPECTED_MEDIA_COUNT}`)
}

function assertSourceState(auditResult) {
  if (auditResult.sourceFilesPresent.length !== EXPECTED_MEDIA_COUNT || auditResult.sourceFilesNotReady.length) {
    throw new Error('Source Shopify Files are missing or not ready')
  }
  if (auditResult.metaobjectMatches.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error('A metaobject body-image reference no longer matches the report')
  }
}

function assertBefore(auditResult, allowPartiallyDetached = false) {
  if (auditResult.reportedMediaPresent.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error('Not all reported product media IDs are present; no write was performed')
  }
  if (auditResult.missingVariants.length) throw new Error('A reported product variant no longer exists')
  if (!allowPartiallyDetached && (
    auditResult.presentPairs.length !== EXPECTED_ASSOCIATION_COUNT || auditResult.absentPairs.length
  )) {
    throw new Error('Reported variant-media associations no longer match exactly; no write was performed')
  }
  if (auditResult.unexpectedPairs.length) {
    throw new Error('Reported media has additional variant associations; no write was performed')
  }
  assertSourceState(auditResult)
}

async function main() {
  requireCredentials()
  const scope = await loadScope()
  const product = await findProduct()
  const before = await audit(product, scope)
  printAudit('Before', before)
  assertBefore(before, apply)

  const preservedMediaIds = new Set([...before.productMediaIds].filter((id) => !scope.mediaIds.has(id)))
  console.log(`- unrelated product media protected: ${preservedMediaIds.size}`)
  if (!apply) {
    console.log('DRY RUN complete. Pass --apply to detach and remove only the reported product media.')
    return
  }

  for (const batch of chunks(before.presentPairs, 100)) {
    const detached = await admin(M_DETACH, {
      productId: product.id,
      variantMedia: batch.map(({ variantId, mediaId }) => ({ variantId, mediaIds: [mediaId] })),
    })
    const detachErrors = detached.productVariantDetachMedia.userErrors || []
    if (detachErrors.length) throw new Error(`productVariantDetachMedia: ${JSON.stringify(detachErrors)}`)
  }

  const afterDetach = await audit(product, scope)
  printAudit('After detach', afterDetach)
  if (afterDetach.presentPairs.length || afterDetach.unexpectedPairs.length) {
    throw new Error('Variant-media detach did not reach zero; product media were not removed')
  }
  if (afterDetach.reportedMediaPresent.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error('Product media changed unexpectedly during detach')
  }
  assertSourceState(afterDetach)

  const deleted = await admin(M_DELETE_PRODUCT_MEDIA, {
    productId: product.id,
    mediaIds: [...scope.mediaIds],
  })
  const payload = deleted.productDeleteMedia
  const deleteErrors = payload.mediaUserErrors || []
  if (deleteErrors.length) throw new Error(`productDeleteMedia: ${JSON.stringify(deleteErrors)}`)
  const deletedIds = new Set(payload.deletedMediaIds || [])
  if (!sameSet(deletedIds, scope.mediaIds)) {
    throw new Error(`Shopify reported ${deletedIds.size}/${EXPECTED_MEDIA_COUNT} product media deletions`)
  }

  const after = await audit(product, scope)
  printAudit('After product-media removal', after)
  if (after.reportedMediaPresent.length || after.presentPairs.length || after.unexpectedPairs.length) {
    throw new Error('Reported product media or associations remain after removal')
  }
  if (!sameSet(after.productMediaIds, preservedMediaIds)) {
    throw new Error('The remaining product media set differs from the protected pre-write set')
  }
  assertSourceState(after)
  console.log(`Completed: confirmed ${EXPECTED_ASSOCIATION_COUNT} associations removed (${before.presentPairs.length} detached in this run) and removed ${EXPECTED_MEDIA_COUNT} product media; preserved ${preservedMediaIds.size} unrelated product media.`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})