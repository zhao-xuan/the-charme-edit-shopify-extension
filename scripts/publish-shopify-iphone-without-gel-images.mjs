#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { shopifyAdmin, uploadImageFile } from '../functions/api/_lib.js'

const PROVENANCE_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidate-provenance.json'
const REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-upload-report.json'
const CASE_REVIEW_REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-case-review-source-upload-report.json'
const ALL_CASE_REVIEW_REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-all-case-review-source-upload-report.json'
const OFFICIAL_SOURCE_REPORT_PATH = 'reference/case-history/generated/samsung-xiaomi-without-gel-completion/shopify-official-source-upload-report.json'
const INVENTORY_PATH = 'public/assets/cases/case-inventory.json'
const METAOBJECT_TYPE = 'charme_product'
const CASE_HANDLE = argumentValue('case-handle', 'custom-charm-phone-case')
const FINISH_FIELDS = {
  black: 'body_image_black',
  white: 'body_image_white',
}
const SHOPIFY_PIXEL_TOLERANCE = {
  maximumChannelDelta: 1,
  maximumChangedPixelFraction: 0.00001,
}

const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const fillCaseReviewSources = process.argv.includes('--fill-case-review-sources')
const allCaseReviewSources = process.argv.includes('--all-case-review-sources')
const syncProductMedia = process.argv.includes('--sync-product-media')
const pairAlignReviewedSources = process.argv.includes('--pair-align-reviewed-sources')
const preserveCanvas = process.argv.includes('--preserve-canvas')
const officialSourceSpecs = argumentValues('official-source')
const derivedSourceSpecs = argumentValues('derived-source')
const derivedRetailSourceSpecs = argumentValues('derived-retail-source')
const compatibleSourceSpecs = argumentValues('compatible-source')
const createTargetSpecs = argumentValues('create-target')
const reportPathOverride = argumentValue('report', '')
const caseReviewBaseUrl = argumentValue('case-review-base-url', 'https://charme-customizer.pages.dev')
const modelIds = new Set(argumentValues('model'))
const finishes = new Set(argumentValues('finish').map((value) => value.toLowerCase()))
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

