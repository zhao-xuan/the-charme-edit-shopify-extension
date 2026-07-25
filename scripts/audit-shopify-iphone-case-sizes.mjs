#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_CATALOG_URL = 'https://charme-customizer.pages.dev/api/catalog'
const DEFAULT_OUTPUT = 'reference/shopify-iphone-case-size-audit.json'
const DIMENSION_TOLERANCE_MM = 0.15
const MINIMUM_WIDTH_FILL = 0.97
const MINIMUM_HEIGHT_FILL = 0.98
const MAXIMUM_ASPECT_DRIFT_PERCENT = 2
const MAXIMUM_FINISH_ASPECT_DELTA_PERCENT = 1

// Apple device-body dimensions, excluding any case wall, in width x height mm.
const APPLE_DIMENSIONS = {
  'iphone-7': [67.1, 138.3],
  'iphone-8': [67.3, 138.4],
  'iphone-7-plus': [77.9, 158.2],
  'iphone-8-plus': [78.1, 158.4],
  'iphone-x': [70.9, 143.6],
  'iphone-xs': [70.9, 143.6],
  'iphone-xs-max': [77.4, 157.5],
  'iphone-11': [75.7, 150.9],
  'iphone-11-pro': [71.4, 144],
  'iphone-11-pro-max': [77.8, 158],
  'iphone-12-mini': [64.2, 131.5],
  'iphone-12': [71.5, 146.7],
  'iphone-12-pro': [71.5, 146.7],
  'iphone-12-pro-max': [78.1, 160.8],
  'iphone-13-mini': [64.2, 131.5],
  'iphone-13': [71.5, 146.7],
  'iphone-13-pro': [71.5, 146.7],
  'iphone-13-pro-max': [78.1, 160.8],
  'iphone-14': [71.5, 146.7],
  'iphone-14-plus': [78.1, 160.8],
  'iphone-14-pro': [71.5, 147.5],
  'iphone-14-pro-max': [77.6, 160.7],
  'iphone-15': [71.6, 147.6],
  'iphone-15-plus': [77.8, 160.9],
  'iphone-15-pro': [70.6, 146.6],
  'iphone-15-pro-max': [76.7, 159.9],
  'iphone-16': [71.6, 147.6],
  'iphone-16-plus': [77.8, 160.9],
  'iphone-16-pro': [71.5, 149.6],
  'iphone-16-pro-max': [77.6, 163],
  'iphone-17': [71.5, 149.6],
  'iphone-17-pro': [71.9, 150],
  'iphone-17-pro-max': [78, 163.4],
  'iphone-air': [74.7, 156.2],
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits))
}

function percentDelta(actual, expected) {
  return Math.abs(actual / expected - 1) * 100
}

