#!/usr/bin/env node
import { shopifyAdmin } from '../functions/api/_lib.js'

const CASE_HANDLE = 'custom-charm-phone-case'
const COLLECTION_HANDLE = 'customphonecases'
const EXPECTED_MEDIA_COUNT = 21
const EXPECTED_FIRST_REMAINING_MEDIA_ID = 'gid://shopify/MediaImage/70746250477946'
const TARGETS = [
  {
    id: 'gid://shopify/MediaImage/68353128890746',
    filename: 'IMG-4450.jpg',
    reason: 'Custom order graphic containing bare Black and White cases',
  },
  {
    id: 'gid://shopify/MediaImage/71274858512762',
    filename: 'Screenshot_2026-07-20_at_02.13.14.png',
    reason: 'Ordering graphic containing bare Black and White phones/cases',
  },
]
const apply = process.argv.includes('--apply')
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

function requireCredentials() {
  const hasClientCredentials = env.SHOPIFY_STORE && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  const hasAdminToken = env.SHOPIFY_STORE && env.SHOPIFY_ADMIN_TOKEN
  if (!hasClientCredentials && !hasAdminToken) throw new Error('Missing Shopify credentials')
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

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

const Q_PRODUCT = `
  query($query: String!, $after: String) {
    products(first: 1, query: $query) {
      nodes {
        id
        handle
        title
        collections(first: 50) { nodes { id handle title } }
        media(first: 100) {
          nodes {
            id
            alt
            mediaContentType
            status
            ... on MediaImage { image { url } }
          }
        }
        variants(first: 100, after: $after) {
          nodes {
            id
            selectedOptions { name value }
            media(first: 5) {
              nodes { id }
              pageInfo { hasNextPage endCursor }
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

const M_DETACH = `
  mutation($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      product { id }
      userErrors { field message }
    }
  }`

const M_DELETE = `
  mutation($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors { field message }
    }
  }`

async function loadAllVariantMedia(variant) {
  const media = [...variant.media.nodes]
  let after = variant.media.pageInfo.hasNextPage ? variant.media.pageInfo.endCursor : null
  while (after) {
    const data = await admin(Q_VARIANT_MEDIA, { id: variant.id, after })
    const page = data.node?.media
    if (!page) throw new Error(`Could not read media for variant ${variant.id}`)
    media.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  }
  return media
}

async function loadProduct() {
  let product = null
  let after = null
  const variants = []
  do {
    const data = await admin(Q_PRODUCT, { query: `handle:${CASE_HANDLE}`, after })
    const current = data.products.nodes[0]
    if (!current || current.handle !== CASE_HANDLE) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
    if (product && current.id !== product.id) throw new Error('Product changed while it was being audited')
    product ||= current
    variants.push(...current.variants.nodes)
    after = current.variants.pageInfo.hasNextPage ? current.variants.pageInfo.endCursor : null
  } while (after)

  for (const variant of variants) variant.media.nodes = await loadAllVariantMedia(variant)
  return { ...product, variants }
}

function auditProduct(product) {
  const targetIds = new Set(TARGETS.map((target) => target.id))
  const mediaById = new Map(product.media.nodes.map((media) => [media.id, media]))
  const targetMedia = TARGETS.map((target) => ({ ...target, media: mediaById.get(target.id) }))
  const associations = product.variants.flatMap((variant) => variant.media.nodes
    .filter((media) => targetIds.has(media.id))
    .map((media) => ({
      variantId: variant.id,
      mediaId: media.id,
      selectedOptions: variant.selectedOptions,
    })))
  return {
    targetMedia,
    associations,
    mediaIds: new Set(product.media.nodes.map((media) => media.id)),
    collectionIds: new Set(product.collections.nodes.map((collection) => collection.id)),
  }
}

function assertBefore(product, audit) {
  if (product.media.nodes.length !== EXPECTED_MEDIA_COUNT) {
    throw new Error(`Expected ${EXPECTED_MEDIA_COUNT} product media, found ${product.media.nodes.length}`)
  }
  const orderedTargetIds = TARGETS.map((target) => target.id)
  const actualFirstIds = product.media.nodes.slice(0, TARGETS.length).map((media) => media.id)
  if (JSON.stringify(actualFirstIds) !== JSON.stringify(orderedTargetIds)) {
    throw new Error(`The first product media changed: ${JSON.stringify(actualFirstIds)}`)
  }
  if (product.media.nodes[TARGETS.length]?.id !== EXPECTED_FIRST_REMAINING_MEDIA_ID) {
    throw new Error('The expected first finished-case image is no longer third')
  }
  if (!product.collections.nodes.some((collection) => collection.handle === COLLECTION_HANDLE)) {
    throw new Error(`Product is no longer in collection ${COLLECTION_HANDLE}`)
  }
  for (const target of audit.targetMedia) {
    if (!target.media) throw new Error(`Target media ${target.id} is missing`)
    if (target.media.mediaContentType !== 'IMAGE' || target.media.status !== 'READY') {
      throw new Error(`Target media ${target.id} is not a ready image`)
    }
    if (!target.media.image?.url.includes(`/${target.filename}`)) {
      throw new Error(`Target media ${target.id} URL no longer matches ${target.filename}`)
    }
  }
}

function printAudit(product, audit) {
  console.log(`Product: ${product.title} (${product.id})`)
  console.log(`Collections: ${product.collections.nodes.map((collection) => `${collection.title} (${collection.handle})`).join(', ')}`)
  console.log(`Product media: ${product.media.nodes.length}`)
  for (const target of audit.targetMedia) {
    console.log(`- ${target.id}: ${target.filename} — ${target.reason}`)
  }
  console.log(`Target variant-media associations: ${audit.associations.length}`)
}

async function detachAssociations(productId, associations) {
  const byVariant = new Map()
  for (const association of associations) {
    const mediaIds = byVariant.get(association.variantId) || []
    mediaIds.push(association.mediaId)
    byVariant.set(association.variantId, mediaIds)
  }
  const inputs = [...byVariant].map(([variantId, mediaIds]) => ({ variantId, mediaIds }))
  for (const batch of chunks(inputs, 100)) {
    const data = await admin(M_DETACH, { productId, variantMedia: batch })
    const errors = data.productVariantDetachMedia.userErrors || []
    if (errors.length) throw new Error(`productVariantDetachMedia: ${JSON.stringify(errors)}`)
  }
}

async function main() {
  requireCredentials()
  const beforeProduct = await loadProduct()
  const before = auditProduct(beforeProduct)
  assertBefore(beforeProduct, before)
  printAudit(beforeProduct, before)

  if (!apply) {
    console.log('DRY RUN complete. Pass --apply to detach and remove only these two product media records.')
    return
  }

  await detachAssociations(beforeProduct.id, before.associations)
  const detachedProduct = await loadProduct()
  const detached = auditProduct(detachedProduct)
  if (detached.associations.length) throw new Error('Target variant-media associations remain after detach')
  if (!sameSet(detached.mediaIds, before.mediaIds)) throw new Error('Product media changed unexpectedly during detach')

  const targetIds = new Set(TARGETS.map((target) => target.id))
  const deleted = await admin(M_DELETE, { productId: beforeProduct.id, mediaIds: [...targetIds] })
  const payload = deleted.productDeleteMedia
  const errors = payload.mediaUserErrors || []
  if (errors.length) throw new Error(`productDeleteMedia: ${JSON.stringify(errors)}`)
  const deletedIds = new Set(payload.deletedMediaIds || [])
  if (!sameSet(deletedIds, targetIds)) throw new Error(`Shopify reported ${deletedIds.size}/${targetIds.size} deletions`)

  const afterProduct = await loadProduct()
  const after = auditProduct(afterProduct)
  const expectedRemainingIds = new Set([...before.mediaIds].filter((id) => !targetIds.has(id)))
  if (after.targetMedia.some((target) => target.media) || after.associations.length) {
    throw new Error('Target product media or variant associations remain after deletion')
  }
  if (!sameSet(after.mediaIds, expectedRemainingIds)) throw new Error('A non-target product media record changed')
  if (!sameSet(after.collectionIds, before.collectionIds)) throw new Error('Product collection membership changed')
  if (afterProduct.media.nodes[0]?.id !== EXPECTED_FIRST_REMAINING_MEDIA_ID) {
    throw new Error('The first remaining product media is not the expected finished-case image')
  }
  console.log(`Completed: removed ${targetIds.size} product media and ${before.associations.length} variant associations; preserved ${afterProduct.media.nodes.length} finished-case media and all collection memberships.`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})