if (apply && verify) throw new Error('Pass either --verify or --apply, not both')
if (syncProductMedia) {
  throw new Error('Product/variant media sync is disabled for customizer-only case images; publish Shopify Files and charme_product fields only')
}
if ((officialSourceSpecs.length || derivedSourceSpecs.length || derivedRetailSourceSpecs.length || compatibleSourceSpecs.length) && (fillCaseReviewSources || allCaseReviewSources)) {
  throw new Error('Reviewed sources cannot be combined with a case-review source mode')
}
if (createTargetSpecs.length && !(officialSourceSpecs.length || derivedSourceSpecs.length || derivedRetailSourceSpecs.length || compatibleSourceSpecs.length)) {
  throw new Error('--create-target requires a reviewed source')
}
if (pairAlignReviewedSources && !(officialSourceSpecs.length || derivedSourceSpecs.length || derivedRetailSourceSpecs.length || compatibleSourceSpecs.length)) {
  throw new Error('--pair-align-reviewed-sources requires reviewed sources')
}
if (reportPathOverride && (
  path.isAbsolute(reportPathOverride)
  || !reportPathOverride.startsWith('reference/case-history/generated/')
  || path.extname(reportPathOverride) !== '.json'
)) throw new Error('--report must be a JSON path under reference/case-history/generated')
if ([...finishes].some((finish) => !FINISH_FIELDS[finish])) {
  throw new Error('Only --finish black and --finish white are supported')
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

function createTargetSpec(value) {
  const [modelId, name, widthValue, heightValue, ...extra] = value.split(':')
  const widthMm = Number(widthValue)
  const heightMm = Number(heightValue)
  if (!modelId || !name || extra.length || !Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    throw new Error('--create-target must be model-id:name:width-mm:height-mm')
  }
  return { modelId, name, widthMm, heightMm, kind: 'phone', basePrice: 26 }
}

const createTargets = new Map()
for (const value of createTargetSpecs) {
  const target = createTargetSpec(value)
  if (createTargets.has(target.modelId)) throw new Error(`Duplicate --create-target for ${target.modelId}`)
  createTargets.set(target.modelId, target)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function field(node, key) {
  return (node.fields || []).find((item) => item.key === key)
}

function referenceInfo(node, key) {
  const item = field(node, key)
  return {
    id: item?.reference?.id || item?.value || null,
    url: item?.reference?.image?.url || null,
  }
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

const Q_DEFINITION = `
  query {
    metaobjectDefinitionByType(type: "${METAOBJECT_TYPE}") {
      fieldDefinitions { key }
    }
  }`

const Q_PRODUCTS = `
  query($after: String) {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 200, after: $after) {
      edges {
        node {
          id
          handle
          fields {
            key
            value
            reference {
              ... on MediaImage { id fileStatus image { url } }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`

const Q_PRODUCT = `
  query($id: ID!) {
    node(id: $id) {
      ... on Metaobject {
        id
        handle
        fields {
          key
          value
          reference {
            ... on MediaImage { id fileStatus image { url } }
          }
        }
      }
    }
  }`

const Q_FILES = `
  query($search: String!) {
    files(first: 10, query: $search, sortKey: CREATED_AT, reverse: true) {
      nodes {
        ... on MediaImage {
          id
          fileStatus
          image { url width height }
        }
      }
    }
  }`

const Q_CASE_PRODUCT = `
  query($query: String!, $after: String) {
    products(first: 1, query: $query) {
      nodes {
        id
        options { name }
        variants(first: 250, after: $after) {
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
        media(first: 250) {
          nodes { id alt }
        }
      }
    }
  }`

const Q_PRODUCT_MEDIA = `
  query($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 250, after: $after) {
        nodes { id alt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`

const Q_MEDIA = `
  query($id: ID!) {
    node(id: $id) {
      ... on MediaImage { id alt status image { url } }
    }
  }`

const M_PRODUCT = `
  mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject { id }
      userErrors { field message code }
    }
  }`

const M_CREATE_PRODUCT = `
  mutation($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
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

const COLOUR_HINTS = ['colour', 'color', 'gel', 'finish']
const MODEL_HINTS = ['model', 'phone', 'device']

function slugModel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

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

async function caseProductTargets(entries) {
  let product = null
  let after = null
  do {
    const data = await admin(Q_CASE_PRODUCT, { query: `handle:${CASE_HANDLE}`, after })
    const page = data.products.nodes[0]
    if (!page) throw new Error(`Shopify product ${CASE_HANDLE} was not found`)
    if (!product) product = { ...page, variants: { nodes: [] } }
    product.variants.nodes.push(...page.variants.nodes)
    after = page.variants.pageInfo.hasNextPage ? page.variants.pageInfo.endCursor : null
  } while (after)
  const { colour, model } = optionRoles(product.options || [])
  if (!colour || !model) throw new Error(`Could not identify model and colour options on ${CASE_HANDLE}`)

  const variantsByKey = new Map()
  for (const variant of product.variants.nodes) {
    const modelId = slugModel(selectedOption(variant, model.name))
    const finish = variantFinish(selectedOption(variant, colour.name))
    if (!modelId || !finish) continue
    if (variant.media.pageInfo.hasNextPage) throw new Error(`Variant ${variant.id} has more than 20 media records`)
    const key = `${modelId}\u0000${finish}`
    const group = variantsByKey.get(key) || { variantIds: [], linkedMediaIds: new Set() }
    group.variantIds.push(variant.id)
    for (const media of variant.media.nodes) group.linkedMediaIds.add(media.id)
    variantsByKey.set(key, group)
  }

  const targets = entries.map((entry) => {
    const group = variantsByKey.get(`${entry.candidate.modelId}\u0000${entry.candidate.finish}`)
    return {
      entry,
      variantIds: group?.variantIds || [],
      linkedMediaIds: [...(group?.linkedMediaIds || [])],
    }
  })
  const missing = targets.filter((target) => !target.variantIds.length)
  if (missing.length) {
    throw new Error(`Shopify has no matching variants for: ${missing.map(({ entry }) => `${entry.candidate.modelId}/${entry.candidate.finish}`).join(', ')}`)
  }
  return { product, targets }
}

function productMediaAlt(result) {
  return `Charme without gel ${result.modelId} ${result.finish} ${result.sha256.slice(0, 12)}`
}

async function matchingLinkedProductMedia(target) {
  const matches = []
  for (const mediaId of target.linkedMediaIds) {
    const data = await admin(Q_MEDIA, { id: mediaId })
    const media = data.node
    if (media?.status !== 'READY' || !media.image?.url) continue
    const identity = await remoteIdentity(media.image.url, target.entry.candidate, target.entry.evidence)
    if (matchesCandidate(identity, target.entry.candidate, target.entry.evidence)) matches.push(media)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple linked Product Media match ${target.entry.candidate.modelId}/${target.entry.candidate.finish}`)
  }
  return matches[0] || null
}

async function ensureProductMediaAlt(mediaId, expectedAlt) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const data = await admin(Q_MEDIA, { id: mediaId })
    const media = data.node
    if (!media) throw new Error(`Shopify Product Media ${mediaId} was not found`)
    if (media.status === 'FAILED') throw new Error(`Shopify Product Media ${mediaId} failed processing`)
    if (media.status !== 'READY') {
      await sleep(1000)
      continue
    }
    if (media.alt === expectedAlt) return 'current'

    const updated = await admin(M_FILE_ALT, { files: [{ id: mediaId, alt: expectedAlt }] })
    const errors = updated.fileUpdate.userErrors || []
    if (errors.length) throw new Error(JSON.stringify(errors))
    const readback = await admin(Q_MEDIA, { id: mediaId })
    if (readback.node?.alt !== expectedAlt) {
      throw new Error(`Shopify Product Media alt readback failed for ${mediaId}`)
    }
    return 'updated'
  }
  throw new Error(`Shopify Product Media ${mediaId} did not become ready`)
}

async function refreshProductMedia(product) {
  const nodes = []
  let after = null
  do {
    const data = await admin(Q_PRODUCT_MEDIA, { id: product.id, after })
    if (!data.product) throw new Error(`Shopify product ${product.id} was not found`)
    nodes.push(...data.product.media.nodes)
    after = data.product.media.pageInfo.hasNextPage ? data.product.media.pageInfo.endCursor : null
  } while (after)
  product.media.nodes = nodes
}