function issue(code, message, evidence = {}) {
  return { code, message, evidence }
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function imageEvidence(url, expectedAspect) {
  const bytes = await fetchBytes(url)
  const image = sharp(bytes)
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let alphaHasBackground = false
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * 4 + 3] <= 40) {
      alphaHasBackground = true
      break
    }
  }

  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    const isSubject = alphaHasBackground
      ? data[offset + 3] > 40
      : Math.min(data[offset], data[offset + 1], data[offset + 2]) < 246
    if (!isSubject) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No visible case found in ${url}`)

  const productWidth = right - left + 1
  const productHeight = bottom - top + 1
  const visibleAspect = productWidth / productHeight
  const widthFill = productWidth / info.width
  const heightFill = productHeight / info.height
  const aspectDriftPercent = percentDelta(visibleAspect, expectedAspect)
  const issues = []
  if (widthFill < MINIMUM_WIDTH_FILL) {
    issues.push(issue('image-too-small-width', `Visible case fills only ${round(widthFill * 100, 2)}% of image width`, {
      actual: round(widthFill), minimum: MINIMUM_WIDTH_FILL,
    }))
  }
  if (heightFill < MINIMUM_HEIGHT_FILL) {
    issues.push(issue('image-too-small-height', `Visible case fills only ${round(heightFill * 100, 2)}% of image height`, {
      actual: round(heightFill), minimum: MINIMUM_HEIGHT_FILL,
    }))
  }
  if (aspectDriftPercent > MAXIMUM_ASPECT_DRIFT_PERCENT) {
    issues.push(issue('image-aspect-ratio', `Visible case ratio differs from the Apple device ratio by ${round(aspectDriftPercent, 2)}%`, {
      actual: round(visibleAspect), expected: round(expectedAspect), maximumDriftPercent: MAXIMUM_ASPECT_DRIFT_PERCENT,
    }))
  }

  return {
    url,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: metadata.format,
    canvasPx: { width: info.width, height: info.height },
    visibleBoundsPx: { left, top, right, bottom, width: productWidth, height: productHeight },
    widthFill: round(widthFill),
    heightFill: round(heightFill),
    visibleAspect: round(visibleAspect),
    expectedDeviceAspect: round(expectedAspect),
    aspectDriftPercent: round(aspectDriftPercent, 2),
    alphaHasBackground,
    status: issues.length ? 'issue' : 'pass',
    issues,
  }
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}

async function main() {
  const catalogUrl = argument('catalog-url', DEFAULT_CATALOG_URL)
  const outputPath = path.resolve(argument('output', DEFAULT_OUTPUT))
  const skipImages = process.argv.includes('--skip-images')
  const catalogResponse = await fetch(catalogUrl, { headers: { 'cache-control': 'no-cache' } })
  if (!catalogResponse.ok) throw new Error(`${catalogUrl} returned ${catalogResponse.status}`)
  const catalog = await catalogResponse.json()
  const products = (catalog.products || []).filter((product) => APPLE_DIMENSIONS[product.id])
  const missing = Object.keys(APPLE_DIMENSIONS).filter((id) => !products.some((product) => product.id === id))
  if (missing.length) throw new Error(`Shopify catalogue is missing: ${missing.join(', ')}`)

  const rows = await mapLimit(products, 4, async (product) => {
    const [officialWidthMm, officialHeightMm] = APPLE_DIMENSIONS[product.id]
    const widthDeltaMm = Number(product.widthMm) - officialWidthMm
    const heightDeltaMm = Number(product.heightMm) - officialHeightMm
    const dimensionIssues = []
    if (Math.abs(widthDeltaMm) > DIMENSION_TOLERANCE_MM) {
      dimensionIssues.push(issue('stored-width', `Shopify width is ${round(widthDeltaMm, 1)} mm above Apple device width`, {
        shopifyMm: product.widthMm, appleMm: officialWidthMm,
      }))
    }
    if (Math.abs(heightDeltaMm) > DIMENSION_TOLERANCE_MM) {
      dimensionIssues.push(issue('stored-height', `Shopify height is ${round(heightDeltaMm, 1)} mm above Apple device height`, {
        shopifyMm: product.heightMm, appleMm: officialHeightMm,
      }))
    }

    const imageSourceIssues = []
    const imageUrls = { white: product.src || '', black: product.srcBlack || '' }
    for (const [finish, url] of Object.entries(imageUrls)) {
      if (!url) {
        imageSourceIssues.push(issue('missing-image', `Shopify has no ${finish} body image`))
      } else if (/case-review/i.test(url)) {
        imageSourceIssues.push(issue('not-without-gel-source', `${finish} body image points to a case-review Gel render, not a without-gel asset`, { url }))
      }
    }

    const images = {}
    if (!skipImages) {
      const expectedAspect = officialWidthMm / officialHeightMm
      for (const [finish, url] of Object.entries(imageUrls)) {
        if (!url) continue
        try {
          images[finish] = await imageEvidence(url, expectedAspect)
        } catch (error) {
          images[finish] = {
            url,
            status: 'issue',
            issues: [issue('image-unreadable', error.message || String(error))],
          }
        }
      }
      if (images.white?.visibleAspect && images.black?.visibleAspect) {
        const finishDeltaPercent = percentDelta(images.white.visibleAspect, images.black.visibleAspect)
        if (finishDeltaPercent > MAXIMUM_FINISH_ASPECT_DELTA_PERCENT) {
          const mismatch = issue('finish-geometry-mismatch', `White and Black visible ratios differ by ${round(finishDeltaPercent, 2)}%`, {
            white: images.white.visibleAspect,
            black: images.black.visibleAspect,
            maximumDeltaPercent: MAXIMUM_FINISH_ASPECT_DELTA_PERCENT,
          })
          images.white.issues.push(mismatch)
          images.black.issues.push(mismatch)
          images.white.status = 'issue'
          images.black.status = 'issue'
        }
      }
    }

    const imageIssues = Object.values(images).flatMap((image) => image.issues || [])
    const allIssues = [...dimensionIssues, ...imageSourceIssues, ...imageIssues]
    const likelyCaseWallOffset = widthDeltaMm >= 2.5 && widthDeltaMm <= 3.5
      && heightDeltaMm >= 2.5 && heightDeltaMm <= 3.5
    return {
      id: product.id,
      name: product.name,
      status: allIssues.length ? 'issue' : 'pass',
      shopifyMm: { width: product.widthMm, height: product.heightMm },
      appleDeviceMm: { width: officialWidthMm, height: officialHeightMm },
      deltaMm: { width: round(widthDeltaMm, 1), height: round(heightDeltaMm, 1) },
      likelyCaseWallOffset,
      dimensionStatus: dimensionIssues.length ? 'issue' : 'pass',
      dimensionIssues,
      imageSourceStatus: imageSourceIssues.length ? 'issue' : 'pass',
      imageSourceIssues,
      imageGeometryStatus: imageIssues.length ? 'issue' : 'pass',
      images,
    }
  })

  const report = {
    generatedAt: new Date().toISOString(),
    catalogUrl,
    scope: 'All live Shopify-backed iPhone products. Apple width x height means device body only; case-wall thickness is excluded.',
    caveat: 'Shopify body_image_white/body_image_black currently point to case-review Gel renders. Their outer shell is measured, but they are marked as the wrong source for a without-gel audit.',
    officialSources: [
      'https://support.apple.com/en-gb/108044',
      'https://www.apple.com/uk/iphone-16/specs/',
      'https://www.apple.com/uk/iphone-17/specs/',
      'https://www.apple.com/uk/iphone-17-pro/specs/',
      'https://www.apple.com/uk/iphone-air/specs/',
    ],
    thresholds: {
      dimensionToleranceMm: DIMENSION_TOLERANCE_MM,
      minimumWidthFill: MINIMUM_WIDTH_FILL,
      minimumHeightFill: MINIMUM_HEIGHT_FILL,
      maximumAspectDriftPercent: MAXIMUM_ASPECT_DRIFT_PERCENT,
      maximumFinishAspectDeltaPercent: MAXIMUM_FINISH_ASPECT_DELTA_PERCENT,
    },
    summary: {
      total: rows.length,
      issues: rows.filter((row) => row.status === 'issue').length,
      dimensionIssues: rows.filter((row) => row.dimensionStatus === 'issue').length,
      imageSourceIssues: rows.filter((row) => row.imageSourceStatus === 'issue').length,
      imageGeometryIssues: rows.filter((row) => row.imageGeometryStatus === 'issue').length,
      passes: rows.filter((row) => row.status === 'pass').length,
    },
    products: rows,
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, ...report.summary }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})