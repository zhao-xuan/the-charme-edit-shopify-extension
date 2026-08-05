#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VARIANT_MAP_PATH = 'shopify/widget/variantmap-products.generated.json'
const DEFAULT_CATALOG_URL = 'https://charme-customizer.pages.dev/api/catalog'
const DEFAULT_OUTPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-source-audit.json'
const CONCURRENCY = 6
const LIGHT_NEUTRAL = /\b(?:Shell Beige|Cloud White|Cotton|Cream|Ivory|Stone|Light Gr(?:a|e)y|Oat|Chalk)\b/i

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function argValues(flag) {
  return process.argv.flatMap((argument, index) => (
    argument === flag && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ))
}

function modelIdFromVariantKey(key) {
  return key.split(':')[0]
}

function deviceHandle(modelId) {
  if (modelId.startsWith('galaxy-')) return `samsung-${modelId}`
  if (modelId.startsWith('pixel-')) return `google-${modelId}`
  throw new Error(`Unsupported Android model ID: ${modelId}`)
}

function deviceHandleCandidates(modelId) {
  const normalizedModelId = modelId
    .split('-')
    .filter((token) => !['4g', '5g'].includes(token))
    .join('-')
  return [...new Set([deviceHandle(modelId), deviceHandle(normalizedModelId)])]
}

function resolved(values, index) {
  return Number.isInteger(index) && index >= 0 && index < values.length ? values[index] : null
}

function requestedModelMatches(modelId, title) {
  const normalizedTitle = title.toLowerCase().replaceAll('+', ' plus ').replace(/[^a-z0-9]+/g, ' ')
  const coreTokens = modelId
    .replace(/^(galaxy|pixel)-/, '')
    .split('-')
    .filter((token) => !['4g', '5g'].includes(token))
  return coreTokens.every((token) => normalizedTitle.split(' ').includes(token))
}

function variantsFromHtml(modelId, html) {
  const match = html.match(/<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Missing __NUXT_DATA__ payload')

  const values = JSON.parse(match[1])
  const variants = []
  for (const value of values) {
    if (!value || Array.isArray(value) || typeof value !== 'object') continue
    const title = resolved(values, value.title)
    const code = resolved(values, value.code)
    if (typeof title !== 'string' || typeof code !== 'string') continue
    if (!title.includes('SolidSuit') || title.includes('MagSafe compatible')) continue
    if (!requestedModelMatches(modelId, title)) continue
    variants.push({
      title,
      sku: code,
      mainBodySku: resolved(values, value.mainBodySKU),
      shopifyVariantId: resolved(values, value.shopifyVariantId),
    })
  }

  return [...new Map(variants.map((variant) => [`${variant.title}\0${variant.sku}`, variant])).values()]
}

function categoryFor(variants) {
  const black = variants.find((variant) => /\bSolidSuit Black$/i.test(variant.title)) || null
  const texturedDark = variants.find((variant) => /\bBlack$/i.test(variant.title)) || null
  const white = variants.find((variant) => /\bWhite$/i.test(variant.title)) || null
  const lightNeutral = variants.find((variant) => LIGHT_NEUTRAL.test(variant.title)) || null
  if (black && white) return { category: 'black-and-white', black, texturedDark: null, light: white }
  if (black && lightNeutral) return { category: 'black-and-light-neutral', black, texturedDark: null, light: lightNeutral }
  if (black) return { category: 'black-only', black, texturedDark: null, light: null }
  if (texturedDark && white) return { category: 'textured-dark-and-white', black: null, texturedDark, light: white }
  if (texturedDark && lightNeutral) return { category: 'textured-dark-and-light-neutral', black: null, texturedDark, light: lightNeutral }
  if (texturedDark) return { category: 'textured-dark-only', black: null, texturedDark, light: null }
  if (variants.length) return { category: 'variants-without-black', black: null, texturedDark: null, light: lightNeutral || white }
  return { category: 'unsupported', black: null, texturedDark: null, light: null }
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run))
  return results
}