async function syncResultToProduct(product, target, result) {
  const alt = productMediaAlt(result)
  let mediaId = product.media.nodes.find((media) => media.alt === alt)?.id || null
  let mediaStatus = 'reused'
  if (!mediaId) {
    const linkedMedia = await matchingLinkedProductMedia(target)
    mediaId = linkedMedia?.id || null
    if (linkedMedia && !product.media.nodes.some((media) => media.id === linkedMedia.id)) {
      product.media.nodes.push(linkedMedia)
    }
  }
  if (!mediaId) {
    const created = await admin(M_MEDIA, {
      productId: product.id,
      media: [{ originalSource: result.url, mediaContentType: 'IMAGE', alt }],
    })
    const errors = created.productCreateMedia.mediaUserErrors || []
    if (errors.length) throw new Error(JSON.stringify(errors))
    mediaId = created.productCreateMedia.media[0]?.id || null
    if (!mediaId) throw new Error(`Shopify created no product media for ${result.modelId}/${result.finish}`)
    product.media.nodes.push({ id: mediaId, alt })
    mediaStatus = 'created'
  }

  for (let offset = 0; offset < target.variantIds.length; offset += 100) {
    const variants = target.variantIds.slice(offset, offset + 100).map((id) => ({ id, mediaId }))
    const updated = await admin(M_VARIANTS, { productId: product.id, variants })
    const errors = updated.productVariantsBulkUpdate.userErrors || []
    if (errors.length) throw new Error(JSON.stringify(errors))
  }
  const altStatus = await ensureProductMediaAlt(mediaId, alt)
  return {
    modelId: result.modelId,
    finish: result.finish,
    mediaId,
    mediaStatus,
    altStatus,
    variantIds: target.variantIds,
  }
}

async function syncResultToProductWithRetry(product, target, result, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) await refreshProductMedia(product)
      return await syncResultToProduct(product, target, result)
    } catch (error) {
      lastError = error
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(error.message || String(error)) || attempt === attempts) {
        throw error
      }
      await sleep(attempt * 1000)
    }
  }
  throw lastError
}

async function candidateEvidence(candidate) {
  const bytes = await readFile(candidate.candidatePath)
  const actualSha256 = sha256(bytes)
  if (actualSha256 !== candidate.sha256) {
    throw new Error(`${candidate.candidatePath} SHA-256 changed`)
  }
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png') throw new Error(`${candidate.candidatePath} is not a PNG`)
  if (metadata.width !== candidate.widthPx || metadata.height !== candidate.heightPx) {
    throw new Error(`${candidate.candidatePath} dimensions changed`)
  }
  return imageEvidence(bytes, candidate.candidatePath)
}

async function imageEvidence(bytes, label) {
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png') throw new Error(`${label} is not a PNG`)
  const pixels = await decodePixels(bytes)
  return {
    bytes,
    sha256: sha256(bytes),
    widthPx: metadata.width,
    heightPx: metadata.height,
    ...pixelIdentity(pixels),
    ...alphaIdentity(pixels),
    pixelData: pixels.data,
  }
}

async function decodePixels(bytes) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

function pixelIdentity({ data, info }) {
  return {
    pixelSha256: sha256(data),
    pixelWidth: info.width,
    pixelHeight: info.height,
    pixelChannels: info.channels,
  }
}

function alphaIdentity({ data, info }) {
  let transparentPixels = 0
  let semiTransparentPixels = 0
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3]
      if (alpha < 255) transparentPixels += 1
      if (alpha > 0 && alpha < 255) semiTransparentPixels += 1
      if (!alpha) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  const alphaBounds = right < 0 ? null : {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  }
  return {
    hasTransparentBackground: transparentPixels > 0,
    transparentPixels,
    semiTransparentPixels,
    alphaBounds,
    alphaPadding: alphaBounds ? [left, top, info.width - 1 - right, info.height - 1 - bottom] : null,
  }
}

async function tightTransparentEvidence(bytes, label) {
  const original = await imageEvidence(bytes, label)
  if (!original.hasTransparentBackground || !original.alphaBounds) {
    throw new Error(`${label} is not a transparent cut-out`)
  }
  if (original.alphaPadding.every((padding) => padding === 0)) {
    return { ...original, trimmed: false, sourceWidthPx: original.widthPx, sourceHeightPx: original.heightPx }
  }
  const trimmedBytes = await sharp(bytes).extract(original.alphaBounds).png().toBuffer()
  const trimmed = await imageEvidence(trimmedBytes, label)
  if (!trimmed.hasTransparentBackground || !trimmed.alphaPadding.every((padding) => padding === 0)) {
    throw new Error(`${label} could not be trimmed to its alpha bounds`)
  }
  return {
    ...trimmed,
    trimmed: true,
    sourceWidthPx: original.widthPx,
    sourceHeightPx: original.heightPx,
  }
}

function pixelDifference(localData, remoteData) {
  if (localData.length !== remoteData.length) return null
  let changedPixels = 0
  let changedChannels = 0
  let alphaChanges = 0
  let maximumChannelDelta = 0
  let totalChannelDelta = 0
  for (let offset = 0; offset < localData.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(localData[offset + channel] - remoteData[offset + channel])
      if (!delta) continue
      pixelChanged = true
      changedChannels += 1
      totalChannelDelta += delta
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
      if (channel === 3) alphaChanges += 1
    }
    if (pixelChanged) changedPixels += 1
  }
  const totalPixels = localData.length / 4
  return {
    totalPixels,
    changedPixels,
    changedPixelFraction: changedPixels / totalPixels,
    changedChannels,
    alphaChanges,
    maximumChannelDelta,
    meanChangedChannelDelta: changedChannels ? totalChannelDelta / changedChannels : 0,
  }
}

