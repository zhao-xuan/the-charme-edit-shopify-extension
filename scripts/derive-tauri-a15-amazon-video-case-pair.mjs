#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/tauri-a15-amazon-video-case-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/tauri-a15-amazon-video-case-derived-provenance.json'
const OUTPUT_PADDING = 16
const EDGE_BLUR_SIGMA = 6
const MINIMUM_SIGNIFICANT_HOLE_PIXELS = 100
const FINISHES = ['black', 'white']

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function boundsForMask(mask, width, height) {
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
  let pixels = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue
    const x = index % width
    const y = Math.floor(index / width)
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxY = Math.max(bounds.maxY, y)
    pixels += 1
  }
  assert(pixels > 0, 'Foreground mask is empty')
  return { bounds, pixels }
}

function connectedDarkComponent(data, info, threshold, seed) {
  const pixelCount = info.width * info.height
  const candidates = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * info.channels
    if (Math.max(data[offset], data[offset + 1], data[offset + 2]) <= threshold) candidates[index] = 1
  }
  const seedIndex = seed.y * info.width + seed.x
  assert(candidates[seedIndex], `Foreground seed is not dark at threshold ${threshold}`)
  const mask = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 1
  queue[0] = seedIndex
  mask[seedIndex] = 1
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % info.width
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < info.width ? index + 1 : -1,
      index >= info.width ? index - info.width : -1,
      index + info.width < pixelCount ? index + info.width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || !candidates[neighbor] || mask[neighbor]) continue
      mask[neighbor] = 1
      queue[tail] = neighbor
      tail += 1
    }
  }
  return { mask, ...boundsForMask(mask, info.width, info.height) }
}

function connectedBrightComponent(data, info, threshold, seed) {
  const pixelCount = info.width * info.height
  const isBright = (index) => {
    const offset = index * info.channels
    return Math.max(data[offset], data[offset + 1], data[offset + 2]) >= threshold
  }
  const seedIndex = seed.y * info.width + seed.x
  assert(isBright(seedIndex), `Opening seed is not bright at threshold ${threshold}`)
  const mask = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  const bounds = { minX: info.width, minY: info.height, maxX: -1, maxY: -1 }
  let sumX = 0
  let sumY = 0
  let head = 0
  let tail = 1
  queue[0] = seedIndex
  mask[seedIndex] = 1
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % info.width
    const y = Math.floor(index / info.width)
    bounds.minX = Math.min(bounds.minX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.maxY = Math.max(bounds.maxY, y)
    sumX += x + 0.5
    sumY += y + 0.5
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < info.width ? index + 1 : -1,
      index >= info.width ? index - info.width : -1,
      index + info.width < pixelCount ? index + info.width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || mask[neighbor] || !isBright(neighbor)) continue
      mask[neighbor] = 1
      queue[tail] = neighbor
      tail += 1
    }
  }
  return {
    mask,
    indices: Int32Array.from(queue.subarray(0, tail)),
    bounds,
    pixels: tail,
    centroid: { x: sumX / tail, y: sumY / tail },
  }
}

function maskIou(left, right) {
  assert(left.length === right.length, 'Cannot compare masks with different dimensions')
  let intersection = 0
  let union = 0
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] || right[index]) union += 1
    if (left[index] && right[index]) intersection += 1
  }
  return intersection / union
}

function boundsDrift(left, right) {
  return Math.max(
    Math.abs(left.minX - right.minX),
    Math.abs(left.minY - right.minY),
    Math.abs(left.maxX - right.maxX),
    Math.abs(left.maxY - right.maxY),
  )
}

