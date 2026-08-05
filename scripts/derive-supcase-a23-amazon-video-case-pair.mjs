#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/supcase-a23-amazon-video-case-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REVIEW_DIR = 'reference/case-history/generated/all-phone-real-image-completion/reviews'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/supcase-a23-amazon-video-case-derived-provenance.json'
const PRIMARY_THRESHOLD = 120
const STABILITY_THRESHOLDS = [118, 119, 120, 121, 122]
const MINIMUM_THRESHOLD_IOU = 0.995
const MAXIMUM_BOUNDS_DRIFT = 4
const OUTPUT_PADDING = 96
const FINAL_OUTPUT_PADDING = 16
const EDGE_BLUR_SIGMA_FOR_LIGHTING = 6
const FINISHES = ['black', 'white']
const RECTIFICATION_PIXEL_PHASE = 0.5
const SOURCE_ROI = { left: 92, top: 700, width: 915, height: 785 }
const EDGE_BLUR_SIGMA = 2
const EDGE_SAMPLE_DISTANCE = 2
const EDGE_THRESHOLDS = [1.5, 1.625, 1.75]
const PRIMARY_EDGE_THRESHOLD = 1.625
const EDGE_SEARCH_RADIUS = 24
const EDGE_MAX_OFFSET_STEP = 8
const EDGE_TRANSITION_PENALTY = 4
const EDGE_GUIDE_PENALTY = 0.5
const OUTER_GUIDE = [
  [232, 49], [250, 51], [272, 60], [300, 77], [360, 112], [420, 148],
  [480, 184], [540, 220], [600, 256], [660, 292], [720, 328], [780, 364],
  [825, 391], [850, 411], [866, 438], [869, 462], [862, 487], [848, 516],
  [834, 545], [819, 575], [804, 605], [789, 635], [773, 665], [756, 694],
  [736, 716], [708, 730], [675, 733], [640, 721], [590, 695], [540, 667],
  [490, 639], [440, 611], [390, 583], [345, 556], [300, 528], [255, 501],
  [210, 476], [165, 451], [125, 431], [90, 411], [62, 386], [50, 358],
  [49, 330], [55, 300], [68, 270], [84, 240], [101, 210], [118, 180],
  [136, 150], [154, 120], [171, 92], [190, 68], [210, 55],
].map(([x, y]) => ({ x, y }))
const OPENING_GUIDE = [
  [117, 282], [140, 270], [170, 270], [200, 280], [230, 300], [255, 322],
  [276, 345], [286, 370], [284, 392], [270, 410], [250, 420], [225, 422],
  [200, 414], [175, 402], [150, 386], [130, 368], [115, 347], [108, 325],
  [109, 303],
].map(([x, y]) => ({ x, y }))
const PHYSICAL_EDGE_FIT_GUIDES = {
  top: { start: { x: 96, y: 277 }, end: { x: 218, y: 95 }, corridor: 24 },
  right: { start: { x: 300, y: 77 }, end: { x: 825, y: 391 }, corridor: 12 },
  bottom: { start: { x: 790, y: 635 }, end: { x: 755, y: 695 }, corridor: 8 },
  left: { start: { x: 440, y: 620 }, end: { x: 640, y: 722 }, corridor: 12 },
}
const OFFICIAL_WIDTH_MM = 76.9
const OFFICIAL_HEIGHT_MM = 165.4
const EDGE_GUIDES = {
  top: { start: { x: 188, y: 977 }, end: { x: 310, y: 795 }, corridor: 24 },
  right: { start: { x: 420, y: 786 }, end: { x: 895, y: 1080 }, corridor: 18 },
  bottom: { start: { x: 930, y: 1185 }, end: { x: 832, y: 1380 }, corridor: 24 },
  left: { start: { x: 745, y: 1400 }, end: { x: 245, y: 1100 }, corridor: 18 },
}
const DIRECT_FRAME_PROFILE = {
  seed: { x: 650, y: 1100 },
  primaryThreshold: PRIMARY_THRESHOLD,
  stabilityThresholds: STABILITY_THRESHOLDS,
  minimumThresholdIou: MINIMUM_THRESHOLD_IOU,
  maximumBoundsDrift: MAXIMUM_BOUNDS_DRIFT,
  expectedBounds: { minX: [140, 140], minY: [748, 748], maxX: [958, 958], maxY: [1436, 1436] },
  expectedForegroundPixels: [279827, 281148],
  expectedSignificantInternalComponents: 1,
  minimumSignificantInternalPixels: 10000,
  cameraOpening: {
    primaryPixels: 15973,
    expectedPixels: [15828, 16204],
    expectedBounds: { minX: [200, 200], minY: [964, 964], maxX: [379, 381], maxY: [1121, 1121] },
  },
  morphologyOperations: 0,
  inferredBoundaryPixels: 0,
  inferredOpeningPixels: 0,
}

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

function inRange(value, range) {
  return value >= range[0] && value <= range[1]
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
  return mask
}

function findInternalComponents(mask, width, height) {
  const pixelCount = width * height
  const exterior = new Uint8Array(pixelCount)
  const visited = new Uint8Array(pixelCount)
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
      pixels: tail,
      bounds,
      indices: Int32Array.from(queue.subarray(0, tail)),
    })
  }
  return components.sort((left, right) => right.pixels - left.pixels)
}

