#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const CATALOG_URL = argumentValue('catalog', 'https://charme-customizer.pages.dev/api/catalog')
const OUTPUT_PATH = argumentValue(
  'output',
  'reference/case-history/generated/all-phone-real-image-completion/shopify-case-phone-body-audit.json',
)
const DEVICE_ID = /^(iphone|galaxy|pixel|xiaomi|huawei)-/
const ALPHA_VISIBLE = 16
const ALPHA_CLEAR = 8
const SHELL_ONLY_FRACTION = 0.002
const LEFT_CAMERA_PIXEL_MODELS = new Set(['pixel-5', 'pixel-9a'])

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function expectedCameraSide(modelId) {
  if (LEFT_CAMERA_PIXEL_MODELS.has(modelId)) return 'left'
  if (modelId.startsWith('pixel-') || modelId.startsWith('huawei-')) return 'center'
  if (/^iphone-(17|air)/.test(modelId)) return 'review'
  return 'left'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fetchOk(url) {
  const response = await fetch(url, { headers: { accept: 'application/json,image/*' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

function alphaBounds(data, width, height, channels) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] <= ALPHA_VISIBLE) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Image has no visible alpha subject')
  return { minX, minY, maxX, maxY }
}

function enclosedClearComponents(data, width, height, channels, bounds) {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  const components = []
  const boxArea = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1)
  const minimumArea = Math.max(4, Math.round(boxArea * 0.00002))

  for (let startY = bounds.minY; startY <= bounds.maxY; startY += 1) {
    for (let startX = bounds.minX; startX <= bounds.maxX; startX += 1) {
      const start = startY * width + startX
      if (visited[start] || data[start * channels + 3] > ALPHA_CLEAR) continue
      let head = 0
      let tail = 0
      let area = 0
      let sumX = 0
      let sumY = 0
      let minX = startX
      let maxX = startX
      let minY = startY
      let maxY = startY
      let touchesBounds = false
      visited[start] = 1
      queue[tail++] = start

      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = Math.floor(index / width)
        area += 1
        sumX += x
        sumY += y
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        if (x === bounds.minX || x === bounds.maxX || y === bounds.minY || y === bounds.maxY) {
          touchesBounds = true
        }
        const neighbours = [index - 1, index + 1, index - width, index + width]
        for (const next of neighbours) {
          const nextX = next % width
          const nextY = Math.floor(next / width)
          if (
            next < 0 || next >= visited.length
            || nextX < bounds.minX || nextX > bounds.maxX
            || nextY < bounds.minY || nextY > bounds.maxY
            || Math.abs(nextX - x) + Math.abs(nextY - y) !== 1
            || visited[next] || data[next * channels + 3] > ALPHA_CLEAR
          ) continue
          visited[next] = 1
          queue[tail++] = next
        }
      }
      if (!touchesBounds && area >= minimumArea) {
        components.push({ area, cx: sumX / area, cy: sumY / area, minX, minY, maxX, maxY })
      }
    }
  }
  return components.sort((a, b) => b.area - a.area)
}

function upperDetail(data, width, channels, bounds) {
  const boxWidth = bounds.maxX - bounds.minX + 1
  const boxHeight = bounds.maxY - bounds.minY + 1
  const y0 = Math.round(bounds.minY + boxHeight * 0.03)
  const y1 = Math.round(bounds.minY + boxHeight * 0.42)
  const inset = Math.round(boxWidth * 0.04)
  const middle = (bounds.minX + bounds.maxX) / 2
  const totals = { left: 0, right: 0 }
  const counts = { left: 0, right: 0 }
  for (let y = y0; y < y1; y += 1) {
    for (let x = bounds.minX + inset; x < bounds.maxX - inset; x += 1) {
      if (Math.abs(x - middle) < boxWidth * 0.04) continue
      const index = (y * width + x) * channels
      const right = index + channels
      const down = index + width * channels
      if (
        data[index + 3] <= ALPHA_VISIBLE
        || data[right + 3] <= ALPHA_VISIBLE
        || data[down + 3] <= ALPHA_VISIBLE
      ) continue
      let gradient = 0
      for (let channel = 0; channel < 3; channel += 1) {
        gradient += Math.abs(data[index + channel] - data[right + channel])
        gradient += Math.abs(data[index + channel] - data[down + channel])
      }
      const side = x < middle ? 'left' : 'right'
      totals[side] += gradient
      counts[side] += 1
    }
  }
  const left = totals.left / Math.max(1, counts.left)
  const right = totals.right / Math.max(1, counts.right)
  const ratio = left / Math.max(0.001, right)
  return {
    left: +left.toFixed(3),
    right: +right.toFixed(3),
    leftToRightRatio: +ratio.toFixed(3),
    observedSide: ratio >= 1.2 ? 'left' : ratio <= 1 / 1.2 ? 'right' : 'ambiguous',
  }
}