function findInternalComponents(mask, width, height) {
  const pixelCount = width * height
  const exterior = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0
  const enqueueExterior = (index) => {
    if (mask[index] || exterior[index]) return
    exterior[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    enqueueExterior(x)
    enqueueExterior((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueueExterior(y * width)
    enqueueExterior(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      index >= width ? index - width : -1,
      index + width < pixelCount ? index + width : -1,
    ]
    for (const neighbor of neighbors) {
      if (neighbor >= 0) enqueueExterior(neighbor)
    }
  }

  const visited = new Uint8Array(pixelCount)
  const components = []
  for (let start = 0; start < pixelCount; start += 1) {
    if (mask[start] || exterior[start] || visited[start]) continue
    head = 0
    tail = 1
    queue[0] = start
    visited[start] = 1
    const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
    while (head < tail) {
      const index = queue[head]
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        index >= width ? index - width : -1,
        index + width < pixelCount ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || mask[neighbor] || exterior[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        queue[tail] = neighbor
        tail += 1
      }
    }
    components.push({
      componentIndex: components.length,
      pixels: tail,
      bounds,
      indices: Int32Array.from(queue.subarray(0, tail)),
    })
  }
  return components
}

function inRange(value, range) {
  return value >= range[0] && value <= range[1]
}

function extractBrightOpenings(data, info, threshold, segmentation) {
  const combinedMask = new Uint8Array(info.width * info.height)
  const openings = segmentation.openings.map((profile) => {
    const component = connectedBrightComponent(data, info, threshold, profile.seed)
    assert(component.pixels >= profile.minimumPixels, `${profile.id}: too few bright pixels at threshold ${threshold}`)
    for (const [key, range] of Object.entries(profile.expectedBounds)) {
      assert(inRange(component.bounds[key], range), `${profile.id}: ${key} changed to ${component.bounds[key]} at threshold ${threshold}`)
    }
    for (const index of component.indices) {
      assert(!combinedMask[index], `${profile.id}: opening components overlap at threshold ${threshold}`)
      combinedMask[index] = 1
    }
    return { ...component, openingId: profile.id }
  })
  return { mask: combinedMask, openings }
}

function normalizedComponent(component, bodyBounds) {
  const bodyWidth = bodyBounds.maxX - bodyBounds.minX + 1
  const bodyHeight = bodyBounds.maxY - bodyBounds.minY + 1
  const width = component.bounds.maxX - component.bounds.minX + 1
  const height = component.bounds.maxY - component.bounds.minY + 1
  return {
    componentIndex: component.componentIndex,
    pixels: component.pixels,
    bounds: component.bounds,
    centerX: ((component.bounds.minX + component.bounds.maxX) / 2 - bodyBounds.minX) / bodyWidth,
    centerY: ((component.bounds.minY + component.bounds.maxY) / 2 - bodyBounds.minY) / bodyHeight,
    width: width / bodyWidth,
    height: height / bodyHeight,
    aspect: width / height,
  }
}

function componentCentroid(component, width) {
  let sumX = 0
  let sumY = 0
  for (const index of component.indices) {
    sumX += (index % width) + 0.5
    sumY += Math.floor(index / width) + 0.5
  }
  return { x: sumX / component.pixels, y: sumY / component.pixels }
}

function evaluateSourceOpenings(components, bodyBounds, openingProfiles) {
  const significant = components
    .filter((component) => component.pixels >= MINIMUM_SIGNIFICANT_HOLE_PIXELS)
    .map((component) => normalizedComponent(component, bodyBounds))
  const used = new Set()
  const matches = []
  for (const opening of openingProfiles) {
    const candidates = significant.filter((component) => (
      !used.has(component.componentIndex)
      && component.pixels >= opening.minimumPixels
      && inRange(component.centerX, opening.centerX)
      && inRange(component.centerY, opening.centerY)
      && inRange(component.width, opening.width)
      && inRange(component.height, opening.height)
    ))
    assert(candidates.length === 1, `Expected one ${opening.id} opening, found ${candidates.length}: ${JSON.stringify(significant)}`)
    used.add(candidates[0].componentIndex)
    matches.push({ ...candidates[0], openingId: opening.id })
  }
  const unexpectedSignificant = significant.filter((component) => !used.has(component.componentIndex))
  assert(unexpectedSignificant.length === 0, `Unexpected significant openings: ${JSON.stringify(unexpectedSignificant)}`)
  return { matches, unexpectedSignificant }
}

function cleanInternalArtifacts(mask, width, height, bodyBounds, openingProfiles) {
  const components = findInternalComponents(mask, width, height)
  const evaluation = evaluateSourceOpenings(components, bodyBounds, openingProfiles)
  const retained = new Set(evaluation.matches.map((opening) => opening.componentIndex))
  let filledComponents = 0
  let filledPixels = 0
  for (const component of components) {
    if (retained.has(component.componentIndex)) continue
    for (const index of component.indices) mask[index] = 1
    filledComponents += 1
    filledPixels += component.pixels
  }
  return { ...evaluation, components, filledComponents, filledPixels }
}

function fillMatchedOpenings(mask, cleanup) {
  const componentsByIndex = new Map(cleanup.components.map((component) => [component.componentIndex, component]))
  let pixels = 0
  for (const opening of cleanup.matches) {
    const component = componentsByIndex.get(opening.componentIndex)
    for (const index of component.indices) mask[index] = 1
    pixels += component.pixels
  }
  return { components: cleanup.matches.length, pixels }
}

function linearRegression(points) {
  assert(points.length >= 8, 'Not enough points for line fit')
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY)
    denominator += (point.x - meanX) ** 2
  }
  assert(denominator > 0, 'Degenerate line fit')
  const slope = numerator / denominator
  const intercept = meanY - slope * meanX
  const residuals = points.map((point) => Math.abs(point.y - (slope * point.x + intercept)))
  const rms = Math.sqrt(residuals.reduce((sum, residual) => sum + residual ** 2, 0) / residuals.length)
  return { slope, intercept, rms, residuals }
}

function robustLine(points) {
  let selected = points
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const fit = linearRegression(selected)
    const sorted = [...fit.residuals].sort((left, right) => left - right)
    const median = sorted[Math.floor(sorted.length / 2)]
    const limit = Math.max(1.25, median * 3)
    const filtered = selected.filter((point) => Math.abs(point.y - (fit.slope * point.x + fit.intercept)) <= limit)
    if (filtered.length === selected.length || filtered.length < 8) break
    selected = filtered
  }
  const fit = linearRegression(selected)
  return { slope: fit.slope, intercept: fit.intercept, rms: fit.rms, points: selected.length, candidates: points.length }
}