function cleanSurfaceArtifacts(mask, width, height, profile, threshold) {
  const components = findInternalComponents(mask, width, height)
  const significant = components.filter((component) => component.pixels >= profile.minimumSignificantInternalPixels)
  assert(
    significant.length === profile.expectedSignificantInternalComponents,
    `${threshold}: expected ${profile.expectedSignificantInternalComponents} significant internal component, found ${significant.length}: ${JSON.stringify(significant.map(({ pixels, bounds }) => ({ pixels, bounds })))}`,
  )
  const cameraOpening = significant[0]
  assert(inRange(cameraOpening.pixels, profile.cameraOpening.expectedPixels), `${threshold}: camera opening pixels changed to ${cameraOpening.pixels}`)
  for (const [key, range] of Object.entries(profile.cameraOpening.expectedBounds)) {
    assert(inRange(cameraOpening.bounds[key], range), `${threshold}: camera opening ${key} changed to ${cameraOpening.bounds[key]}`)
  }
  let filledComponents = 0
  let filledPixels = 0
  for (const component of components) {
    if (component === cameraOpening) continue
    assert(component.pixels < profile.minimumSignificantInternalPixels, `${threshold}: refusing to fill unexpected significant component`)
    for (const index of component.indices) mask[index] = 1
    filledComponents += 1
    filledPixels += component.pixels
  }
  return {
    cameraOpening: { pixels: cameraOpening.pixels, bounds: cameraOpening.bounds },
    filledComponents,
    filledPixels,
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

function bilinearSample(data, width, height, x, y) {
  const clampedX = Math.max(0, Math.min(width - 1.001, x))
  const clampedY = Math.max(0, Math.min(height - 1.001, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fractionX = clampedX - x0
  const fractionY = clampedY - y0
  const top = data[y0 * width + x0] * (1 - fractionX) + data[y0 * width + x1] * fractionX
  const bottom = data[y1 * width + x0] * (1 - fractionX) + data[y1 * width + x1] * fractionX
  return top * (1 - fractionY) + bottom * fractionY
}

function densifyPolygon(guide) {
  const points = []
  for (let index = 0; index < guide.length; index += 1) {
    const start = guide[index]
    const end = guide[(index + 1) % guide.length]
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    const steps = Math.max(1, Math.ceil(distance))
    for (let step = 0; step < steps; step += 1) {
      const amount = step / steps
      points.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      })
    }
  }
  return points
}

function contourCandidates(gray, width, height, guide, threshold, insideBrighter) {
  const guidePoints = densifyPolygon(guide)
  const stateCount = EDGE_SEARCH_RADIUS * 2 + 1
  const candidates = new Array(guidePoints.length)
  for (let index = 0; index < guidePoints.length; index += 1) {
    const previous = guidePoints[(index - 1 + guidePoints.length) % guidePoints.length]
    const next = guidePoints[(index + 1) % guidePoints.length]
    const tangentX = next.x - previous.x
    const tangentY = next.y - previous.y
    const tangentLength = Math.hypot(tangentX, tangentY)
    const normal = { x: -tangentY / tangentLength, y: tangentX / tangentLength }
    candidates[index] = new Array(stateCount)
    for (let state = 0; state < stateCount; state += 1) {
      const offset = state - EDGE_SEARCH_RADIUS
      const point = {
        x: guidePoints[index].x + normal.x * offset,
        y: guidePoints[index].y + normal.y * offset,
      }
      const before = bilinearSample(
        gray,
        width,
        height,
        point.x - normal.x * EDGE_SAMPLE_DISTANCE,
        point.y - normal.y * EDGE_SAMPLE_DISTANCE,
      )
      const after = bilinearSample(
        gray,
        width,
        height,
        point.x + normal.x * EDGE_SAMPLE_DISTANCE,
        point.y + normal.y * EDGE_SAMPLE_DISTANCE,
      )
      const response = insideBrighter ? after - before : before - after
      candidates[index][state] = {
        point,
        offset,
        response,
        valid: response >= threshold,
        localScore: response - EDGE_GUIDE_PENALTY * offset ** 2,
      }
    }
  }
  return candidates
}

function traceContour(gray, width, height, guide, threshold, insideBrighter, id) {
  const candidates = contourCandidates(gray, width, height, guide, threshold, insideBrighter)
  const stateCount = EDGE_SEARCH_RADIUS * 2 + 1
  let best = null
  for (let startState = 0; startState < stateCount; startState += 1) {
    if (!candidates[0][startState].valid) continue
    let previousScores = new Float64Array(stateCount).fill(-Infinity)
    previousScores[startState] = candidates[0][startState].localScore
    const predecessors = new Array(candidates.length)
    predecessors[0] = new Int16Array(stateCount).fill(-1)
    for (let index = 1; index < candidates.length; index += 1) {
      const scores = new Float64Array(stateCount).fill(-Infinity)
      const row = new Int16Array(stateCount).fill(-1)
      for (let state = 0; state < stateCount; state += 1) {
        if (!candidates[index][state].valid) continue
        const minimumPrevious = Math.max(0, state - EDGE_MAX_OFFSET_STEP)
        const maximumPrevious = Math.min(stateCount - 1, state + EDGE_MAX_OFFSET_STEP)
        for (let previousState = minimumPrevious; previousState <= maximumPrevious; previousState += 1) {
          if (!Number.isFinite(previousScores[previousState])) continue
          const delta = state - previousState
          const score = previousScores[previousState]
            + candidates[index][state].localScore
            - EDGE_TRANSITION_PENALTY * delta ** 2
          if (score > scores[state]) {
            scores[state] = score
            row[state] = previousState
          }
        }
      }
      predecessors[index] = row
      previousScores = scores
    }
    for (let endState = 0; endState < stateCount; endState += 1) {
      if (!Number.isFinite(previousScores[endState])) continue
      const closureDelta = endState - startState
      if (Math.abs(closureDelta) > EDGE_MAX_OFFSET_STEP) continue
      const score = previousScores[endState] - EDGE_TRANSITION_PENALTY * closureDelta ** 2
      if (best && score <= best.score) continue
      const states = new Int16Array(candidates.length)
      states[candidates.length - 1] = endState
      for (let index = candidates.length - 1; index > 0; index -= 1) {
        states[index - 1] = predecessors[index][states[index]]
        assert(states[index - 1] >= 0, `${id}: contour predecessor is missing`)
      }
      assert(states[0] === startState, `${id}: contour reconstruction changed start state`)
      best = { score, states }
    }
  }
  const weakestGuidePoint = candidates
    .map((row, index) => ({ index, maximumResponse: Math.max(...row.map((candidate) => candidate.response)) }))
    .sort((left, right) => left.maximumResponse - right.maximumResponse)[0]
  assert(best, `${id}: no closed physical-edge path at threshold ${threshold}; weakest guide point ${JSON.stringify(weakestGuidePoint)}`)
  const traced = candidates.map((row, index) => row[best.states[index]])
  const responses = traced.map((candidate) => candidate.response).sort((left, right) => left - right)
  const offsets = traced.map((candidate) => candidate.offset)
  const points = []
  for (const candidate of traced) {
    const point = { x: candidate.point.x, y: candidate.point.y }
    const previous = points.at(-1)
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.25) points.push(point)
  }
  return {
    id,
    threshold,
    points,
    diagnostics: {
      guidePoints: candidates.length,
      tracedPoints: points.length,
      minimumGradientResponse: responses[0],
      medianGradientResponse: responses[Math.floor(responses.length / 2)],
      maximumGradientResponse: responses.at(-1),
      minimumOffset: Math.min(...offsets),
      maximumOffset: Math.max(...offsets),
      gradientDirection: insideBrighter ? 'darker-shell-to-brighter-opening' : 'brighter-background-to-darker-shell',
      closedPathScore: best.score,
    },
  }
}

function rasterizePolygon(mask, width, height, points, value) {
  for (let y = 0; y < height; y += 1) {
    const scanY = y + 0.5
    const intersections = []
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      const end = points[(index + 1) % points.length]
      if ((start.y > scanY) === (end.y > scanY)) continue
      intersections.push(start.x + ((scanY - start.y) * (end.x - start.x)) / (end.y - start.y))
    }
    intersections.sort((left, right) => left - right)
    assert(intersections.length % 2 === 0, `Odd A23 contour intersection count at row ${y}`)
    for (let index = 0; index < intersections.length; index += 2) {
      const minimumX = Math.max(0, Math.ceil(intersections[index] - 0.5))
      const maximumX = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5))
      for (let x = minimumX; x <= maximumX; x += 1) mask[y * width + x] = value
    }
  }
}

