#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shopifyAdmin } from '../functions/api/_lib.js'

const CASE_HANDLE = argumentValue('case-handle', 'custom-charm-phone-case')
const OUTPUT_PATH = argumentValue(
  'output',
  'reference/case-history/generated/all-phone-real-image-completion/shopify-case-coverage-audit.json',
)
const PLATFORM = argumentValue('platform', 'all')
const REQUIRE_COMPLETE = process.argv.includes('--require-complete')
const METAOBJECT_TYPE = 'charme_product'
const REPORT_ROOT = 'reference/case-history/generated'
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
  if (!['all', 'apple', 'android'].includes(PLATFORM)) {
    throw new Error('--platform must be all, apple, or android')
  }
  if (path.isAbsolute(OUTPUT_PATH) || !OUTPUT_PATH.startsWith(`${REPORT_ROOT}/`)) {
    throw new Error(`--output must be under ${REPORT_ROOT}`)
  }
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

function platformFor(modelId) {
  return modelId.startsWith('iphone-') ? 'apple' : 'android'
}

function isDeviceModel(modelId) {
  return /^(iphone|galaxy|pixel)-/.test(modelId)
}

function mediaKey(modelId, finish) {
  return `${modelId}\u0000${finish}`
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
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`

const Q_METAOBJECTS = `
  query($after: String) {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 100, after: $after) {
      nodes {
        id handle type
        fields {
          key value
          reference {
            ... on MediaImage { id fileStatus image { url width height } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`

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

async function metaobjects() {
  const nodes = []
  let after = null
  do {
    const data = await admin(Q_METAOBJECTS, { after })
    const page = data.metaobjects
    nodes.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)
  return nodes
}

async function reportPaths(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await reportPaths(entryPath))
    else if (/^shopify.*report\.json$/i.test(entry.name)) paths.push(entryPath)
  }
  return paths
}

async function publishedFileEvidence() {
  const evidence = new Map()
  for (const reportPath of await reportPaths(REPORT_ROOT)) {
    let report
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'))
    } catch {
      continue
    }
    const withoutGelReport = /without-gel/i.test(`${report.campaign || ''} ${report.scope || ''}`)
    if (!withoutGelReport) continue
    for (const result of report.results || []) {
      if (!result.fileId || !result.modelId || !result.finish) continue
      evidence.set(result.fileId, {
        reportPath,
        modelId: result.modelId,
        finish: result.finish,
        sourceKind: result.sourceKind || report.sourceMode || null,
        sourcePath: result.sourcePath || null,
      })
    }
  }
  return evidence
}

function imageClassification(image, evidence) {
  if (!image?.id) return 'missing'
  if (evidence.has(image.id)) return 'published-without-gel'
  const url = image.image?.url || ''
  if (/without-gel/i.test(url)) return 'url-without-gel-marker'
  if (/case-review/i.test(url)) return 'case-review-gel'
  return 'unproven'
}

async function main() {
  requireInputs()
  const product = await findProduct()
  const [variants, products, evidence] = await Promise.all([
    productVariants(product.id),
    metaobjects(),
    publishedFileEvidence(),
  ])
  const { colour, model } = optionRoles(product.options || [])
  if (!colour || !model) throw new Error(`Could not identify model and colour options on ${CASE_HANDLE}`)

  const variantsByKey = new Map()
  const modelNames = new Map()
  for (const variant of variants) {
    const modelName = selectedOption(variant, model.name)
    const modelId = slugModel(modelName)
    const finish = variantFinish(selectedOption(variant, colour.name))
    if (!modelId || !finish) continue
    const key = mediaKey(modelId, finish)
    variantsByKey.set(key, [...(variantsByKey.get(key) || []), variant])
    modelNames.set(modelId, modelName)
  }

  const productsById = new Map()
  for (const metaobject of products) {
    const modelId = field(metaobject, 'legacy_id')?.value || metaobject.handle
    if (productsById.has(modelId)) throw new Error(`Duplicate ${METAOBJECT_TYPE} legacy_id: ${modelId}`)
    productsById.set(modelId, metaobject)
  }

  const allModelIds = [...new Set([...variantsByKey.keys()].map((key) => key.split('\u0000')[0]))]
  const excludedNonDeviceModelIds = allModelIds.filter((modelId) => !isDeviceModel(modelId)).sort()
  const modelIds = allModelIds
    .filter(isDeviceModel)
    .filter((modelId) => PLATFORM === 'all' || platformFor(modelId) === PLATFORM)
    .sort()
  const auditedModels = modelIds.map((modelId) => {
    const metaobject = productsById.get(modelId)
    const finishes = Object.fromEntries(['black', 'white'].flatMap((finish) => {
      const targetVariants = variantsByKey.get(mediaKey(modelId, finish)) || []
      if (!targetVariants.length) return []
      const bodyField = field(metaobject || {}, `body_image_${finish}`)
      const image = bodyField?.reference || null
      const classification = imageClassification(image, evidence)
      const plainShellProven = ['published-without-gel', 'url-without-gel-marker'].includes(classification)
      const gaps = []
      if (!metaobject) gaps.push('missing-metaobject')
      if (!image) gaps.push('missing-body-image')
      else if (image.fileStatus !== 'READY') gaps.push('body-image-not-ready')
      if (image && !plainShellProven) gaps.push(`body-image-${classification}`)
      return [[finish, {
        variantIds: targetVariants.map((variant) => variant.id),
        bodyImage: image ? {
          id: image.id,
          status: image.fileStatus,
          url: image.image?.url || null,
          width: image.image?.width || null,
          height: image.image?.height || null,
          classification,
          evidence: evidence.get(image.id) || null,
        } : null,
        complete: gaps.length === 0,
        gaps,
      }]]
    }))
    const expectedFinishes = Object.keys(finishes)
    return {
      modelId,
      modelName: modelNames.get(modelId) || modelId,
      platform: platformFor(modelId),
      metaobjectId: metaobject?.id || null,
      complete: expectedFinishes.length === 2 && expectedFinishes.every((finish) => finishes[finish].complete),
      finishes,
    }
  })

  const finishEntries = auditedModels.flatMap((item) => Object.values(item.finishes))
  const summary = {
    platform: PLATFORM,
    models: auditedModels.length,
    appleModels: auditedModels.filter((item) => item.platform === 'apple').length,
    androidModels: auditedModels.filter((item) => item.platform === 'android').length,
    completeModels: auditedModels.filter((item) => item.complete).length,
    modelsWithGaps: auditedModels.filter((item) => !item.complete).length,
    finishTargets: finishEntries.length,
    completeFinishTargets: finishEntries.filter((item) => item.complete).length,
    readyProvenBodyImages: finishEntries.filter((item) => (
      item.bodyImage?.status === 'READY'
      && ['published-without-gel', 'url-without-gel-marker'].includes(item.bodyImage.classification)
    )).length,
    shopifyVariantTargets: finishEntries.reduce((count, item) => count + item.variantIds.length, 0),
  }
  const audit = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scope: 'customizer-only-shopify-files-and-charme-product-references',
    productMediaRequired: false,
    variantMediaRequired: false,
    product: { id: product.id, handle: product.handle, title: product.title },
    excludedNonDeviceModelIds,
    valid: summary.modelsWithGaps === 0,
    summary,
    gapModels: auditedModels.filter((item) => !item.complete),
    completeModelIds: auditedModels.filter((item) => item.complete).map((item) => item.modelId),
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(audit, null, 2)}\n`)
  console.log(JSON.stringify({ valid: audit.valid, summary, output: OUTPUT_PATH }, null, 2))
  if (REQUIRE_COMPLETE && !audit.valid) {
    throw new Error(`${summary.modelsWithGaps} models still have Shopify Files/metaobject coverage gaps`)
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})