function fitOuterLines(mask, width, height, bounds) {
  const bodyWidth = bounds.maxX - bounds.minX + 1
  const bodyHeight = bounds.maxY - bounds.minY + 1
  const sideStart = Math.round(bounds.minY + bodyHeight * 0.20)
  const sideEnd = Math.round(bounds.minY + bodyHeight * 0.82)
  const leftPoints = []
  const rightPoints = []
  for (let y = sideStart; y <= sideEnd; y += 1) {
    let minX = width
    let maxX = -1
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!mask[y * width + x]) continue
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
    if (maxX >= 0) {
      leftPoints.push({ x: y, y: minX })
      rightPoints.push({ x: y, y: maxX })
    }
  }
  const edgeStart = Math.round(bounds.minX + bodyWidth * 0.25)
  const edgeEnd = Math.round(bounds.minX + bodyWidth * 0.75)
  const topPoints = []
  const bottomPoints = []
  for (let x = edgeStart; x <= edgeEnd; x += 1) {
    let minY = height
    let maxY = -1
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      if (!mask[y * width + x]) continue
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    if (maxY >= 0) {
      topPoints.push({ x, y: minY })
      bottomPoints.push({ x, y: maxY })
    }
  }
  return {
    left: robustLine(leftPoints),
    right: robustLine(rightPoints),
    top: robustLine(topPoints),
    bottom: robustLine(bottomPoints),
  }
}

function intersectSideAndEdge(side, edge) {
  const denominator = 1 - side.slope * edge.slope
  assert(Math.abs(denominator) > 1e-6, 'Parallel fitted edges')
  const x = (side.slope * edge.intercept + side.intercept) / denominator
  const y = edge.slope * x + edge.intercept
  return { x, y }
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length
  const rows = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    assert(Math.abs(rows[pivot][column]) > 1e-10, 'Singular homography system')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let index = column; index <= size; index += 1) rows[column][index] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let index = column; index <= size; index += 1) rows[row][index] -= factor * rows[column][index]
    }
  }
  return rows.map((row) => row[size])
}

function homography(from, to) {
  const matrix = []
  const vector = []
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index]
    const { x: u, y: v } = to[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    vector.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    vector.push(v)
  }
  return [...solveLinearSystem(matrix, vector), 1]
}

function affineTransform(from, to) {
  assert(from.length === 3 && to.length === 3, 'Affine transform requires three point pairs')
  const matrix = []
  const vector = []
  for (let index = 0; index < 3; index += 1) {
    const { x, y } = from[index]
    const { x: u, y: v } = to[index]
    matrix.push([x, y, 1, 0, 0, 0])
    vector.push(u)
    matrix.push([0, 0, 0, x, y, 1])
    vector.push(v)
  }
  const values = solveLinearSystem(matrix, vector)
  return [values[0], values[1], values[2], values[3], values[4], values[5], 0, 0, 1]
}

function transformPoint(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  }
}

function transformedComponentBounds(component, sourceToUnit, sourceWidth) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const index of component.indices) {
    const point = transformPoint(sourceToUnit, {
      x: (index % sourceWidth) + 0.5,
      y: Math.floor(index / sourceWidth) + 0.5,
    })
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  return bounds
}

function warpMask(sourceMask, sourceWidth, sourceHeight, sourceCorners, destinationCorners, outputWidth, outputHeight) {
  const destinationToSource = homography(destinationCorners, sourceCorners)
  const output = new Uint8Array(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const source = transformPoint(destinationToSource, { x: x + 0.5, y: y + 0.5 })
      const sourceX = Math.floor(source.x)
      const sourceY = Math.floor(source.y)
      if (sourceX < 0 || sourceX >= sourceWidth || sourceY < 0 || sourceY >= sourceHeight) continue
      output[y * outputWidth + x] = sourceMask[sourceY * sourceWidth + sourceX]
    }
  }
  return output
}

function warpMaskWithDestinationToSource(sourceMask, sourceWidth, sourceHeight, destinationToSource, outputWidth, outputHeight) {
  const output = new Uint8Array(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const source = transformPoint(destinationToSource, { x: x + 0.5, y: y + 0.5 })
      const sourceX = Math.floor(source.x)
      const sourceY = Math.floor(source.y)
      if (sourceX < 0 || sourceX >= sourceWidth || sourceY < 0 || sourceY >= sourceHeight) continue
      output[y * outputWidth + x] = sourceMask[sourceY * sourceWidth + sourceX]
    }
  }
  return output
}