async function acceptedCandidates() {
  const provenance = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'))
  const accepted = provenance.candidates.filter((candidate) => (
    candidate.reviewStatus === 'accepted'
    && (!modelIds.size || modelIds.has(candidate.modelId))
    && (!finishes.size || finishes.has(candidate.finish))
  ))
  if (!accepted.length) throw new Error('No accepted candidates match the requested filters')

  const keys = new Set()
  const entries = []
  for (const candidate of accepted) {
    const key = `${candidate.modelId}\u0000${candidate.finish}`
    if (keys.has(key)) throw new Error(`Multiple accepted candidates found for ${candidate.modelId}/${candidate.finish}`)
    keys.add(key)
    if (!FINISH_FIELDS[candidate.finish]) throw new Error(`Unsupported finish: ${candidate.finish}`)
    if (candidate.publish !== false) throw new Error(`${candidate.modelId}/${candidate.finish} must remain publish:false`)
    if (!candidate.automatedQa?.passed || candidate.automatedQa.bodyAspectDriftPercent > 1) {
      throw new Error(`${candidate.modelId}/${candidate.finish} does not pass the 1% body gate`)
    }
    if (candidate.visualCameraQa !== 'passed-by-review') {
      throw new Error(`${candidate.modelId}/${candidate.finish} has no passed camera review`)
    }
    entries.push({
      candidate,
      fieldKey: FINISH_FIELDS[candidate.finish],
      evidence: await candidateEvidence(candidate),
    })
  }
  return { campaign: provenance.campaign, entries }
}

function reviewedSourceSpec(value, sourceKind) {
  const firstSeparator = value.indexOf(':')
  const secondSeparator = value.indexOf(':', firstSeparator + 1)
  if (firstSeparator < 1 || secondSeparator <= firstSeparator + 1 || secondSeparator === value.length - 1) {
    throw new Error('Reviewed source must be model-id:finish:path')
  }
  return {
    modelId: value.slice(0, firstSeparator),
    finish: value.slice(firstSeparator + 1, secondSeparator).toLowerCase(),
    filePath: value.slice(secondSeparator + 1),
    sourceKind,
  }
}

function compatibleSourceSpec(value) {
  const firstSeparator = value.indexOf(':')
  const secondSeparator = value.indexOf(':', firstSeparator + 1)
  const thirdSeparator = value.indexOf(':', secondSeparator + 1)
  if (
    firstSeparator < 1
    || secondSeparator <= firstSeparator + 1
    || thirdSeparator <= secondSeparator + 1
    || thirdSeparator === value.length - 1
  ) throw new Error('--compatible-source must be model-id:finish:source-model-id:path')
  return {
    modelId: value.slice(0, firstSeparator),
    finish: value.slice(firstSeparator + 1, secondSeparator).toLowerCase(),
    sourceModelId: value.slice(secondSeparator + 1, thirdSeparator),
    filePath: value.slice(thirdSeparator + 1),
    sourceKind: 'compatible-real-source',
  }
}