function outerBoundaryPoints(mask, width, height) {
  const pixelCount = width * height
  const exterior = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0
  const enqueue = (index) => {
    if (index < 0 || index >= pixelCount || mask[index] || exterior[index]) return
    exterior[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    enqueue(x > 0 ? index - 1 : -1)
    enqueue(x + 1 < width ? index + 1 : -1)
    enqueue(index >= width ? index - width : -1)
    enqueue(index + width < pixelCount ? index + width : -1)
  }
  const points = []
  for (let index = 0; index < pixelCount; index += 1) {
    if (!mask[index]) continue
    const x = index % width
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      index >= width ? index - width : -1,
      index + width < pixelCount ? index + width : -1,
    ]
    if (neighbors.some((neighbor) => neighbor >= 0 && exterior[neighbor])) {
      points.push({ x, y: Math.floor(index / width) })
    }
  }
  assert(points.length > 1000, `Outer boundary is unexpectedly short: ${points.length}`)
  return points
}

function pointsNearGuide(points, guide) {
  const deltaX = guide.end.x - guide.start.x
  const deltaY = guide.end.y - guide.start.y
  const lengthSquared = deltaX ** 2 + deltaY ** 2
  const length = Math.sqrt(lengthSquared)
  return points.filter((point) => {
    const relativeX = point.x - guide.start.x
    const relativeY = point.y - guide.start.y
    const along = (relativeX * deltaX + relativeY * deltaY) / lengthSquared
    const distance = Math.abs(relativeX * deltaY - relativeY * deltaX) / length
    return along >= 0 && along <= 1 && distance <= guide.corridor
  })
}

function orthogonalLine(points) {
  assert(points.length >= 40, `Not enough observed physical-edge points: ${points.length}`)
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
  let xx = 0
  let xy = 0
  let yy = 0
  for (const point of points) {
    const x = point.x - center.x
    const y = point.y - center.y
    xx += x * x
    xy += x * y
    yy += y * y
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const normal = { x: -direction.y, y: direction.x }
  const constant = -(normal.x * center.x + normal.y * center.y)
  const residuals = points.map((point) => Math.abs(normal.x * point.x + normal.y * point.y + constant))
  const rms = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length)
  return { center, direction, normal, constant, residuals, rms }
}

function robustObservedLine(points) {
  let selected = points
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const fit = orthogonalLine(selected)
    const sorted = [...fit.residuals].sort((left, right) => left - right)
    const median = sorted[Math.floor(sorted.length / 2)]
    const limit = Math.max(1.25, median * 3)
    const filtered = selected.filter((point) => Math.abs(
      fit.normal.x * point.x + fit.normal.y * point.y + fit.constant,
    ) <= limit)
    if (filtered.length === selected.length || filtered.length < 40) break
    selected = filtered
  }
  const fit = orthogonalLine(selected)
  return {
    center: fit.center,
    direction: fit.direction,
    normal: fit.normal,
    constant: fit.constant,
    rms: fit.rms,
    points: selected.length,
    candidates: points.length,
  }
}

function fitLinesFromPoints(boundary, guides) {
  const lines = {}
  for (const [id, guide] of Object.entries(guides)) {
    const candidates = pointsNearGuide(boundary, guide)
    assert(candidates.length >= 40, `${id}: only ${candidates.length} traced physical-edge points entered the fit corridor`)
    lines[id] = robustObservedLine(candidates)
    assert(lines[id].rms <= 3, `${id} observed physical-edge fit is unstable: ${lines[id].rms}`)
  }
  return lines
}

function fitOuterLines(mask, width, height) {
  return fitLinesFromPoints(outerBoundaryPoints(mask, width, height), EDGE_GUIDES)
}

function segmentPhysicalEdges(gray, threshold) {
  const outer = traceContour(gray, SOURCE_ROI.width, SOURCE_ROI.height, OUTER_GUIDE, threshold, false, 'a23:outer')
  const opening = traceContour(gray, SOURCE_ROI.width, SOURCE_ROI.height, OPENING_GUIDE, threshold, true, 'a23:opening')
  const mask = new Uint8Array(SOURCE_ROI.width * SOURCE_ROI.height)
  rasterizePolygon(mask, SOURCE_ROI.width, SOURCE_ROI.height, outer.points, 1)
  const beforeOpening = boundsForMask(mask, SOURCE_ROI.width, SOURCE_ROI.height).pixels
  rasterizePolygon(mask, SOURCE_ROI.width, SOURCE_ROI.height, opening.points, 0)
  const body = boundsForMask(mask, SOURCE_ROI.width, SOURCE_ROI.height)
  const openingPixels = beforeOpening - body.pixels
  assert(inRange(openingPixels, [18000, 30000]), `${threshold}: traced A23 camera opening pixels changed to ${openingPixels}`)
  const internal = findInternalComponents(mask, SOURCE_ROI.width, SOURCE_ROI.height)
  assert(internal.length === 1, `${threshold}: traced A23 topology changed to ${internal.length} openings`)
  const outerLines = fitLinesFromPoints(outer.points, PHYSICAL_EDGE_FIT_GUIDES)
  const sourceCorners = sourceCornersForLines(outerLines)
  return {
    threshold,
    mask,
    bounds: body.bounds,
    pixels: body.pixels,
    openingPixels,
    outer,
    opening,
    outerLines,
    sourceCorners,
  }
}