function cropMask(mask, width, height) {
  const { bounds } = boundsForMask(mask, width, height)
  const left = Math.max(0, bounds.minX - OUTPUT_PADDING)
  const top = Math.max(0, bounds.minY - OUTPUT_PADDING)
  const right = Math.min(width - 1, bounds.maxX + OUTPUT_PADDING)
  const bottom = Math.min(height - 1, bounds.maxY + OUTPUT_PADDING)
  const outputWidth = right - left + 1
  const outputHeight = bottom - top + 1
  const alpha = Buffer.alloc(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceStart = (top + y) * width + left
    for (let x = 0; x < outputWidth; x += 1) alpha[y * outputWidth + x] = mask[sourceStart + x] ? 255 : 0
  }
  return { alpha, width: outputWidth, height: outputHeight, crop: { left, top, width: outputWidth, height: outputHeight } }
}

function identifyRectifiedOpenings(mask, width, height) {
  const body = boundsForMask(mask, width, height)
  const components = findInternalComponents(mask, width, height)
    .filter((component) => component.pixels >= 50)
    .map((component) => normalizedComponent(component, body.bounds))
  assert(components.length === 4, `Expected four rectified openings, found ${components.length}`)
  const byVerticalPosition = [...components].sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX)
  const upperCamera = byVerticalPosition[0]
  const flash = byVerticalPosition[1].centerX > byVerticalPosition[2].centerX
    ? byVerticalPosition[1]
    : byVerticalPosition[2]
  const cameraCandidates = components
    .filter((component) => component !== upperCamera && component !== flash)
    .sort((left, right) => left.centerY - right.centerY)
  const openings = [
    { ...upperCamera, openingId: 'upper-camera' },
    { ...cameraCandidates[0], openingId: 'middle-camera' },
    { ...cameraCandidates[1], openingId: 'lower-camera' },
    { ...flash, openingId: 'flash' },
  ]
  for (const opening of openings) {
    const horizontalRange = opening.openingId === 'flash' ? [0.25, 0.45] : [0.08, 0.28]
    assert(inRange(opening.centerX, horizontalRange), `${opening.openingId}: horizontal position changed`)
    assert(opening.centerY >= 0.05 && opening.centerY <= 0.28, `${opening.openingId}: vertical position changed`)
  }
  return openings
}