function alphaBoundsAtThreshold(evidence, threshold) {
  let left = evidence.pixelWidth
  let top = evidence.pixelHeight
  let right = -1
  let bottom = -1
  for (let y = 0; y < evidence.pixelHeight; y += 1) {
    for (let x = 0; x < evidence.pixelWidth; x += 1) {
      const alpha = evidence.pixelData[(y * evidence.pixelWidth + x) * evidence.pixelChannels + 3]
      if (alpha < threshold) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) throw new Error(`No pixels found at alpha >= ${threshold}`)
  return { left, top, right, bottom }
}

function sameBounds(left, right) {
  return left.left === right.left
    && left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
}

async function reviewedSourceImages() {
  const seen = new Set()
  const sources = [
    ...officialSourceSpecs.map((value) => reviewedSourceSpec(value, 'official-source')),
    ...derivedSourceSpecs.map((value) => reviewedSourceSpec(value, 'derived-official-source')),
    ...derivedRetailSourceSpecs.map((value) => reviewedSourceSpec(value, 'derived-verified-retail-source')),
    ...compatibleSourceSpecs.map(compatibleSourceSpec),
  ]
  const prepared = []
  for (const source of sources) {
    if (!FINISH_FIELDS[source.finish]) throw new Error(`Unsupported finish: ${source.finish}`)
    const key = `${source.modelId}\u0000${source.finish}`
    if (seen.has(key)) throw new Error(`Duplicate official source for ${source.modelId}/${source.finish}`)
    seen.add(key)
    const sourceBytes = await readFile(source.filePath)
    const original = await imageEvidence(sourceBytes, source.filePath)
    const modelName = createTargets.get(source.modelId)?.name || source.modelId
      .split('-')
      .map((token) => token === 'galaxy' ? 'Galaxy' : token === 'plus' ? '+' : token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ')
    prepared.push({ source, sourceBytes, original, modelName, sourceCrop: null })
  }

  if (pairAlignReviewedSources) {
    for (const [modelId, pair] of Map.groupBy(prepared, (item) => item.source.modelId)) {
      const finishes = new Set(pair.map((item) => item.source.finish))
      if (pair.length !== 2 || !finishes.has('black') || !finishes.has('white')) {
        throw new Error(`${modelId} must provide exactly one reviewed Black and White source for pair alignment`)
      }
      if (new Set(pair.map((item) => `${item.original.widthPx}x${item.original.heightPx}`)).size !== 1) {
        throw new Error(`${modelId} reviewed Black/White source canvases differ`)
      }
      const coreBounds = pair.map((item) => alphaBoundsAtThreshold(item.original, 128))
      if (!sameBounds(coreBounds[0], coreBounds[1])) {
        throw new Error(`${modelId} reviewed Black/White core bounds differ`)
      }
      const padding = 4
      const bounds = coreBounds[0]
      const sourceCrop = {
        left: Math.max(0, bounds.left - padding),
        top: Math.max(0, bounds.top - padding),
        width: Math.min(pair[0].original.widthPx - Math.max(0, bounds.left - padding), bounds.right - bounds.left + 1 + padding * 2),
        height: Math.min(pair[0].original.heightPx - Math.max(0, bounds.top - padding), bounds.bottom - bounds.top + 1 + padding * 2),
        alphaThreshold: 128,
        padding,
      }
      for (const item of pair) item.sourceCrop = sourceCrop
    }
  }

  const entries = []
  for (const { source, sourceBytes, original, modelName, sourceCrop } of prepared) {
    let evidence
    if (sourceCrop) {
      const croppedBytes = await sharp(sourceBytes).extract(sourceCrop).png().toBuffer()
      const cropped = await imageEvidence(croppedBytes, source.filePath)
      if (!cropped.hasTransparentBackground || cropped.alphaPadding.some((padding) => padding < 1)) {
        throw new Error(`${source.modelId}/${source.finish} pair crop does not preserve transparent edge padding`)
      }
      evidence = {
        ...cropped,
        trimmed: true,
        sourceWidthPx: original.widthPx,
        sourceHeightPx: original.heightPx,
      }
    } else if (preserveCanvas) {
      if (!original.hasTransparentBackground) {
        throw new Error(`${source.filePath} must have a transparent background when preserving its canvas`)
      }
      evidence = {
        ...original,
        trimmed: false,
        sourceWidthPx: original.widthPx,
        sourceHeightPx: original.heightPx,
      }
    } else {
      evidence = await tightTransparentEvidence(sourceBytes, source.filePath)
    }
    const candidate = {
      modelId: source.modelId,
      modelName,
      finish: source.finish,
      candidateVersion: source.sourceKind,
      sha256: evidence.sha256,
      widthPx: evidence.widthPx,
      heightPx: evidence.heightPx,
      sourceKind: source.sourceKind,
      sourceModelId: source.sourceModelId || source.modelId,
      sourcePath: source.filePath,
      sourceUrl: null,
      sourceSha256: original.sha256,
      sourceWidthPx: original.widthPx,
      sourceHeightPx: original.heightPx,
      trimmed: evidence.trimmed,
      sourceCrop,
    }
    entries.push({ candidate, fieldKey: FINISH_FIELDS[source.finish], evidence })
  }
  if (!entries.length) throw new Error('No official sources were supplied')
  return { campaign: 'reviewed-without-gel-source-publication', entries }
}

async function optionalLocalSource(modelId, finish) {
  const paths = [
    `public/assets/cases/case-without-gel/${modelId}-${finish}.png`,
    `reference/case-history/generated/black-white-glitter-shape-trials/references/trial-${modelId}-${finish}-source.png`,
  ]
  for (const filePath of paths) {
    try {
      return { filePath, bytes: await readFile(filePath) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

async function caseReviewBytes(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'image/png', 'cache-control': 'no-cache' },
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok || !contentType.toLowerCase().startsWith('image/png')) {
        throw new Error(`${response.status} ${contentType || 'missing content type'}`)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 500)
    }
  }
  throw new Error(`Could not load case-review source ${url}: ${lastError?.message || lastError}`)
}

async function caseReviewSourceImages() {
  const [inventory, provenance] = await Promise.all([
    readFile(INVENTORY_PATH, 'utf8').then(JSON.parse),
    readFile(PROVENANCE_PATH, 'utf8').then(JSON.parse),
  ])
  const acceptedKeys = new Set(provenance.candidates
    .filter((candidate) => candidate.reviewStatus === 'accepted')
    .map((candidate) => `${candidate.modelId}\u0000${candidate.finish}`))
  const models = inventory.models.filter((model) => model.brand === 'Apple' && model.liveInCatalog)
  if (models.length !== 34) throw new Error(`Expected 34 live iPhone models in ${INVENTORY_PATH}, found ${models.length}`)

  const entries = []
  for (const model of models) {
    for (const finish of Object.keys(FINISH_FIELDS)) {
      if (!allCaseReviewSources && acceptedKeys.has(`${model.id}\u0000${finish}`)) continue
      if (modelIds.size && !modelIds.has(model.id)) continue
      if (finishes.size && !finishes.has(finish)) continue
      if (!model.withoutGel?.[finish]) throw new Error(`${model.id}/${finish} is missing from the case-review Without gel inventory`)

      const sourceUrl = new URL(`/assets/cases/case-without-gel/${model.id}-${finish}.png`, caseReviewBaseUrl).toString()
      const sourceBytes = await caseReviewBytes(sourceUrl)
      const sourceSha256 = sha256(sourceBytes)
      const local = await optionalLocalSource(model.id, finish)
      if (local && sha256(local.bytes) !== sourceSha256) {
        throw new Error(`${model.id}/${finish} local source differs from the live case-review source`)
      }
      const evidence = await tightTransparentEvidence(sourceBytes, sourceUrl)
      const candidate = {
        modelId: model.id,
        modelName: model.name,
        finish,
        candidateVersion: 'case-review-source',
        sha256: evidence.sha256,
        widthPx: evidence.widthPx,
        heightPx: evidence.heightPx,
        sourceKind: 'case-review-without-gel',
        sourcePath: local?.filePath || null,
        sourceUrl,
        sourceSha256,
        trimmed: evidence.trimmed,
        sourceWidthPx: evidence.sourceWidthPx,
        sourceHeightPx: evidence.sourceHeightPx,
      }
      entries.push({ candidate, fieldKey: FINISH_FIELDS[finish], evidence })
    }
  }
  if (!entries.length) throw new Error('No remaining case-review Without gel sources match the requested filters')
  return { campaign: 'case-review-without-gel-source-publication', entries }
}

function requireCredentials() {
  const hasClientCredentials = env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  if (!env.SHOPIFY_STORE || (!hasClientCredentials && !env.SHOPIFY_ADMIN_TOKEN)) {
    throw new Error('Missing SHOPIFY_STORE and Shopify client credentials or SHOPIFY_ADMIN_TOKEN')
  }
}

async function productMetaobjects() {
  const results = new Map()
  let after = null
  do {
    const data = await admin(Q_PRODUCTS, { after })
    for (const { node } of data.metaobjects.edges) {
      const legacyId = field(node, 'legacy_id')?.value
      if (legacyId) results.set(legacyId, node)
    }
    after = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
  } while (after)
  return results
}

async function createProductTarget(target) {
  const result = await admin(M_CREATE_PRODUCT, {
    metaobject: {
      type: METAOBJECT_TYPE,
      handle: target.modelId,
      fields: [
        { key: 'name', value: target.name },
        { key: 'kind', value: target.kind },
        { key: 'base_price', value: String(target.basePrice) },
        { key: 'width_mm', value: String(target.widthMm) },
        { key: 'height_mm', value: String(target.heightMm) },
        { key: 'legacy_id', value: target.modelId },
      ],
    },
  })
  const errors = result.metaobjectCreate.userErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))
  if (!result.metaobjectCreate.metaobject?.id) throw new Error(`Shopify created no target for ${target.modelId}`)
  return { ...target, metaobjectId: result.metaobjectCreate.metaobject.id }
}