async function analyzeImage(url) {
  const bytes = Buffer.from(await (await fetchOk(url)).arrayBuffer())
  const source = sharp(bytes, { failOn: 'error' })
  const metadata = await source.metadata()
  const sampleWidth = Math.min(360, metadata.width || 360)
  const { data, info } = await source
    .clone()
    .ensureAlpha()
    .resize({ width: sampleWidth, withoutEnlargement: true, kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const bounds = alphaBounds(data, info.width, info.height, info.channels)
  const components = enclosedClearComponents(data, info.width, info.height, info.channels, bounds)
  const boxWidth = bounds.maxX - bounds.minX + 1
  const boxHeight = bounds.maxY - bounds.minY + 1
  const boxArea = boxWidth * boxHeight
  const clearArea = components.reduce((sum, component) => sum + component.area, 0)
  const clearFraction = clearArea / boxArea
  const cameraComponents = components.filter((component) => (
    component.cy <= bounds.minY + boxHeight * 0.48
  ))
  const cameraArea = cameraComponents.reduce((sum, component) => sum + component.area, 0)
  const cameraFraction = cameraArea / boxArea
  const weightedCameraX = cameraArea
    ? cameraComponents.reduce((sum, component) => sum + component.cx * component.area, 0) / cameraArea
    : null
  const cameraX = weightedCameraX == null ? null : (weightedCameraX - bounds.minX) / boxWidth
  const status = cameraFraction >= SHELL_ONLY_FRACTION
    ? 'shell-only'
    : cameraFraction <= SHELL_ONLY_FRACTION / 4
      ? 'phone-body'
      : 'needs-review'
  const detail = upperDetail(data, info.width, info.channels, bounds)
  const observedCameraSide = status === 'shell-only' && cameraX != null
    ? cameraX < 0.45 ? 'left' : cameraX > 0.55 ? 'right' : 'center'
    : detail.observedSide
  return {
    sha256: sha256(bytes),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    status,
    sampledWidth: info.width,
    sampledHeight: info.height,
    alphaBounds: bounds,
    enclosedClearComponents: components.length,
    enclosedClearFraction: +clearFraction.toFixed(6),
    cameraClearComponents: cameraComponents.length,
    cameraClearFraction: +cameraFraction.toFixed(6),
    cameraCenterX: cameraX == null ? null : +cameraX.toFixed(4),
    upperDetail: detail,
    observedCameraSide,
  }
}

function orientationStatus(expected, observed) {
  if (expected === 'review') return 'needs-review'
  if (expected === 'center') return observed === 'right' || observed === 'left' ? 'needs-review' : 'pass'
  if (observed === expected) return 'pass'
  if (observed === 'ambiguous' || observed === 'center') return 'needs-review'
  return 'mirrored'
}

async function main() {
  const catalog = await (await fetchOk(CATALOG_URL)).json()
  const products = (catalog.products || []).filter((product) => DEVICE_ID.test(product.id))
  const targets = []
  for (const product of products) {
    for (const [finish, url] of [['black', product.srcBlack], ['white', product.src]]) {
      if (!url) {
        targets.push({ modelId: product.id, modelName: product.name, finish, url: null, status: 'missing' })
        continue
      }
      const analysis = await analyzeImage(url)
      const expected = expectedCameraSide(product.id)
      targets.push({
        modelId: product.id,
        modelName: product.name,
        finish,
        url,
        status: analysis.status,
        expectedCameraSide: expected,
        orientationStatus: orientationStatus(expected, analysis.observedCameraSide),
        analysis,
      })
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')
  const count = (status) => targets.filter((target) => target.status === status).length
  const summary = {
    catalogProducts: catalog.products?.length || 0,
    deviceModels: products.length,
    finishTargets: targets.length,
    phoneBody: count('phone-body'),
    shellOnly: count('shell-only'),
    needsReview: count('needs-review'),
    missing: count('missing'),
    mirrored: targets.filter((target) => target.orientationStatus === 'mirrored').length,
    orientationNeedsReview: targets.filter((target) => target.orientationStatus === 'needs-review').length,
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogUrl: CATALOG_URL,
    thresholds: { alphaVisible: ALPHA_VISIBLE, alphaClear: ALPHA_CLEAR, shellOnlyFraction: SHELL_ONLY_FRACTION },
    summary,
    generationTargets: targets.filter((target) => target.status === 'shell-only'),
    manualReviewTargets: targets.filter((target) => (
      target.status === 'needs-review' || target.orientationStatus !== 'pass'
    )),
    missingTargets: targets.filter((target) => target.status === 'missing'),
    targets,
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ summary, output: OUTPUT_PATH }, null, 2))
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})