async function encodeCandidate(modelId, finish, alpha, width, height, outputDir) {
  const alphaRaw = { raw: { width, height, channels: 1 } }
  const { data: edgeAlpha, info: edgeInfo } = await sharp(alpha, alphaRaw)
    .blur(EDGE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { bounds } = boundsForMask(alpha, width, height)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const halfWidth = Math.max(1, (bounds.maxX - bounds.minX) / 2)
  const halfHeight = Math.max(1, (bounds.maxY - bounds.minY) / 2)
  const rgba = Buffer.alloc(width * height * 4)
  for (let index = 0; index < alpha.length; index += 1) {
    if (!alpha[index]) continue
    const x = index % width
    const y = Math.floor(index / width)
    const edgeProximity = 1 - edgeAlpha[index * edgeInfo.channels] / 255
    const horizontalLight = 1 - Math.min(1, Math.abs(x - centerX) / halfWidth)
    const verticalLight = 1 - Math.min(1, Math.abs(y - centerY) / halfHeight)
    const neutral = finish === 'black'
      ? Math.round(30 + horizontalLight * 12 + verticalLight * 6 + edgeProximity * 18)
      : Math.round(235 + horizontalLight * 12 + verticalLight * 6)
    const offset = index * 4
    rgba[offset] = neutral
    rgba[offset + 1] = neutral
    rgba[offset + 2] = neutral
    rgba[offset + 3] = alpha[index]
  }
  const outputBuffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const { data: decoded, info } = await sharp(outputBuffer).raw().toBuffer({ resolveWithObject: true })
  const decodedAlpha = Buffer.alloc(width * height)
  let hiddenRgbPixels = 0
  let maximumChannelSpread = 0
  for (let source = 0, target = 0; source < decoded.length; source += 4, target += 1) {
    decodedAlpha[target] = decoded[source + 3]
    if (!decoded[source + 3] && (decoded[source] || decoded[source + 1] || decoded[source + 2])) hiddenRgbPixels += 1
    maximumChannelSpread = Math.max(
      maximumChannelSpread,
      Math.max(decoded[source], decoded[source + 1], decoded[source + 2])
        - Math.min(decoded[source], decoded[source + 1], decoded[source + 2]),
    )
  }
  const cornerAlpha = [decodedAlpha[0], decodedAlpha[width - 1], decodedAlpha[(height - 1) * width], decodedAlpha.at(-1)]
  const qa = {
    passed: info.width === width
      && info.height === height
      && info.channels === 4
      && decodedAlpha.equals(alpha)
      && hiddenRgbPixels === 0
      && maximumChannelSpread === 0
      && cornerAlpha.every((value) => value === 0),
    alphaExact: decodedAlpha.equals(alpha),
    hiddenRgbPixels,
    maximumChannelSpread,
    cornerAlpha,
  }
  assert(qa.passed, `${finish}: output QA failed ${JSON.stringify(qa)}`)
  const outputPath = path.join(outputDir, `${modelId}-${finish}-v1-tauri-real-video-alpha-matte.png`)
  await writeFile(outputPath, outputBuffer)
  return {
    finish,
    outputPath,
    outputEncodedSha256: sha256(outputBuffer),
    outputPixelSha256: sha256(decoded),
    outputAlphaSha256: sha256(decodedAlpha),
    bounds: boundsForMask(decodedAlpha, width, height).bounds,
    qa,
  }
}

async function deriveAsset(asset, outputDir) {
  const sourceBytes = await readFile(asset.path)
  assert(sha256(sourceBytes) === asset.encodedSha256, 'A15 source hash changed')
  const decoded = await sharp(sourceBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(sha256(decoded.data) === asset.decodedPixelSha256, 'A15 source pixel hash changed')
  assert(asset.openingFrame, 'A15 opening frame is missing')
  const openingFrameBytes = await readFile(asset.openingFrame.path)
  assert(sha256(openingFrameBytes) === asset.openingFrame.encodedSha256, 'A15 opening frame hash changed')
  const openingDecoded = await sharp(openingFrameBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(sha256(openingDecoded.data) === asset.openingFrame.decodedPixelSha256, 'A15 opening frame pixel hash changed')
  const segmentation = asset.segmentation
  const openingSegmentation = asset.openingFrameSegmentation
  assert(segmentation.stabilityThresholds.includes(segmentation.primaryThreshold), 'Primary threshold is outside stability thresholds')
  assert(openingSegmentation.stabilityThresholds.includes(openingSegmentation.primaryThreshold), 'Opening primary threshold is outside stability thresholds')
  assert(segmentation.stabilityThresholds.length === openingSegmentation.stabilityThresholds.length, 'Silhouette and opening threshold counts differ')
  const extracted = new Map(segmentation.stabilityThresholds.map((threshold) => [
    threshold,
    connectedDarkComponent(decoded.data, decoded.info, threshold, segmentation.seed),
  ]))
  const extractedOpenings = new Map(openingSegmentation.stabilityThresholds.map((threshold) => [
    threshold,
    extractBrightOpenings(openingDecoded.data, openingDecoded.info, threshold, openingSegmentation),
  ]))
  const primary = extracted.get(segmentation.primaryThreshold)
  const thresholdStability = segmentation.stabilityThresholds.map((threshold) => {
    const candidate = extracted.get(threshold)
    const iouWithPrimary = maskIou(primary.mask, candidate.mask)
    const drift = boundsDrift(primary.bounds, candidate.bounds)
    for (const [key, range] of Object.entries(segmentation.expectedBounds)) {
      assert(inRange(candidate.bounds[key], range), `${threshold}: ${key} changed to ${candidate.bounds[key]}`)
    }
    return { threshold, iouWithPrimary, boundsDriftFromPrimary: drift, bounds: candidate.bounds, pixels: candidate.pixels }
  })
  const minimumThresholdIou = Math.min(...thresholdStability.map((item) => item.iouWithPrimary))
  const maximumBoundsDrift = Math.max(...thresholdStability.map((item) => item.boundsDriftFromPrimary))
  assert(minimumThresholdIou >= segmentation.minimumThresholdIou, `Threshold IoU failed: ${minimumThresholdIou}`)
  assert(maximumBoundsDrift <= segmentation.maximumBoundsDrift, `Threshold bounds drift failed: ${maximumBoundsDrift}`)

  const openingThresholdStability = []
  let minimumOpeningThresholdIou = 1
  let maximumOpeningBoundsDrift = 0
  for (const profile of openingSegmentation.openings) {
    for (let leftIndex = 0; leftIndex < openingSegmentation.stabilityThresholds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < openingSegmentation.stabilityThresholds.length; rightIndex += 1) {
        const leftThreshold = openingSegmentation.stabilityThresholds[leftIndex]
        const rightThreshold = openingSegmentation.stabilityThresholds[rightIndex]
        const left = extractedOpenings.get(leftThreshold).openings.find((opening) => opening.openingId === profile.id)
        const right = extractedOpenings.get(rightThreshold).openings.find((opening) => opening.openingId === profile.id)
        const iou = maskIou(left.mask, right.mask)
        const drift = boundsDrift(left.bounds, right.bounds)
        minimumOpeningThresholdIou = Math.min(minimumOpeningThresholdIou, iou)
        maximumOpeningBoundsDrift = Math.max(maximumOpeningBoundsDrift, drift)
        openingThresholdStability.push({
          openingId: profile.id,
          thresholds: [leftThreshold, rightThreshold],
          iou,
          boundsDrift: drift,
        })
      }
    }
  }
  assert(minimumOpeningThresholdIou >= openingSegmentation.minimumThresholdIou, `Opening threshold IoU failed: ${minimumOpeningThresholdIou}`)
  assert(maximumOpeningBoundsDrift <= openingSegmentation.maximumBoundsDrift, `Opening bounds drift failed: ${maximumOpeningBoundsDrift}`)

  const cleaned = Uint8Array.from(primary.mask)
  const sourceHoleCleanup = cleanInternalArtifacts(
    cleaned,
    decoded.info.width,
    decoded.info.height,
    primary.bounds,
    segmentation.openings,
  )
  const outerLines = fitOuterLines(cleaned, decoded.info.width, decoded.info.height, primary.bounds)
  for (const [edge, fit] of Object.entries(outerLines)) assert(fit.rms <= 2.5, `${edge} edge fit is unstable: ${fit.rms}`)
  const sourceCorners = [
    intersectSideAndEdge(outerLines.left, outerLines.top),
    intersectSideAndEdge(outerLines.right, outerLines.top),
    intersectSideAndEdge(outerLines.right, outerLines.bottom),
    intersectSideAndEdge(outerLines.left, outerLines.bottom),
  ]
  const unitCorners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  const sourceToUnit = homography(sourceCorners, unitCorners)
  const componentsByIndex = new Map(sourceHoleCleanup.components.map((component) => [component.componentIndex, component]))
  const alignmentOpeningIds = ['middle-camera', 'lower-camera', 'flash']
  const sourceAlignmentPoints = alignmentOpeningIds.map((openingId) => {
    const opening = sourceHoleCleanup.matches.find((candidate) => candidate.openingId === openingId)
    const component = componentsByIndex.get(opening.componentIndex)
    return transformPoint(sourceToUnit, componentCentroid(component, decoded.info.width))
  })
  const primaryOpeningFrame = extractedOpenings.get(openingSegmentation.primaryThreshold)
  const openingFrameAlignmentPoints = alignmentOpeningIds.map((openingId) => (
    primaryOpeningFrame.openings.find((opening) => opening.openingId === openingId).centroid
  ))
  const openingFrameToUnit = affineTransform(openingFrameAlignmentPoints, sourceAlignmentPoints)
  const calibrationOpenings = primaryOpeningFrame.openings
    .filter((opening) => ['middle-camera', 'lower-camera'].includes(opening.openingId))
    .map((opening) => {
      const bounds = transformedComponentBounds(opening, openingFrameToUnit, openingDecoded.info.width)
      const normalizedWidth = bounds.maxX - bounds.minX
      const normalizedHeight = bounds.maxY - bounds.minY
      return {
        openingId: opening.openingId,
        normalizedBounds: bounds,
        targetAspectForCircle: normalizedHeight / normalizedWidth,
      }
    })
  assert(calibrationOpenings.length === 2, 'Expected two circular calibration openings')
  const circleCalibratedBodyAspect = calibrationOpenings.reduce((sum, opening) => sum + opening.targetAspectForCircle, 0)
    / calibrationOpenings.length
  const officialDimension = asset.officialDimensionEvidence[0]
  const officialDeviceAspect = Number(officialDimension.reportedValue.split('x')[1].trim())
    / Number(officialDimension.reportedValue.split('x')[0].trim())
  const targetBodyAspect = Math.max(circleCalibratedBodyAspect, officialDeviceAspect)
  assert(
    targetBodyAspect >= officialDeviceAspect && targetBodyAspect <= officialDeviceAspect + 0.055,
    `Rectified body aspect is implausible: ${JSON.stringify({ targetBodyAspect, circleCalibratedBodyAspect, officialDeviceAspect, sourceCorners, outerLines, calibrationOpenings })}`,
  )

  const targetBodyHeight = primary.bounds.maxY - primary.bounds.minY + 1
  const targetBodyWidth = Math.round(targetBodyHeight * targetBodyAspect)
  assert(targetBodyWidth >= 320 && targetBodyWidth <= 370, `Rectified body width is implausible: ${targetBodyWidth}`)
  const rectificationPadding = OUTPUT_PADDING
  const rectifiedWidth = targetBodyWidth + rectificationPadding * 2
  const rectifiedHeight = targetBodyHeight + rectificationPadding * 2
  const rectifiedCorners = [
    { x: rectificationPadding, y: rectificationPadding },
    { x: rectificationPadding + targetBodyWidth - 1, y: rectificationPadding },
    { x: rectificationPadding + targetBodyWidth - 1, y: rectificationPadding + targetBodyHeight - 1 },
    { x: rectificationPadding, y: rectificationPadding + targetBodyHeight - 1 },
  ]
  const targetAlignmentPoints = sourceAlignmentPoints.map((point) => ({
    x: rectificationPadding + point.x * (targetBodyWidth - 1),
    y: rectificationPadding + point.y * (targetBodyHeight - 1),
  }))
  const targetToOpeningFrame = affineTransform(targetAlignmentPoints, openingFrameAlignmentPoints)
  const rectifiedMasks = new Map()
  const openingMappingQa = []
  for (let thresholdIndex = 0; thresholdIndex < segmentation.stabilityThresholds.length; thresholdIndex += 1) {
    const threshold = segmentation.stabilityThresholds[thresholdIndex]
    const openingThreshold = openingSegmentation.stabilityThresholds[thresholdIndex]
    const thresholdMask = Uint8Array.from(extracted.get(threshold).mask)
    const thresholdCleanup = cleanInternalArtifacts(
      thresholdMask,
      decoded.info.width,
      decoded.info.height,
      extracted.get(threshold).bounds,
      segmentation.openings,
    )
    const filledSourceOpenings = fillMatchedOpenings(thresholdMask, thresholdCleanup)
    const rectified = warpMask(
      thresholdMask,
      decoded.info.width,
      decoded.info.height,
      sourceCorners,
      rectifiedCorners,
      rectifiedWidth,
      rectifiedHeight,
    )
    const mappedOpenings = warpMaskWithDestinationToSource(
      extractedOpenings.get(openingThreshold).mask,
      openingDecoded.info.width,
      openingDecoded.info.height,
      targetToOpeningFrame,
      rectifiedWidth,
      rectifiedHeight,
    )
    let mappedOpeningPixels = 0
    let mappedOutsideBodyPixels = 0
    for (let index = 0; index < rectified.length; index += 1) {
      if (!mappedOpenings[index]) continue
      mappedOpeningPixels += 1
      if (!rectified[index]) mappedOutsideBodyPixels += 1
      rectified[index] = 0
    }
    assert(mappedOpeningPixels > 1000, `${openingThreshold}: mapped openings are empty`)
    assert(mappedOutsideBodyPixels === 0, `${openingThreshold}: ${mappedOutsideBodyPixels} opening pixels mapped outside the body`)
    openingMappingQa.push({ threshold, openingThreshold, filledSourceOpenings, mappedOpeningPixels, mappedOutsideBodyPixels })
    rectifiedMasks.set(threshold, rectified)
  }
  const rectifiedPrimary = rectifiedMasks.get(segmentation.primaryThreshold)
  const rectifiedStability = segmentation.stabilityThresholds.map((threshold) => ({
    threshold,
    iouWithPrimary: maskIou(rectifiedPrimary, rectifiedMasks.get(threshold)),
    boundsDriftFromPrimary: boundsDrift(
      boundsForMask(rectifiedPrimary, rectifiedWidth, rectifiedHeight).bounds,
      boundsForMask(rectifiedMasks.get(threshold), rectifiedWidth, rectifiedHeight).bounds,
    ),
  }))
  const minimumRectifiedIou = Math.min(...rectifiedStability.map((item) => item.iouWithPrimary))
  const maximumRectifiedBoundsDrift = Math.max(...rectifiedStability.map((item) => item.boundsDriftFromPrimary))
  assert(minimumRectifiedIou >= segmentation.minimumThresholdIou, `Rectified threshold IoU failed: ${minimumRectifiedIou}`)
  assert(maximumRectifiedBoundsDrift <= segmentation.maximumBoundsDrift, 'Rectified threshold bounds drift failed')

  const rectifiedOpenings = identifyRectifiedOpenings(rectifiedPrimary, rectifiedWidth, rectifiedHeight)
  const circularOpenings = rectifiedOpenings.filter((opening) => ['middle-camera', 'lower-camera'].includes(opening.openingId))
  for (const opening of circularOpenings) assert(opening.aspect >= 0.96 && opening.aspect <= 1.04, `${opening.openingId} is not circular after rectification: ${opening.aspect}`)
  const cropped = cropMask(rectifiedPrimary, rectifiedWidth, rectifiedHeight)
  const alpha = boundsForMask(cropped.alpha, cropped.width, cropped.height)
  await mkdir(outputDir, { recursive: true })
  const candidates = []
  for (const finish of FINISHES) {
    candidates.push(await encodeCandidate(asset.targetModelId, finish, cropped.alpha, cropped.width, cropped.height, outputDir))
  }
  assert(new Set(candidates.map((candidate) => candidate.outputAlphaSha256)).size === 1, 'Black and White alpha differs')
  return {
    modelId: asset.targetModelId,
    modelName: asset.targetModelName,
    sourceModelId: asset.sourceModelId,
    sourceKind: asset.derivedSourceKind,
    sourceAsset: {
      path: asset.path,
      sourceUrl: asset.sourceUrl,
      productRecordUrl: asset.productRecordUrl,
      asin: asset.productRecord.asin,
      productTitle: asset.productRecord.title,
      encodedSha256: asset.encodedSha256,
      decodedPixelSha256: asset.decodedPixelSha256,
      frameTimestampSeconds: asset.hlsEvidence.frame.timestampSeconds,
      geometryUse: 'complete physical silhouette only',
    },
    openingSourceAsset: {
      path: asset.openingFrame.path,
      sourceUrl: asset.sourceUrl,
      encodedSha256: asset.openingFrame.encodedSha256,
      decodedPixelSha256: asset.openingFrame.decodedPixelSha256,
      frameTimestampSeconds: asset.hlsEvidence.openingFrame.timestampSeconds,
      geometryUse: asset.openingFrame.geometryUse,
    },
    sourceGeometry: {
      method: segmentation.method,
      seed: segmentation.seed,
      primaryThreshold: segmentation.primaryThreshold,
      stabilityThresholds: segmentation.stabilityThresholds,
      minimumThresholdIou,
      requiredMinimumThresholdIou: segmentation.minimumThresholdIou,
      maximumBoundsDrift,
      allowedMaximumBoundsDrift: segmentation.maximumBoundsDrift,
      thresholdStability,
      primaryBounds: primary.bounds,
      primaryPixels: primary.pixels,
    },
    openingFrameGeometry: {
      method: openingSegmentation.method,
      comparison: openingSegmentation.comparison,
      primaryThreshold: openingSegmentation.primaryThreshold,
      stabilityThresholds: openingSegmentation.stabilityThresholds,
      minimumThresholdIou: minimumOpeningThresholdIou,
      requiredMinimumThresholdIou: openingSegmentation.minimumThresholdIou,
      maximumBoundsDrift: maximumOpeningBoundsDrift,
      allowedMaximumBoundsDrift: openingSegmentation.maximumBoundsDrift,
      thresholdStability: openingThresholdStability,
      primaryOpenings: primaryOpeningFrame.openings.map((opening) => ({
        openingId: opening.openingId,
        pixels: opening.pixels,
        bounds: opening.bounds,
        centroid: opening.centroid,
      })),
    },
    rectification: {
      kind: 'projective-silhouette-rectification-plus-local-affine-registration-of-four-observed-openings-and-horizontal-scale-calibration-from-two-observed-circular-camera-openings',
      sourceCorners,
      outerLineFits: outerLines,
      calibrationOpenings,
      circleCalibratedBodyAspect,
      targetBodyAspect,
      officialDeviceAspect,
      targetBodyWidth,
      targetBodyHeight,
      rectificationPadding,
      rectifiedWidth,
      rectifiedHeight,
      rectifiedCorners,
      openingAlignment: {
        openingIds: alignmentOpeningIds,
        openingFramePoints: openingFrameAlignmentPoints,
        targetUnitPoints: sourceAlignmentPoints,
        openingFrameToUnit,
        targetToOpeningFrame,
      },
      openingMappingQa,
      minimumThresholdIou: minimumRectifiedIou,
      maximumBoundsDrift: maximumRectifiedBoundsDrift,
      thresholdStability: rectifiedStability,
      silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
      spatialTransform: 'projective transform with pixel-center nearest-neighbor sampling for the directly segmented silhouette and one three-correspondence local affine transform for the four directly segmented opening masks; no boundary or opening is synthesized',
    },
    transform: {
      kind: 'dual-real-video-frame-segmentation-projective-silhouette-rectification-local-affine-opening-registration-and-alpha-only-neutral-matte-relighting',
      geometrySource: asset.geometrySource,
      crop: cropped.crop,
      sourceRgbUsed: false,
      fullyTransparentRgb: 'zeroed',
      edgeBlurSigmaForRgbLightingOnly: EDGE_BLUR_SIGMA,
      filledCompressionArtifactComponents: sourceHoleCleanup.filledComponents,
      filledCompressionArtifactPixels: sourceHoleCleanup.filledPixels,
      shadowAffectedSourceOpeningsReplaced: sourceHoleCleanup.matches.length,
      inferredOpeningPixels: 0,
    },
    alpha: {
      sha256: sha256(cropped.alpha),
      width: cropped.width,
      height: cropped.height,
      bounds: alpha.bounds,
      pixels: alpha.pixels,
      significantOpenings: rectifiedOpenings,
      expectedOpeningCount: 4,
      openingQaPassed: true,
    },
    candidates,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const provenance = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(provenance.assets?.length === 1, 'Expected one A15 source asset')
  assert(provenance.assets[0].publicationEligible, 'A15 source is not publication-eligible')
  const result = await deriveAsset(provenance.assets[0], outputDir)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: provenance.source,
    summary: {
      models: 1,
      candidates: result.candidates.length,
      sourceThresholdStabilityPassed: result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou ? 1 : 0,
      openingFrameThresholdStabilityPassed: result.openingFrameGeometry.minimumThresholdIou >= result.openingFrameGeometry.requiredMinimumThresholdIou ? 1 : 0,
      rectifiedThresholdStabilityPassed: result.rectification.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou ? 1 : 0,
      exactOpeningTopologyPassed: result.alpha.openingQaPassed && result.alpha.significantOpenings.length === 4 ? 1 : 0,
      circularCalibrationPassed: result.alpha.significantOpenings.filter((opening) => (
        ['middle-camera', 'lower-camera'].includes(opening.openingId)
        && opening.aspect >= 0.96
        && opening.aspect <= 1.04
      )).length === 2 ? 1 : 0,
      exactPairAlpha: new Set(result.candidates.map((candidate) => candidate.outputAlphaSha256)).size === 1 ? 1 : 0,
      automatedQaPassed: result.candidates.filter((candidate) => candidate.qa.passed).length,
    },
    results: [result],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()