function missingTargetPlan(entries, metaobjects) {
  const entriesByModel = Map.groupBy(entries, (entry) => entry.candidate.modelId)
  const missing = []
  for (const [modelId, modelEntries] of entriesByModel) {
    if (metaobjects.has(modelId)) continue
    const target = createTargets.get(modelId)
    if (!target) throw new Error(`Shopify has no ${METAOBJECT_TYPE} target for ${modelId}; pass --create-target explicitly`)
    const finishes = new Set(modelEntries.map((entry) => entry.candidate.finish))
    if (![...Object.keys(FINISH_FIELDS)].every((finish) => finishes.has(finish))) {
      throw new Error(`${modelId} must provide both black and white reviewed sources before target creation`)
    }
    missing.push(target)
  }
  return missing
}

function matchesCandidate(identity, candidate, evidence) {
  return identity?.sha256 === candidate.sha256 || (
    identity?.pixelSha256 === evidence.pixelSha256
    && identity.pixelWidth === evidence.pixelWidth
    && identity.pixelHeight === evidence.pixelHeight
    && identity.pixelChannels === evidence.pixelChannels
  ) || (
    identity?.pixelWidth === evidence.pixelWidth
    && identity.pixelHeight === evidence.pixelHeight
    && identity.pixelChannels === evidence.pixelChannels
    && identity.pixelDifference?.alphaChanges === 0
    && identity.pixelDifference.maximumChannelDelta <= SHOPIFY_PIXEL_TOLERANCE.maximumChannelDelta
    && identity.pixelDifference.changedPixelFraction <= SHOPIFY_PIXEL_TOLERANCE.maximumChangedPixelFraction
  )
}

async function remoteIdentity(url, candidate, evidence, attempts = 1) {
  let lastResult = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'image/png', 'cache-control': 'no-cache' },
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const pixels = await decodePixels(bytes)
      lastResult = {
        status: response.status,
        contentType: response.headers.get('content-type'),
        size: bytes.length,
        sha256: sha256(bytes),
        ...pixelIdentity(pixels),
        pixelDifference: pixelDifference(evidence.pixelData, pixels.data),
      }
      if (response.ok && matchesCandidate(lastResult, candidate, evidence)) return lastResult
    } catch (error) {
      lastResult = { error: error.message || String(error) }
    }
    if (attempt < attempts) await sleep(700)
  }
  return lastResult
}

async function existingUpload(filename, candidate, evidence) {
  const data = await admin(Q_FILES, { search: `filename:${filename}` })
  for (const file of data.files.nodes) {
    if (file.fileStatus !== 'READY' || !file.image?.url) continue
    const identity = await remoteIdentity(file.image.url, candidate, evidence)
    if (matchesCandidate(identity, candidate, evidence)) return { id: file.id, url: file.image.url, identity }
  }
  return null
}