function intersectLines(first, second) {
  const determinant = first.normal.x * second.normal.y - second.normal.x * first.normal.y
  assert(Math.abs(determinant) > 1e-6, 'Observed physical-edge fits are parallel')
  return {
    x: (first.normal.y * second.constant - second.normal.y * first.constant) / determinant,
    y: (second.normal.x * first.constant - first.normal.x * second.constant) / determinant,
  }
}

function sourceCornersForLines(lines) {
  return [
    intersectLines(lines.top, lines.left),
    intersectLines(lines.top, lines.right),
    intersectLines(lines.bottom, lines.right),
    intersectLines(lines.bottom, lines.left),
  ]
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length
  const rows = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    assert(Math.abs(rows[pivot][column]) > 1e-10, 'Singular A23 homography system')
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

function transformPoint(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  }
}

function forwardMappedMaskBounds(sourceMask, sourceWidth, sourceCorners, destinationCorners) {
  const sourceToDestination = homography(sourceCorners, destinationCorners)
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  let pixels = 0
  for (let index = 0; index < sourceMask.length; index += 1) {
    if (!sourceMask[index]) continue
    const destination = transformPoint(sourceToDestination, {
      x: index % sourceWidth + 0.5,
      y: Math.floor(index / sourceWidth) + 0.5,
    })
    assert(Number.isFinite(destination.x) && Number.isFinite(destination.y), 'A23 foreground crossed the projective horizon')
    bounds.minX = Math.min(bounds.minX, destination.x)
    bounds.minY = Math.min(bounds.minY, destination.y)
    bounds.maxX = Math.max(bounds.maxX, destination.x)
    bounds.maxY = Math.max(bounds.maxY, destination.y)
    pixels += 1
  }
  assert(pixels > 0, 'Cannot map an empty A23 foreground mask')
  return bounds
}

function warpMask(sourceMask, sourceWidth, sourceHeight, sourceCorners, destinationCorners, outputWidth, outputHeight) {
  const destinationToSource = homography(destinationCorners, sourceCorners)
  const mappedForegroundBounds = forwardMappedMaskBounds(sourceMask, sourceWidth, sourceCorners, destinationCorners)
  const startX = Math.max(0, Math.floor(mappedForegroundBounds.minX) - 2)
  const endX = Math.min(outputWidth - 1, Math.ceil(mappedForegroundBounds.maxX) + 2)
  const startY = Math.max(0, Math.floor(mappedForegroundBounds.minY) - 2)
  const endY = Math.min(outputHeight - 1, Math.ceil(mappedForegroundBounds.maxY) + 2)
  assert(startX > 0 && endX < outputWidth - 1 && startY > 0 && endY < outputHeight - 1, `A23 forward-mapped contour exceeds the rectification canvas: ${JSON.stringify(mappedForegroundBounds)}`)
  const output = new Uint8Array(outputWidth * outputHeight)
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const source = transformPoint(destinationToSource, { x: x + 0.5, y: y + 0.5 })
      const sourceX = Math.floor(source.x)
      const sourceY = Math.floor(source.y)
      if (sourceX < 0 || sourceX >= sourceWidth || sourceY < 0 || sourceY >= sourceHeight) continue
      output[y * outputWidth + x] = sourceMask[sourceY * sourceWidth + sourceX]
    }
  }
  return { mask: output, mappedForegroundBounds }
}

function sourceHeightForCorners(corners) {
  const left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y)
  const right = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y)
  return (left + right) / 2
}

function normalizedComponent(component, bodyBounds) {
  const bodyWidth = bodyBounds.maxX - bodyBounds.minX + 1
  const bodyHeight = bodyBounds.maxY - bodyBounds.minY + 1
  const width = component.bounds.maxX - component.bounds.minX + 1
  const height = component.bounds.maxY - component.bounds.minY + 1
  return {
    pixels: component.pixels,
    bounds: component.bounds,
    centerX: ((component.bounds.minX + component.bounds.maxX) / 2 - bodyBounds.minX) / bodyWidth,
    centerY: ((component.bounds.minY + component.bounds.maxY) / 2 - bodyBounds.minY) / bodyHeight,
    width: width / bodyWidth,
    height: height / bodyHeight,
    aspect: width / height,
  }
}

function cropMask(mask, width, height) {
  const { bounds } = boundsForMask(mask, width, height)
  const left = Math.max(0, bounds.minX - FINAL_OUTPUT_PADDING)
  const top = Math.max(0, bounds.minY - FINAL_OUTPUT_PADDING)
  const right = Math.min(width - 1, bounds.maxX + FINAL_OUTPUT_PADDING)
  const bottom = Math.min(height - 1, bounds.maxY + FINAL_OUTPUT_PADDING)
  const outputWidth = right - left + 1
  const outputHeight = bottom - top + 1
  const alpha = Buffer.alloc(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceStart = (top + y) * width + left
    for (let x = 0; x < outputWidth; x += 1) {
      alpha[y * outputWidth + x] = mask[sourceStart + x] ? 255 : 0
    }
  }
  const outputBounds = boundsForMask(alpha, outputWidth, outputHeight).bounds
  const margins = {
    left: outputBounds.minX,
    top: outputBounds.minY,
    right: outputWidth - 1 - outputBounds.maxX,
    bottom: outputHeight - 1 - outputBounds.maxY,
  }
  assert(Object.values(margins).every((margin) => margin === FINAL_OUTPUT_PADDING), `A23 output margins changed: ${JSON.stringify(margins)}`)
  return {
    alpha,
    width: outputWidth,
    height: outputHeight,
    crop: { left, top, width: outputWidth, height: outputHeight },
    margins,
  }
}