async function auditModel(modelId) {
  const attempts = []
  try {
    for (const handle of deviceHandleCandidates(modelId)) {
      const productPageUrl = `https://rhinoshield.io/products/solidsuit/buy?device=${handle}`
      const response = await fetch(productPageUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const variants = variantsFromHtml(modelId, await response.text())
      attempts.push({ deviceHandle: handle, productPageUrl, finalUrl: response.url, variants: variants.length })
      if (!variants.length) continue
      return {
        modelId,
        deviceHandle: handle,
        productPageUrl,
        finalUrl: response.url,
        handleAttempts: attempts,
        ...categoryFor(variants),
        variants,
      }
    }
    return {
      modelId,
      deviceHandle: attempts.at(-1)?.deviceHandle || deviceHandle(modelId),
      productPageUrl: attempts.at(-1)?.productPageUrl || null,
      finalUrl: attempts.at(-1)?.finalUrl || null,
      handleAttempts: attempts,
      ...categoryFor([]),
      variants: [],
    }
  } catch (error) {
    return {
      modelId,
      deviceHandle: attempts.at(-1)?.deviceHandle || deviceHandle(modelId),
      productPageUrl: attempts.at(-1)?.productPageUrl || null,
      handleAttempts: attempts,
      category: 'error',
      error: error.message,
      variants: [],
    }
  }
}

async function main() {
  const catalogUrl = argValue('--catalog-url', DEFAULT_CATALOG_URL)
  const outputPath = argValue('--output', DEFAULT_OUTPUT)
  const expectedTargetsValue = argValue('--expected-targets', '')
  const expectedTargets = expectedTargetsValue === '' ? null : Number(expectedTargetsValue)
  const requestedModelIds = [...new Set(argValues('--model'))].sort()
  if (expectedTargets !== null && (!Number.isInteger(expectedTargets) || expectedTargets < 0)) {
    throw new Error('--expected-targets must be a non-negative integer')
  }
  if (requestedModelIds.some((modelId) => !modelId.startsWith('galaxy-') && !modelId.startsWith('pixel-'))) {
    throw new Error('--model only supports galaxy-* and pixel-* IDs')
  }
  const [variantMap, catalog] = await Promise.all([
    readFile(VARIANT_MAP_PATH, 'utf8').then(JSON.parse),
    fetch(catalogUrl, { signal: AbortSignal.timeout(30_000) }).then((response) => {
      if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`)
      return response.json()
    }),
  ])

  const liveIds = new Set((catalog.products || []).map((product) => product.id))
  const targetIds = requestedModelIds.length
    ? requestedModelIds
    : [...new Set(Object.keys(variantMap).map(modelIdFromVariantKey))]
      .filter((modelId) => modelId.startsWith('galaxy-') || modelId.startsWith('pixel-'))
      .filter((modelId) => !liveIds.has(modelId))
      .sort()
  if (expectedTargets !== null && targetIds.length !== expectedTargets) {
    throw new Error(`Expected ${expectedTargets} missing Samsung/Pixel models, found ${targetIds.length}`)
  }

  const results = await mapConcurrent(targetIds, CONCURRENCY, auditModel)
  const categoryNames = [
    'black-and-white',
    'black-and-light-neutral',
    'black-only',
    'textured-dark-and-white',
    'textured-dark-and-light-neutral',
    'textured-dark-only',
    'variants-without-black',
    'unsupported',
    'error',
  ]
  const categories = Object.fromEntries(categoryNames.map((category) => [
    category,
    results.filter((result) => result.category === category).map((result) => result.modelId),
  ]))
  const categorizedCount = Object.values(categories).reduce((sum, modelIds) => sum + modelIds.length, 0)
  if (categorizedCount !== targetIds.length) {
    throw new Error(`Categorized ${categorizedCount}/${targetIds.length} models`)
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogUrl,
    source: 'RHINOSHIELD public SolidSuit product-page Nuxt data',
    scope: requestedModelIds.length
      ? 'Explicitly requested Samsung and Google Pixel models; no image bytes downloaded.'
      : 'Missing Shopify-backed Samsung and Google Pixel models only; no image bytes downloaded.',
    summary: Object.fromEntries(categoryNames.map((category) => [category, categories[category].length])),
    categories,
    results,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, targetCount: targetIds.length, summary: report.summary }, null, 2))
}

await main()