async function upload(entry) {
  const { candidate, evidence, fieldKey, metaobject, current } = entry
  const currentIdentity = current.url ? await remoteIdentity(current.url, candidate, evidence) : null
  if (matchesCandidate(currentIdentity, candidate, evidence)) {
    return {
      status: 'already-current',
      modelId: candidate.modelId,
      finish: candidate.finish,
      candidateVersion: candidate.candidateVersion,
      sha256: candidate.sha256,
      pixelSha256: evidence.pixelSha256,
      fieldKey,
      metaobjectId: metaobject.id,
      fileId: current.id,
      url: current.url,
      sourceKind: candidate.sourceKind || 'accepted-generated-candidate',
      sourceModelId: candidate.sourceModelId || candidate.modelId,
      sourcePath: candidate.sourcePath || candidate.candidatePath,
      sourceUrl: candidate.sourceKind ? candidate.sourceUrl : null,
      cdn: currentIdentity,
    }
  }

  const filename = [
    candidate.modelId,
    candidate.finish,
    'without-gel',
    candidate.candidateVersion,
    candidate.sha256.slice(0, 12),
  ].join('-') + '.png'
  let file = await existingUpload(filename, candidate, evidence)
  const reusedUpload = Boolean(file)
  if (!file) {
    file = await uploadImageFile(env, evidence.bytes, {
      contentType: 'image/png',
      filename,
      alt: `${candidate.modelName} ${candidate.finish} without Gel`,
    })
  }
  if (!file.id || !file.url) throw new Error(`Shopify file was not ready for ${candidate.modelId}/${candidate.finish}`)
  const uploadedIdentity = file.identity || await remoteIdentity(file.url, candidate, evidence, 10)
  if (!matchesCandidate(uploadedIdentity, candidate, evidence)) {
    throw new Error(`Shopify CDN image does not match ${candidate.modelId}/${candidate.finish}`)
  }

  const updated = await admin(M_PRODUCT, {
    id: metaobject.id,
    metaobject: { fields: [{ key: fieldKey, value: file.id }] },
  })
  const errors = updated.metaobjectUpdate.userErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))

  const reread = (await admin(Q_PRODUCT, { id: metaobject.id })).node
  const finalReference = referenceInfo(reread, fieldKey)
  if (finalReference.id !== file.id || !finalReference.url) {
    throw new Error(`Shopify did not retain the new ${fieldKey} reference for ${candidate.modelId}`)
  }
  const finalIdentity = await remoteIdentity(finalReference.url, candidate, evidence, 5)
  if (!matchesCandidate(finalIdentity, candidate, evidence)) {
    throw new Error(`Final Shopify body image does not match ${candidate.modelId}/${candidate.finish}`)
  }

  return {
    status: 'updated',
    modelId: candidate.modelId,
    finish: candidate.finish,
    candidateVersion: candidate.candidateVersion,
    sha256: candidate.sha256,
    pixelSha256: evidence.pixelSha256,
    fieldKey,
    metaobjectId: metaobject.id,
    previousFileId: current.id,
    previousUrl: current.url,
    fileId: file.id,
    url: finalReference.url,
    sourceKind: candidate.sourceKind || 'accepted-generated-candidate',
    sourceModelId: candidate.sourceModelId || candidate.modelId,
    sourcePath: candidate.sourcePath || candidate.candidatePath,
    sourceUrl: candidate.sourceKind ? candidate.sourceUrl : null,
    sourceCrop: candidate.sourceCrop || null,
    reusedUpload,
    cdn: finalIdentity,
  }
}

async function uploadWithRetry(entry, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await upload(entry)
    } catch (error) {
      lastError = error
      if (!/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(error.message || String(error)) || attempt === attempts) {
        throw error
      }
      await sleep(attempt * 1000)
    }
  }
  throw lastError
}