async function encodeCandidate(modelId, finish, alpha, width, height, outputDir) {
  const alphaRaw = { raw: { width, height, channels: 1 } }
  const { data: edgeAlpha, info: edgeInfo } = await sharp(alpha, alphaRaw)
    .blur(EDGE_BLUR_SIGMA_FOR_LIGHTING)
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
  let nonBinaryAlphaPixels = 0
  for (let source = 0, target = 0; source < decoded.length; source += 4, target += 1) {
    const pixelAlpha = decoded[source + 3]
    decodedAlpha[target] = pixelAlpha
    if (pixelAlpha !== 0 && pixelAlpha !== 255) nonBinaryAlphaPixels += 1
    if (!pixelAlpha && (decoded[source] || decoded[source + 1] || decoded[source + 2])) hiddenRgbPixels += 1
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
      && nonBinaryAlphaPixels === 0
      && cornerAlpha.every((value) => value === 0),
    alphaExact: decodedAlpha.equals(alpha),
    hiddenRgbPixels,
    maximumChannelSpread,
    nonBinaryAlphaPixels,
    cornerAlpha,
  }
  assert(qa.passed, `${finish}: A23 output QA failed ${JSON.stringify(qa)}`)
  const outputPath = path.join(outputDir, `${modelId}-${finish}-v1-supcase-real-video-alpha-matte.png`)
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

function paintPixel(overlay, width, height, x, y, colour, radius = 0) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const targetX = x + offsetX
      const targetY = y + offsetY
      if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue
      const offset = (targetY * width + targetX) * 4
      overlay[offset] = colour[0]
      overlay[offset + 1] = colour[1]
      overlay[offset + 2] = colour[2]
      overlay[offset + 3] = colour[3]
    }
  }
}

