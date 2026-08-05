#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits))
}

function ratioDrift(actual, expected) {
  return Math.abs(actual / expected - 1) * 100
}

function visibleBounds(data, info, alphaThreshold) {
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * info.channels + 3] < alphaThreshold) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No pixels found at alpha >= ${alphaThreshold}`)
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  }
}

async function inspect(filePath, alphaThreshold, haloRadius) {
  const bytes = await readFile(filePath)
  const image = sharp(bytes)
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const bounds = visibleBounds(data, info, alphaThreshold)
  const coreMask = Buffer.alloc(info.width * info.height)
  const alphaStats = { transparent: 0, partial: 0, opaque: 0 }
  const edgePixels = { top: 0, right: 0, bottom: 0, left: 0 }

  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * info.channels + 3]
    if (alpha === 0) alphaStats.transparent += 1
    else if (alpha === 255) alphaStats.opaque += 1
    else alphaStats.partial += 1
    if (alpha >= alphaThreshold) coreMask[index] = 255
    if (alpha === 0) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    if (y === 0) edgePixels.top += 1
    if (x === info.width - 1) edgePixels.right += 1
    if (y === info.height - 1) edgePixels.bottom += 1
    if (x === 0) edgePixels.left += 1
  }

  let haloPixels = 0
  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * info.channels + 3]
    if (alpha === 0 || alpha >= alphaThreshold) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    let nearCore = false
    for (let offsetY = -haloRadius; offsetY <= haloRadius && !nearCore; offsetY += 1) {
      const neighborY = y + offsetY
      if (neighborY < 0 || neighborY >= info.height) continue
      for (let offsetX = -haloRadius; offsetX <= haloRadius; offsetX += 1) {
        const neighborX = x + offsetX
        if (neighborX < 0 || neighborX >= info.width) continue
        if (coreMask[neighborY * info.width + neighborX]) {
          nearCore = true
          break
        }
      }
    }
    if (!nearCore) haloPixels += 1
  }

  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  return {
    path: filePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: metadata.format,
    widthPx: info.width,
    heightPx: info.height,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    visibleBoundsPx: bounds,
    widthFill: round(bounds.width / info.width),
    heightFill: round(bounds.height / info.height),
    visibleAspect: round(bounds.width / bounds.height),
    marginsPx: {
      left: bounds.left,
      top: bounds.top,
      right: info.width - bounds.right - 1,
      bottom: info.height - bounds.bottom - 1,
    },
    alphaStats,
    cornerAlpha: {
      topLeft: alphaAt(0, 0),
      topRight: alphaAt(info.width - 1, 0),
      bottomRight: alphaAt(info.width - 1, info.height - 1),
      bottomLeft: alphaAt(0, info.height - 1),
    },
    edgePixels,
    haloPixelsOutsideDilatedCore: haloPixels,
  }
}

async function main() {
  const candidatePath = argument('candidate')
  const referencePath = argument('reference')
  const alphaThreshold = Number(argument('alpha-threshold', '128'))
  const haloRadius = Number(argument('halo-radius', '3'))
  const maximumAspectDriftPercent = Number(argument('max-aspect-drift', '1'))
  const minimumWidthFill = Number(argument('min-width-fill', '0.97'))
  const minimumHeightFill = Number(argument('min-height-fill', '0.98'))
  const maximumHaloPixels = Number(argument('max-halo-pixels', '100'))
  const expectedAspectArgument = argument('expected-aspect')
  const expectedAspect = expectedAspectArgument ? Number(expectedAspectArgument) : null

  if (!candidatePath || !referencePath) {
    throw new Error('Pass --candidate and --reference')
  }
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 1 || alphaThreshold > 255) {
    throw new Error('--alpha-threshold must be an integer from 1 to 255')
  }
  if (!Number.isInteger(haloRadius) || haloRadius < 1) {
    throw new Error('--halo-radius must be a positive integer')
  }
  if (expectedAspect !== null && (!Number.isFinite(expectedAspect) || expectedAspect <= 0)) {
    throw new Error('--expected-aspect must be a positive number')
  }

  const [candidate, reference] = await Promise.all([
    inspect(candidatePath, alphaThreshold, haloRadius),
    inspect(referencePath, alphaThreshold, haloRadius),
  ])
  const targetAspect = expectedAspect ?? reference.visibleAspect
  const aspectDriftPercent = ratioDrift(candidate.visibleAspect, targetAspect)
  const candidateCanvasAspect = candidate.widthPx / candidate.heightPx
  const adaptiveMinimumWidthFill = Math.min(
    minimumWidthFill,
    minimumHeightFill * targetAspect / candidateCanvasAspect,
  )
  const adaptiveMinimumHeightFill = Math.min(
    minimumHeightFill,
    minimumWidthFill * candidateCanvasAspect / targetAspect,
  )
  const failures = []
  if (candidate.format !== 'png') failures.push('format')
  if (!candidate.hasAlpha) failures.push('alpha-channel')
  if (Object.values(candidate.cornerAlpha).some((alpha) => alpha !== 0)) failures.push('transparent-corners')
  if (Object.values(candidate.edgePixels).some((count) => count !== 0)) failures.push('canvas-edge-leak')
  if (candidate.widthFill < adaptiveMinimumWidthFill) failures.push('width-fill')
  if (candidate.heightFill < adaptiveMinimumHeightFill) failures.push('height-fill')
  if (aspectDriftPercent > maximumAspectDriftPercent) failures.push('aspect-ratio')
  if (candidate.haloPixelsOutsideDilatedCore > maximumHaloPixels) failures.push('alpha-halo')

  const result = {
    passed: failures.length === 0,
    failures,
    thresholds: {
      alphaThreshold,
      haloRadius,
      maximumAspectDriftPercent,
      minimumWidthFill,
      minimumHeightFill,
      adaptiveMinimumWidthFill: round(adaptiveMinimumWidthFill),
      adaptiveMinimumHeightFill: round(adaptiveMinimumHeightFill),
      maximumHaloPixels,
    },
    targetAspect: round(targetAspect),
    targetAspectSource: expectedAspect === null ? 'reference-alpha-bounds' : 'explicit',
    aspectDriftPercent: round(aspectDriftPercent, 2),
    candidate,
    reference,
  }
  console.log(JSON.stringify(result, null, 2))
  if (failures.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})