async function main() {
  const useCaseReviewSources = fillCaseReviewSources || allCaseReviewSources
  const useReviewedSources = officialSourceSpecs.length > 0
    || derivedSourceSpecs.length > 0
    || derivedRetailSourceSpecs.length > 0
    || compatibleSourceSpecs.length > 0
  const { campaign, entries } = useReviewedSources
    ? await reviewedSourceImages()
    : useCaseReviewSources ? await caseReviewSourceImages() : await acceptedCandidates()
  const selectionLabel = useReviewedSources
    ? 'reviewed real Without gel product images'
    : useCaseReviewSources
      ? `${allCaseReviewSources ? 'all' : 'remaining'} case-review Without gel product images`
      : 'accepted no-Gel product images'
  const mediaLabel = syncProductMedia ? ` plus ${CASE_HANDLE} product/variant media` : ''
  console.log(`${apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY RUN'}: ${entries.length} ${selectionLabel}${mediaLabel}`)
  for (const { candidate, fieldKey } of entries) {
    const source = candidate.sourceUrl || candidate.sourcePath
    const sourceModel = candidate.sourceModelId && candidate.sourceModelId !== candidate.modelId
      ? ` [source model: ${candidate.sourceModelId}]`
      : ''
    const crop = candidate.sourceCrop
      ? ` [paired crop: ${candidate.sourceCrop.left},${candidate.sourceCrop.top} ${candidate.sourceCrop.width}x${candidate.sourceCrop.height}]`
      : ''
    console.log(`- ${candidate.modelId} / ${candidate.finish} / ${candidate.candidateVersion}${sourceModel}${crop} -> ${fieldKey} (${candidate.sha256})${source ? ` <- ${source}` : ''}`)
  }
  if (!apply && !verify) return

  requireCredentials()
  const definition = await admin(Q_DEFINITION)
  const definitionKeys = new Set((definition.metaobjectDefinitionByType?.fieldDefinitions || []).map((item) => item.key))
  for (const key of ['legacy_id', ...Object.values(FINISH_FIELDS)]) {
    if (!definitionKeys.has(key)) throw new Error(`${METAOBJECT_TYPE} definition is missing ${key}`)
  }

  let metaobjects = await productMetaobjects()
  const missingTargets = missingTargetPlan(entries, metaobjects)
  const createdTargets = []
  if (missingTargets.length && verify) {
    for (const target of missingTargets) {
      console.log(`Verified planned target creation: ${target.modelId} / ${target.name} / ${target.widthMm}x${target.heightMm}mm`)
    }
  } else if (missingTargets.length) {
    for (const target of missingTargets) {
      const created = await createProductTarget(target)
      createdTargets.push(created)
      console.log(`Created Shopify target: ${created.modelId} -> ${created.metaobjectId}`)
    }
    metaobjects = await productMetaobjects()
  }
  const targets = entries.map((entry) => {
    const metaobject = metaobjects.get(entry.candidate.modelId)
    if (!metaobject && !verify) throw new Error(`Shopify did not retain the new ${METAOBJECT_TYPE} target for ${entry.candidate.modelId}`)
    return {
      ...entry,
      metaobject: metaobject || { id: `planned:${entry.candidate.modelId}`, fields: [] },
      current: metaobject ? referenceInfo(metaobject, entry.fieldKey) : { id: null, url: null },
    }
  })
  console.log(`Verified Shopify target coverage: ${targets.length}/${entries.length}`)
  const productCoverage = syncProductMedia ? await caseProductTargets(entries) : null
  if (productCoverage) {
    const variantCount = productCoverage.targets.reduce((count, target) => count + target.variantIds.length, 0)
    console.log(`Verified Shopify product-media coverage: ${productCoverage.targets.length}/${entries.length} images -> ${variantCount} variants`)
  }
  if (verify) return

  const results = []
  for (const entry of targets) {
    const result = await uploadWithRetry(entry)
    results.push(result)
    console.log(`${result.status === 'updated' ? 'Updated' : 'Already current'}: ${result.modelId} / ${result.finish} -> ${result.fileId}`)
    await sleep(250)
  }

  const productMedia = []
  if (productCoverage) {
    const resultByKey = new Map(results.map((result) => [`${result.modelId}\u0000${result.finish}`, result]))
    for (const target of productCoverage.targets) {
      const key = `${target.entry.candidate.modelId}\u0000${target.entry.candidate.finish}`
      const productResult = await syncResultToProductWithRetry(productCoverage.product, target, resultByKey.get(key))
      productMedia.push(productResult)
      console.log(`${productResult.mediaStatus === 'created' ? 'Created' : 'Reused'} product media: ${productResult.modelId} / ${productResult.finish} -> ${productResult.variantIds.length} variants`)
      await sleep(250)
    }
  }

  const report = {
    schemaVersion: 1,
    campaign,
    appliedAt: new Date().toISOString(),
    provenancePath: useReviewedSources ? null : PROVENANCE_PATH,
    sourceMode: useReviewedSources
      ? compatibleSourceSpecs.length
        ? 'reviewed-compatible-real-sources'
        : derivedRetailSourceSpecs.length
          ? 'reviewed-derived-retail-real-sources'
          : derivedSourceSpecs.length ? 'reviewed-official-and-derived-sources' : 'official-source'
      : useCaseReviewSources ? 'case-review-without-gel' : 'accepted-generated-candidates',
    sourceBaseUrl: useCaseReviewSources ? caseReviewBaseUrl : null,
    scope: useReviewedSources
      ? `Explicit reviewed real sources; Shopify Files plus charme_product body image fields${syncProductMedia ? ` plus ${CASE_HANDLE} product/variant media` : '; no variant media updates'}.`
      : useCaseReviewSources
        ? `${allCaseReviewSources ? 'All' : 'Existing'} case-review Without gel sources; Shopify Files plus charme_product body image fields${syncProductMedia ? ` plus ${CASE_HANDLE} product/variant media` : '; no variant media updates'}.`
        : 'Accepted no-Gel candidates only; Shopify Files plus charme_product body image fields; no variant media updates.',
    summary: {
      selected: results.length,
      updated: results.filter((result) => result.status === 'updated').length,
      alreadyCurrent: results.filter((result) => result.status === 'already-current').length,
      exactByteMatches: results.filter((result) => result.cdn?.sha256 === result.sha256).length,
      exactPixelMatches: results.filter((result) => result.cdn?.pixelSha256 === result.pixelSha256).length,
      boundedShopifyRoundingMatches: results.filter((result) => (
        result.cdn?.pixelSha256 !== result.pixelSha256
        && result.cdn?.pixelDifference?.alphaChanges === 0
        && result.cdn.pixelDifference.maximumChannelDelta <= SHOPIFY_PIXEL_TOLERANCE.maximumChannelDelta
        && result.cdn.pixelDifference.changedPixelFraction <= SHOPIFY_PIXEL_TOLERANCE.maximumChangedPixelFraction
      )).length,
      productMediaCreated: productMedia.filter((result) => result.mediaStatus === 'created').length,
      productMediaReused: productMedia.filter((result) => result.mediaStatus === 'reused').length,
      productVariantsUpdated: productMedia.reduce((count, result) => count + result.variantIds.length, 0),
      productTargetsCreated: createdTargets.length,
    },
    requestedTargets: [...createTargets.values()],
    createdTargets,
    results,
    productMedia,
  }
  const reportPath = reportPathOverride || (useReviewedSources
    ? OFFICIAL_SOURCE_REPORT_PATH
    : allCaseReviewSources
      ? ALL_CASE_REVIEW_REPORT_PATH
      : fillCaseReviewSources ? CASE_REVIEW_REPORT_PATH : REPORT_PATH)
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Completed: ${report.summary.updated} updated, ${report.summary.alreadyCurrent} already current, ${report.summary.exactPixelMatches} exact pixel matches, ${report.summary.boundedShopifyRoundingMatches} bounded Shopify rounding matches.`)
  console.log(`Report: ${reportPath}`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})