async function writeSourceReviewOverlay(sourceBytes, primary, reviewDir) {
  const width = SOURCE_ROI.width
  const height = SOURCE_ROI.height
  const outer = outerBoundaryPoints(primary.mask, width, height)
  const openings = findInternalComponents(primary.mask, width, height)
  assert(openings.length === 1, `Expected one source opening for A23 overlay, found ${openings.length}`)
  const opening = openings[0]
  const openingIndices = new Set(opening.indices)
  const overlay = Buffer.alloc(width * height * 4)
  for (let index = 0; index < primary.mask.length; index += 1) {
    if (!primary.mask[index]) continue
    const offset = index * 4
    overlay[offset] = 255
    overlay[offset + 1] = 32
    overlay[offset + 2] = 56
    overlay[offset + 3] = 38
  }
  for (const point of outer) paintPixel(overlay, width, height, point.x, point.y, [255, 32, 56, 255], 1)
  for (const index of opening.indices) {
    const x = index % width
    const y = Math.floor(index / width)
    const offset = index * 4
    overlay[offset] = 0
    overlay[offset + 1] = 108
    overlay[offset + 2] = 255
    overlay[offset + 3] = 32
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < width ? index + 1 : -1,
      index >= width ? index - width : -1,
      index + width < width * height ? index + width : -1,
    ]
    if (neighbors.some((neighbor) => neighbor >= 0 && !openingIndices.has(neighbor))) {
      paintPixel(overlay, width, height, x, y, [0, 108, 255, 255], 1)
    }
  }
  const outputBuffer = await sharp(sourceBytes)
    .extract(SOURCE_ROI)
    .composite([{ input: overlay, raw: { width, height, channels: 4 } }])
    .removeAlpha()
    .png()
    .toBuffer()
  const decoded = await sharp(outputBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const outputPath = path.join(reviewDir, 'galaxy-a23-4g-5g-supcase-real-video-physical-edge-overlay.png')
  await mkdir(reviewDir, { recursive: true })
  await writeFile(outputPath, outputBuffer)
  return {
    path: outputPath,
    sourceFramePath: primary.framePath,
    encodedSha256: sha256(outputBuffer),
    decodedPixelSha256: sha256(decoded.data),
    width: decoded.info.width,
    height: decoded.info.height,
    sourceCrop: SOURCE_ROI,
    outerEdgeColour: '#ff2038',
    openingEdgeColour: '#006cff',
    bodyFillOpacity: 38 / 255,
    geometryUse: 'visual review only; never sampled by candidate generation',
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reviewDir = argumentValue('--review-dir', DEFAULT_REVIEW_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const directFramePath = argumentValue('--frame', null)
  const provenance = directFramePath ? null : JSON.parse(await readFile(inputPath, 'utf8'))
  const asset = provenance?.assets?.[0]
  const framePath = directFramePath ?? asset?.path
  const profile = directFramePath ? DIRECT_FRAME_PROFILE : asset?.segmentation
  const seed = profile?.seed
  assert(framePath, 'A source frame path is required')
  assert(profile && seed, 'A segmentation profile and foreground seed are required')
  assert(profile.primaryThreshold === PRIMARY_THRESHOLD, 'A23 primary threshold changed')
  assert(JSON.stringify(profile.stabilityThresholds) === JSON.stringify(STABILITY_THRESHOLDS), 'A23 stability thresholds changed')
  assert(profile.morphologyOperations === 0, 'A23 morphology is forbidden')
  assert(profile.inferredBoundaryPixels === 0, 'A23 inferred boundary pixels are forbidden')
  assert(profile.inferredOpeningPixels === 0, 'A23 inferred opening pixels are forbidden')
  if (asset) {
    assert(asset.derivationEligible === true && asset.publicationEligible === false, 'A23 source must be derivation-eligible and review-blocked')
    assert(asset.amazonEvidence?.productPageFetchesVerified?.length === 2, 'A23 Amazon product evidence is incomplete')
    assert(asset.amazonEvidence?.videoPageFetchesVerified?.length === 2, 'A23 Amazon video attribution evidence is incomplete')
    assert(asset.hlsEvidence?.segments?.length === 10, 'A23 HLS segment evidence is incomplete')
    assert(asset.officialModelEvidence?.length === 2, 'A23 Samsung model evidence is incomplete')
  }
  const sourceBytes = await readFile(framePath)
  if (asset) assert(sha256(sourceBytes) === asset.encodedSha256, 'A23 source frame encoded hash changed')
  const { data, info } = await sharp(sourceBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (asset) assert(sha256(data) === asset.decodedPixelSha256, 'A23 source frame pixel hash changed')
  assert(info.width === 1080 && info.height === 1920 && info.channels === 3, 'A23 source frame dimensions changed')
  const qualificationSegmentations = profile.stabilityThresholds.map((threshold) => {
    const mask = connectedDarkComponent(data, info, threshold, seed)
    const cleanup = cleanSurfaceArtifacts(mask, info.width, info.height, profile, threshold)
    const geometry = boundsForMask(mask, info.width, info.height)
    for (const [key, range] of Object.entries(profile.expectedBounds)) {
      assert(inRange(geometry.bounds[key], range), `${threshold}: shell ${key} changed to ${geometry.bounds[key]}`)
    }
    assert(inRange(geometry.pixels, profile.expectedForegroundPixels), `${threshold}: shell pixels changed to ${geometry.pixels}`)
    const outerLines = fitOuterLines(mask, info.width, info.height)
    const sourceCorners = sourceCornersForLines(outerLines)
    return { threshold, mask, cleanup, outerLines, sourceCorners, framePath, ...geometry }
  })
  const qualificationPrimary = qualificationSegmentations.find((segmentation) => segmentation.threshold === profile.primaryThreshold)
  assert(qualificationPrimary.cleanup.cameraOpening.pixels === profile.cameraOpening.primaryPixels, `Primary camera opening pixels changed to ${qualificationPrimary.cleanup.cameraOpening.pixels}`)
  const qualificationStability = qualificationSegmentations.map((segmentation) => ({
    threshold: segmentation.threshold,
    iouWithPrimary: maskIou(qualificationPrimary.mask, segmentation.mask),
    boundsDriftFromPrimary: boundsDrift(qualificationPrimary.bounds, segmentation.bounds),
    bounds: segmentation.bounds,
    pixels: segmentation.pixels,
    cameraOpening: segmentation.cleanup.cameraOpening,
    filledComponents: segmentation.cleanup.filledComponents,
    filledPixels: segmentation.cleanup.filledPixels,
    outerLines: segmentation.outerLines,
    sourceCorners: segmentation.sourceCorners,
  }))
  const qualificationMinimumThresholdIou = Math.min(...qualificationStability.map((item) => item.iouWithPrimary))
  const qualificationMaximumBoundsDrift = Math.max(...qualificationStability.map((item) => item.boundsDriftFromPrimary))
  assert(qualificationMinimumThresholdIou >= profile.minimumThresholdIou, `Qualification threshold IoU failed: ${qualificationMinimumThresholdIou}`)
  assert(qualificationMaximumBoundsDrift <= profile.maximumBoundsDrift, `Qualification bounds drift failed: ${qualificationMaximumBoundsDrift}`)
  const gray = await sharp(sourceBytes)
    .extract(SOURCE_ROI)
    .greyscale()
    .blur(EDGE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert(gray.info.width === SOURCE_ROI.width && gray.info.height === SOURCE_ROI.height, 'A23 physical-edge ROI changed')
  const segmentations = EDGE_THRESHOLDS.map((threshold) => segmentPhysicalEdges(gray.data, threshold))
  const primary = segmentations.find((segmentation) => segmentation.threshold === PRIMARY_EDGE_THRESHOLD)
  const stability = segmentations.map((segmentation) => ({
    threshold: segmentation.threshold,
    iouWithPrimary: maskIou(primary.mask, segmentation.mask),
    boundsDriftFromPrimary: boundsDrift(primary.bounds, segmentation.bounds),
    bounds: segmentation.bounds,
    pixels: segmentation.pixels,
    openingPixels: segmentation.openingPixels,
    outerDiagnostics: segmentation.outer.diagnostics,
    openingDiagnostics: segmentation.opening.diagnostics,
    outerLines: segmentation.outerLines,
    sourceCorners: segmentation.sourceCorners,
  }))
  const minimumThresholdIou = Math.min(...stability.map((item) => item.iouWithPrimary))
  const maximumBoundsDrift = Math.max(...stability.map((item) => item.boundsDriftFromPrimary))
  assert(minimumThresholdIou >= profile.minimumThresholdIou, `Physical-edge threshold IoU failed: ${minimumThresholdIou}; ${JSON.stringify(stability)}`)
  assert(maximumBoundsDrift <= profile.maximumBoundsDrift, `Physical-edge bounds drift failed: ${maximumBoundsDrift}`)
  const officialDeviceAspect = OFFICIAL_WIDTH_MM / OFFICIAL_HEIGHT_MM
  const targetBodyHeight = Math.round(sourceHeightForCorners(primary.sourceCorners))
  const targetBodyWidth = Math.round(targetBodyHeight * officialDeviceAspect)
  assert(inRange(targetBodyHeight, [790, 800]), `Rectified A23 body height is implausible: ${targetBodyHeight}`)
  assert(inRange(targetBodyWidth, [367, 372]), `Rectified A23 body width is implausible: ${targetBodyWidth}`)
  const rectifiedWidth = targetBodyWidth + OUTPUT_PADDING * 2
  const rectifiedHeight = targetBodyHeight + OUTPUT_PADDING * 2
  const destinationCorners = [
    { x: OUTPUT_PADDING + RECTIFICATION_PIXEL_PHASE, y: OUTPUT_PADDING + RECTIFICATION_PIXEL_PHASE },
    { x: OUTPUT_PADDING + targetBodyWidth - 1 + RECTIFICATION_PIXEL_PHASE, y: OUTPUT_PADDING + RECTIFICATION_PIXEL_PHASE },
    { x: OUTPUT_PADDING + targetBodyWidth - 1 + RECTIFICATION_PIXEL_PHASE, y: OUTPUT_PADDING + targetBodyHeight - 1 + RECTIFICATION_PIXEL_PHASE },
    { x: OUTPUT_PADDING + RECTIFICATION_PIXEL_PHASE, y: OUTPUT_PADDING + targetBodyHeight - 1 + RECTIFICATION_PIXEL_PHASE },
  ]
  const cornerStability = segmentations.map((segmentation) => ({
    threshold: segmentation.threshold,
    maximumCornerDrift: Math.max(...segmentation.sourceCorners.flatMap((corner, index) => [
      Math.abs(corner.x - primary.sourceCorners[index].x),
      Math.abs(corner.y - primary.sourceCorners[index].y),
    ])),
    sourceCorners: segmentation.sourceCorners,
  }))
  const maximumSourceCornerDrift = Math.max(...cornerStability.map((item) => item.maximumCornerDrift))
  assert(maximumSourceCornerDrift <= profile.maximumBoundsDrift, `Observed source-corner drift failed: ${maximumSourceCornerDrift}`)
  for (const segmentation of segmentations) {
    const rectified = warpMask(
      segmentation.mask,
      SOURCE_ROI.width,
      SOURCE_ROI.height,
      primary.sourceCorners,
      destinationCorners,
      rectifiedWidth,
      rectifiedHeight,
    )
    segmentation.rectifiedMask = rectified.mask
    segmentation.mappedForegroundBounds = rectified.mappedForegroundBounds
    segmentation.rectifiedBounds = boundsForMask(segmentation.rectifiedMask, rectifiedWidth, rectifiedHeight).bounds
  }
  const rectifiedStability = segmentations.map((segmentation) => ({
    threshold: segmentation.threshold,
    iouWithPrimary: maskIou(primary.rectifiedMask, segmentation.rectifiedMask),
    boundsDriftFromPrimary: boundsDrift(primary.rectifiedBounds, segmentation.rectifiedBounds),
    bounds: segmentation.rectifiedBounds,
    mappedForegroundBounds: segmentation.mappedForegroundBounds,
  }))
  const rectifiedMinimumThresholdIou = Math.min(...rectifiedStability.map((item) => item.iouWithPrimary))
  const rectifiedMaximumBoundsDrift = Math.max(...rectifiedStability.map((item) => item.boundsDriftFromPrimary))
  assert(rectifiedMinimumThresholdIou >= profile.minimumThresholdIou, `Rectified threshold IoU failed: ${rectifiedMinimumThresholdIou}`)
  assert(rectifiedMaximumBoundsDrift <= profile.maximumBoundsDrift, `Rectified bounds drift failed: ${rectifiedMaximumBoundsDrift}`)
  const rectifiedBody = boundsForMask(primary.rectifiedMask, rectifiedWidth, rectifiedHeight)
  const transparentMargins = {
    left: rectifiedBody.bounds.minX,
    top: rectifiedBody.bounds.minY,
    right: rectifiedWidth - 1 - rectifiedBody.bounds.maxX,
    bottom: rectifiedHeight - 1 - rectifiedBody.bounds.maxY,
  }
  assert(Object.values(transparentMargins).every((margin) => margin >= 8), `Rectified A23 contour is too close to the canvas edge: ${JSON.stringify(transparentMargins)}`)
  const allRectifiedOpenings = findInternalComponents(primary.rectifiedMask, rectifiedWidth, rectifiedHeight)
  const nonSignificantSamplingComponents = allRectifiedOpenings
    .filter((component) => component.pixels < 100)
    .map(({ pixels, bounds }) => ({ pixels, bounds }))
  const nonSignificantSamplingPixels = nonSignificantSamplingComponents.reduce((sum, component) => sum + component.pixels, 0)
  assert(
    nonSignificantSamplingComponents.every((component) => component.pixels <= 4) && nonSignificantSamplingPixels <= 12,
    `Unexpected A23 nearest-neighbor sampling components: ${JSON.stringify(nonSignificantSamplingComponents)}`,
  )
  const rectifiedOpenings = allRectifiedOpenings
    .filter((component) => component.pixels >= 100)
    .map((component) => normalizedComponent(component, {
      minX: destinationCorners[0].x,
      minY: destinationCorners[0].y,
      maxX: destinationCorners[2].x,
      maxY: destinationCorners[2].y,
    }))
  assert(rectifiedOpenings.length === 1, `Expected one rectified A23 physical opening, found ${rectifiedOpenings.length}`)
  const rectifiedOpening = rectifiedOpenings[0]
  assert(inRange(rectifiedOpening.pixels, [17700, 18200]), `Rectified camera opening pixels changed: ${rectifiedOpening.pixels}`)
  assert(inRange(rectifiedOpening.centerX, [0.25, 0.27]), `Rectified camera opening horizontal position changed: ${rectifiedOpening.centerX}`)
  assert(inRange(rectifiedOpening.centerY, [0.17, 0.19]), `Rectified camera opening vertical position changed: ${rectifiedOpening.centerY}`)
  assert(inRange(rectifiedOpening.width, [0.32, 0.34]), `Rectified camera opening width changed: ${rectifiedOpening.width}`)
  assert(inRange(rectifiedOpening.height, [0.22, 0.24]), `Rectified camera opening height changed: ${rectifiedOpening.height}`)
  assert(inRange(rectifiedOpening.aspect, [0.65, 0.67]), `Rectified camera opening aspect changed: ${rectifiedOpening.aspect}`)
  const diagnostics = {
    framePath,
    width: info.width,
    height: info.height,
    primaryThreshold: PRIMARY_THRESHOLD,
    stabilityThresholds: STABILITY_THRESHOLDS,
    minimumThresholdIou,
    maximumBoundsDrift,
    qualification: {
      minimumThresholdIou: qualificationMinimumThresholdIou,
      maximumBoundsDrift: qualificationMaximumBoundsDrift,
      stability: qualificationStability,
    },
    rectification: {
      officialDeviceAspect,
      targetBodyWidth,
      targetBodyHeight,
      rectifiedWidth,
      rectifiedHeight,
      destinationCorners,
      primarySourceCorners: primary.sourceCorners,
      primaryOuterLines: primary.outerLines,
      maximumSourceCornerDrift,
      cornerStability,
      primaryRectifiedBounds: primary.rectifiedBounds,
      transparentMargins,
      nonSignificantSamplingComponents,
      nonSignificantSamplingPixels,
      rectifiedOpening,
      rectifiedMinimumThresholdIou,
      rectifiedMaximumBoundsDrift,
      rectifiedStability,
    },
    stability,
  }
  if (directFramePath) {
    console.log(JSON.stringify(diagnostics, null, 2))
    return
  }

  const cropped = cropMask(primary.rectifiedMask, rectifiedWidth, rectifiedHeight)
  await mkdir(outputDir, { recursive: true })
  const candidates = []
  for (const finish of FINISHES) {
    candidates.push(await encodeCandidate(asset.targetModelId, finish, cropped.alpha, cropped.width, cropped.height, outputDir))
  }
  assert(new Set(candidates.map((candidate) => candidate.outputAlphaSha256)).size === 1, 'A23 Black and White alpha differs')
  const visualReviewEvidence = await writeSourceReviewOverlay(sourceBytes, primary, reviewDir)
  const result = {
    modelId: asset.targetModelId,
    modelName: asset.targetModelName,
    sourceModelId: asset.sourceModelId,
    sourceKind: 'derived-verified-retail-source',
    reviewStatus: 'pending-independent-visual-review',
    publicationEligible: false,
    publicationBlock: 'Independent source-overlay and candidate review has not yet passed.',
    sourceAsset: {
      path: asset.path,
      sourceUrl: asset.sourceUrl,
      encodedSha256: asset.encodedSha256,
      decodedPixelSha256: asset.decodedPixelSha256,
      frameTimestampSeconds: asset.hlsEvidence.frame.timestampSeconds,
      geometryUse: asset.geometryReview,
    },
    identityEvidence: {
      compatibilityReason: asset.compatibilityReason,
      amazon: asset.amazonEvidence,
      officialModels: asset.officialModelEvidence,
    },
    sourceGeometry: {
      sourceQualification: diagnostics.qualification,
      method: 'closed-gradient-paths-in-fixed-narrow-corridors-over-a-pixel-locked-real-video-frame',
      roi: SOURCE_ROI,
      edgeBlurSigma: EDGE_BLUR_SIGMA,
      edgeSampleDistance: EDGE_SAMPLE_DISTANCE,
      primaryThreshold: PRIMARY_EDGE_THRESHOLD,
      stabilityThresholds: EDGE_THRESHOLDS,
      minimumThresholdIou,
      requiredMinimumThresholdIou: profile.minimumThresholdIou,
      maximumBoundsDrift,
      allowedMaximumBoundsDrift: profile.maximumBoundsDrift,
      stability,
      edgeSearchRadius: EDGE_SEARCH_RADIUS,
      edgeMaximumOffsetStep: EDGE_MAX_OFFSET_STEP,
      edgeTransitionPenalty: EDGE_TRANSITION_PENALTY,
      edgeGuidePenalty: EDGE_GUIDE_PENALTY,
      outerGuide: OUTER_GUIDE,
      openingGuide: OPENING_GUIDE,
      edgeFitGuides: PHYSICAL_EDGE_FIT_GUIDES,
      primarySourceBounds: primary.bounds,
      primarySourcePixels: primary.pixels,
      primaryCameraOpeningPixels: primary.openingPixels,
      primaryOuterDiagnostics: primary.outer.diagnostics,
      primaryOpeningDiagnostics: primary.opening.diagnostics,
      maximumSourceCornerDrift,
      cornerStability,
    },
    rectification: {
      kind: 'single-projective-rectification-from-four-robust-fitted-observed-physical-outer-edges',
      sourceCorners: primary.sourceCorners,
      outerLineFits: primary.outerLines,
      officialDimensions: { widthMm: OFFICIAL_WIDTH_MM, heightMm: OFFICIAL_HEIGHT_MM },
      officialDeviceAspect,
      targetBodyWidth,
      targetBodyHeight,
      temporaryPadding: OUTPUT_PADDING,
      rectifiedWidth,
      rectifiedHeight,
      destinationCorners,
      primaryMappedForegroundBounds: primary.mappedForegroundBounds,
      primaryRectifiedBounds: primary.rectifiedBounds,
      transparentMargins,
      minimumThresholdIou: rectifiedMinimumThresholdIou,
      maximumBoundsDrift: rectifiedMaximumBoundsDrift,
      stability: rectifiedStability,
      silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
      spatialTransform: 'one fixed projective transform applied to the directly observed silhouette and its directly observed sole opening; the valid inverse-sampling domain is bounded by forward-mapping every observed foreground pixel center',
    },
    transform: {
      kind: 'real-video-segmentation-single-projective-rectification-and-alpha-only-neutral-matte-relighting',
      crop: cropped.crop,
      outputMargins: cropped.margins,
      sourceRgbUsed: false,
      fullyTransparentRgb: 'zeroed',
      edgeBlurSigmaForRgbLightingOnly: EDGE_BLUR_SIGMA_FOR_LIGHTING,
      morphologyOperations: 0,
      inferredBoundaryPixels: 0,
      inferredOpeningPixels: 0,
    },
    visualReviewEvidence,
    alpha: {
      sha256: sha256(cropped.alpha),
      width: cropped.width,
      height: cropped.height,
      bounds: boundsForMask(cropped.alpha, cropped.width, cropped.height).bounds,
      pixels: boundsForMask(cropped.alpha, cropped.width, cropped.height).pixels,
      significantOpenings: [{ ...rectifiedOpening, openingId: 'camera' }],
      nonSignificantSamplingComponents,
      nonSignificantSamplingPixels,
      expectedOpeningCount: 1,
      openingQaPassed: true,
    },
    candidates,
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: provenance.source,
    summary: {
      models: 1,
      candidates: result.candidates.length,
      sourceThresholdStabilityPassed: minimumThresholdIou >= profile.minimumThresholdIou ? 1 : 0,
      observedEdgeFitsPassed: Object.values(primary.outerLines).every((line) => line.rms <= 3) ? 1 : 0,
      rectifiedThresholdStabilityPassed: rectifiedMinimumThresholdIou >= profile.minimumThresholdIou ? 1 : 0,
      exactOpeningTopologyPassed: result.alpha.openingQaPassed && result.alpha.significantOpenings.length === 1 ? 1 : 0,
      completeContourMarginsPassed: Object.values(cropped.margins).every((margin) => margin === FINAL_OUTPUT_PADDING) ? 1 : 0,
      exactPairAlpha: new Set(result.candidates.map((candidate) => candidate.outputAlphaSha256)).size === 1 ? 1 : 0,
      automatedQaPassed: result.candidates.filter((candidate) => candidate.qa.passed).length,
      publicationEligible: 0,
      shopifyWrites: 0,
    },
    results: [result],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, reviewOverlayPath: visualReviewEvidence.path, summary: report.summary }, null, 2))
}

await main()