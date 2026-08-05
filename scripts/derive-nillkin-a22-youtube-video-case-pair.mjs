#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/nillkin-a22-youtube-video-case-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REVIEW_DIR = 'reference/case-history/generated/all-phone-real-image-completion/reviews'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/nillkin-a22-youtube-video-case-derived-provenance.json'
const ROI = { left: 0, top: 70, width: 560, height: 980 }
const OUTPUT_PADDING = 16
const EDGE_BLUR_SIGMA = 2
const EDGE_SAMPLE_DISTANCE = 2
const EDGE_THRESHOLDS = [1.5, 1.75, 2]
const PRIMARY_EDGE_THRESHOLD = 1.75
const MINIMUM_THRESHOLD_IOU = 0.995
const MAXIMUM_BOUNDS_DRIFT = 4
const EDGE_SEARCH_RADIUS = 14
const EDGE_MAX_OFFSET_STEP = 4
const EDGE_TRANSITION_PENALTY = 4
const EDGE_GUIDE_PENALTY = 0.5
const EDGE_BLUR_SIGMA_FOR_LIGHTING = 6
const FINISHES = ['black', 'white']
const OUTER_GUIDE = [
  [190, 58], [260, 54], [360, 54], [430, 58], [475, 72], [505, 96], [525, 126],
  [531, 165], [529, 230], [523, 300], [514, 370], [505, 440], [497, 510],
  [489, 580], [481, 650], [473, 720], [466, 785], [462, 835], [459, 860],
  [450, 882], [430, 895], [400, 903], [350, 906], [300, 905], [250, 902],
  [200, 898], [150, 894], [110, 889], [80, 878], [63, 858], [57, 835],
  [59, 810], [63, 780], [68, 740], [73, 700], [79, 650], [85, 600], [92, 550],
  [98, 500], [104, 450], [110, 400], [116, 350], [122, 300], [129, 250],
  [136, 200], [142, 160], [148, 120], [158, 90], [170, 70],
].map(([x, y]) => ({ x, y }))
const OPENING_GUIDE = [
  [195, 88], [245, 88], [270, 90], [286, 100], [294, 118], [296, 150],
  [294, 178], [285, 195], [270, 205], [220, 210], [185, 207], [168, 200],
  [158, 188], [153, 170], [153, 125], [158, 108], [170, 96],
].map(([x, y]) => ({ x, y }))

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
  const fx = clampedX - x0
  const fy = clampedY - y0
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
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

function contourCandidates(gray, width, height, guide, threshold) {
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
      const response = Math.abs(after - before)
      candidates[index][state] = {
        point,
        normal,
        offset,
        response,
        valid: response >= threshold,
        localScore: response - EDGE_GUIDE_PENALTY * offset ** 2,
      }
    }
  }
  return candidates
}

function traceContour(gray, width, height, guide, threshold, id) {
  const candidates = contourCandidates(gray, width, height, guide, threshold)
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
    assert(intersections.length % 2 === 0, `Odd polygon intersection count at row ${y}`)
    for (let index = 0; index < intersections.length; index += 2) {
      const minimumX = Math.max(0, Math.ceil(intersections[index] - 0.5))
      const maximumX = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5))
      for (let x = minimumX; x <= maximumX; x += 1) mask[y * width + x] = value
    }
  }
}

function svgPath(points) {
  return `${points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`
}

async function writeSourceReviewOverlay(frame, segmentation, reviewDir) {
  const sourceBytes = await readFile(frame.path)
  const outerPath = svgPath(segmentation.outer.points)
  const openingPath = svgPath(segmentation.opening.points)
  const overlay = Buffer.from(`<svg width="${ROI.width}" height="${ROI.height}" viewBox="0 0 ${ROI.width} ${ROI.height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${outerPath} ${openingPath}" fill="#ff2038" fill-opacity="0.2" fill-rule="evenodd"/>
    <path d="${outerPath}" fill="none" stroke="#ff2038" stroke-width="2"/>
    <path d="${openingPath}" fill="none" stroke="#006cff" stroke-width="2"/>
  </svg>`)
  const outputBuffer = await sharp(sourceBytes)
    .extract(ROI)
    .composite([{ input: overlay }])
    .removeAlpha()
    .png()
    .toBuffer()
  const decoded = await sharp(outputBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const outputPath = path.join(reviewDir, 'galaxy-a22-5g-nillkin-real-video-physical-edge-overlay.png')
  await mkdir(reviewDir, { recursive: true })
  await writeFile(outputPath, outputBuffer)
  return {
    path: outputPath,
    sourceFramePath: frame.path,
    encodedSha256: sha256(outputBuffer),
    decodedPixelSha256: sha256(decoded.data),
    width: decoded.info.width,
    height: decoded.info.height,
    outerEdgeColour: '#ff2038',
    openingEdgeColour: '#006cff',
    bodyFillOpacity: 0.2,
    geometryUse: 'visual review only; never sampled by candidate generation',
  }
}

function linearRegression(points) {
  assert(points.length >= 20, 'Not enough physical-edge points for line fit')
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  let numerator = 0
  let denominator = 0
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY)
    denominator += (point.x - meanX) ** 2
  }
  assert(denominator > 0, 'Degenerate physical-edge line fit')
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
    if (filtered.length === selected.length || filtered.length < 20) break
    selected = filtered
  }
  const fit = linearRegression(selected)
  return { slope: fit.slope, intercept: fit.intercept, rms: fit.rms, points: selected.length, candidates: points.length }
}

function fitOuterLines(points) {
  const left = robustLine(points
    .filter((point) => point.y >= 220 && point.y <= 720 && point.x <= 170)
    .map((point) => ({ x: point.y, y: point.x })))
  const right = robustLine(points
    .filter((point) => point.y >= 220 && point.y <= 720 && point.x >= 430)
    .map((point) => ({ x: point.y, y: point.x })))
  const top = robustLine(points.filter((point) => point.x >= 210 && point.x <= 420 && point.y <= 100))
  const bottom = robustLine(points.filter((point) => point.x >= 150 && point.x <= 400 && point.y >= 870))
  return { left, right, top, bottom }
}

function intersectSideAndEdge(side, edge) {
  const denominator = 1 - side.slope * edge.slope
  assert(Math.abs(denominator) > 1e-6, 'Parallel physical-edge fits')
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

function transformPoint(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  }
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
    for (const neighbor of neighbors) if (neighbor >= 0) enqueueExterior(neighbor)
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
    components.push({ pixels: tail, bounds })
  }
  return components
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
  const outputPath = path.join(outputDir, `${modelId}-${finish}-v1-nillkin-real-video-alpha-matte.png`)
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

async function decodeGeometryFrame(frame) {
  const bytes = await readFile(frame.path)
  assert(sha256(bytes) === frame.encodedSha256, `${frame.id}: encoded source hash changed`)
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(sha256(decoded.data) === frame.decodedPixelSha256, `${frame.id}: decoded source pixels changed`)
  assert(decoded.info.width === 1920 && decoded.info.height === 1080, `${frame.id}: source dimensions changed`)
  const gray = await sharp(bytes)
    .extract(ROI)
    .greyscale()
    .blur(EDGE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert(gray.info.width === ROI.width && gray.info.height === ROI.height, `${frame.id}: ROI dimensions changed`)
  return { frame, gray: gray.data }
}

function segmentFrame(decodedFrame, threshold) {
  const outer = traceContour(decodedFrame.gray, ROI.width, ROI.height, OUTER_GUIDE, threshold, `${decodedFrame.frame.id}:outer`)
  const opening = traceContour(decodedFrame.gray, ROI.width, ROI.height, OPENING_GUIDE, threshold, `${decodedFrame.frame.id}:opening`)
  const mask = new Uint8Array(ROI.width * ROI.height)
  rasterizePolygon(mask, ROI.width, ROI.height, outer.points, 1)
  const beforeOpening = boundsForMask(mask, ROI.width, ROI.height).pixels
  rasterizePolygon(mask, ROI.width, ROI.height, opening.points, 0)
  const body = boundsForMask(mask, ROI.width, ROI.height)
  const openingPixels = beforeOpening - body.pixels
  assert(openingPixels >= 10_000, `${decodedFrame.frame.id}: physical opening is too small`)
  const outerLines = fitOuterLines(outer.points)
  for (const [edge, fit] of Object.entries(outerLines)) {
    assert(fit.rms <= 3, `${decodedFrame.frame.id}:${edge} physical-edge fit is unstable: ${fit.rms}`)
  }
  const sourceCorners = [
    intersectSideAndEdge(outerLines.left, outerLines.top),
    intersectSideAndEdge(outerLines.right, outerLines.top),
    intersectSideAndEdge(outerLines.right, outerLines.bottom),
    intersectSideAndEdge(outerLines.left, outerLines.bottom),
  ]
  return {
    frameId: decodedFrame.frame.id,
    timestampSeconds: decodedFrame.frame.timestampSeconds,
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

function sourceHeightForCorners(corners) {
  const left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y)
  const right = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y)
  return (left + right) / 2
}

async function deriveAsset(asset, outputDir, reviewDir) {
  assert(asset.publicationEligible, 'A22 source is not publication-eligible')
  const geometryFrames = asset.frames.filter((frame) => frame.id.startsWith('empty-shell-geometry'))
  assert(geometryFrames.length === 3, 'Expected three pixel-locked A22 geometry frames')
  const decodedFrames = await Promise.all(geometryFrames.map(decodeGeometryFrame))
  const segmentations = decodedFrames.flatMap((frame) => EDGE_THRESHOLDS.map((threshold) => segmentFrame(frame, threshold)))
  const primary = segmentations.find((item) => item.frameId === 'empty-shell-geometry' && item.threshold === PRIMARY_EDGE_THRESHOLD)
  assert(primary, 'Primary A22 segmentation is missing')
  const dimension = asset.officialDimensionEvidence
  const officialDeviceAspect = dimension.widthMm / dimension.heightMm
  const targetBodyHeight = Math.round(sourceHeightForCorners(primary.sourceCorners))
  const targetBodyWidth = Math.round(targetBodyHeight * officialDeviceAspect)
  assert(inRange(targetBodyHeight, [820, 900]), `Rectified body height is implausible: ${targetBodyHeight}`)
  assert(inRange(targetBodyWidth, [370, 420]), `Rectified body width is implausible: ${targetBodyWidth}`)
  const rectifiedWidth = targetBodyWidth + OUTPUT_PADDING * 2
  const rectifiedHeight = targetBodyHeight + OUTPUT_PADDING * 2
  const destinationCorners = [
    { x: OUTPUT_PADDING, y: OUTPUT_PADDING },
    { x: OUTPUT_PADDING + targetBodyWidth - 1, y: OUTPUT_PADDING },
    { x: OUTPUT_PADDING + targetBodyWidth - 1, y: OUTPUT_PADDING + targetBodyHeight - 1 },
    { x: OUTPUT_PADDING, y: OUTPUT_PADDING + targetBodyHeight - 1 },
  ]
  for (const segmentation of segmentations) {
    segmentation.rectifiedMask = warpMask(
      segmentation.mask,
      ROI.width,
      ROI.height,
      segmentation.sourceCorners,
      destinationCorners,
      rectifiedWidth,
      rectifiedHeight,
    )
    segmentation.rectifiedBounds = boundsForMask(segmentation.rectifiedMask, rectifiedWidth, rectifiedHeight).bounds
  }
  const rectifiedPrimary = primary.rectifiedMask
  const thresholdStability = EDGE_THRESHOLDS.map((threshold) => {
    const candidate = segmentations.find((item) => item.frameId === primary.frameId && item.threshold === threshold)
    return {
      threshold,
      iouWithPrimary: maskIou(rectifiedPrimary, candidate.rectifiedMask),
      boundsDriftFromPrimary: boundsDrift(primary.rectifiedBounds, candidate.rectifiedBounds),
      sourceBounds: candidate.bounds,
      rectifiedBounds: candidate.rectifiedBounds,
      outerDiagnostics: candidate.outer.diagnostics,
      openingDiagnostics: candidate.opening.diagnostics,
    }
  })
  const temporalStability = geometryFrames.map((frame) => {
    const candidate = segmentations.find((item) => item.frameId === frame.id && item.threshold === PRIMARY_EDGE_THRESHOLD)
    return {
      frameId: frame.id,
      timestampSeconds: frame.timestampSeconds,
      iouWithPrimary: maskIou(rectifiedPrimary, candidate.rectifiedMask),
      boundsDriftFromPrimary: boundsDrift(primary.rectifiedBounds, candidate.rectifiedBounds),
      sourceBounds: candidate.bounds,
      rectifiedBounds: candidate.rectifiedBounds,
      outerDiagnostics: candidate.outer.diagnostics,
      openingDiagnostics: candidate.opening.diagnostics,
    }
  })
  const minimumThresholdIou = Math.min(...thresholdStability.map((item) => item.iouWithPrimary))
  const maximumThresholdBoundsDrift = Math.max(...thresholdStability.map((item) => item.boundsDriftFromPrimary))
  const minimumTemporalIou = Math.min(...temporalStability.map((item) => item.iouWithPrimary))
  const maximumTemporalBoundsDrift = Math.max(...temporalStability.map((item) => item.boundsDriftFromPrimary))
  assert(
    minimumThresholdIou >= MINIMUM_THRESHOLD_IOU,
    `Edge threshold IoU failed: ${minimumThresholdIou}; ${JSON.stringify(thresholdStability)}`,
  )
  assert(maximumThresholdBoundsDrift <= MAXIMUM_BOUNDS_DRIFT, `Edge threshold bounds drift failed: ${maximumThresholdBoundsDrift}`)
  assert(minimumTemporalIou >= MINIMUM_THRESHOLD_IOU, `Temporal geometry IoU failed: ${minimumTemporalIou}`)
  assert(maximumTemporalBoundsDrift <= MAXIMUM_BOUNDS_DRIFT, `Temporal geometry bounds drift failed: ${maximumTemporalBoundsDrift}`)
  const body = boundsForMask(rectifiedPrimary, rectifiedWidth, rectifiedHeight)
  const openings = findInternalComponents(rectifiedPrimary, rectifiedWidth, rectifiedHeight)
    .filter((component) => component.pixels >= 100)
    .map((component) => normalizedComponent(component, body.bounds))
  assert(openings.length === 1, `Expected one rectified physical opening, found ${openings.length}`)
  const opening = openings[0]
  assert(inRange(opening.centerX, [0.16, 0.34]), `Physical opening horizontal position changed: ${opening.centerX}`)
  assert(inRange(opening.centerY, [0.07, 0.20]), `Physical opening vertical position changed: ${opening.centerY}`)
  assert(inRange(opening.width, [0.25, 0.45]), `Physical opening width changed: ${opening.width}`)
  assert(inRange(opening.height, [0.10, 0.22]), `Physical opening height changed: ${opening.height}`)
  assert(inRange(opening.aspect, [0.85, 1.35]), `Physical opening aspect is implausible: ${opening.aspect}`)
  const primaryFrame = geometryFrames.find((frame) => frame.id === primary.frameId)
  assert(primaryFrame, 'Primary source frame is missing')
  const visualReviewEvidence = await writeSourceReviewOverlay(primaryFrame, primary, reviewDir)
  const cropped = cropMask(rectifiedPrimary, rectifiedWidth, rectifiedHeight)
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
    sourceAssets: geometryFrames.map((frame) => ({
      id: frame.id,
      path: frame.path,
      sourceUrl: asset.sourceUrl,
      encodedSha256: frame.encodedSha256,
      decodedPixelSha256: frame.decodedPixelSha256,
      frameTimestampSeconds: frame.timestampSeconds,
      geometryUse: frame.geometryUse,
    })),
    identityEvidence: {
      reason: asset.eligibilityReason,
      chain: asset.identityChain,
      video: asset.videoEvidence,
      officialDimension: asset.officialDimensionEvidence,
    },
    sourceGeometry: {
      method: 'closed-gradient-paths-in-fixed-narrow-corridors-over-pixel-locked-real-video-frames',
      roi: ROI,
      edgeBlurSigma: EDGE_BLUR_SIGMA,
      edgeSampleDistance: EDGE_SAMPLE_DISTANCE,
      primaryThreshold: PRIMARY_EDGE_THRESHOLD,
      stabilityThresholds: EDGE_THRESHOLDS,
      minimumThresholdIou,
      requiredMinimumThresholdIou: MINIMUM_THRESHOLD_IOU,
      maximumThresholdBoundsDrift,
      allowedMaximumBoundsDrift: MAXIMUM_BOUNDS_DRIFT,
      thresholdStability,
      minimumTemporalIou,
      maximumTemporalBoundsDrift,
      temporalStability,
      searchRadius: EDGE_SEARCH_RADIUS,
      maximumOffsetStep: EDGE_MAX_OFFSET_STEP,
      transitionPenalty: EDGE_TRANSITION_PENALTY,
      guidePenalty: EDGE_GUIDE_PENALTY,
      outerGuide: OUTER_GUIDE,
      openingGuide: OPENING_GUIDE,
      primarySourceBounds: primary.bounds,
      primarySourcePixels: primary.pixels,
      primaryOpeningPixels: primary.openingPixels,
      primaryOuterDiagnostics: primary.outer.diagnostics,
      primaryOpeningDiagnostics: primary.opening.diagnostics,
    },
    rectification: {
      kind: 'projective-rectification-from-four-robust-fitted-observed-physical-outer-edges',
      sourceCorners: primary.sourceCorners,
      outerLineFits: primary.outerLines,
      officialDeviceAspect,
      targetBodyWidth,
      targetBodyHeight,
      padding: OUTPUT_PADDING,
      rectifiedWidth,
      rectifiedHeight,
      destinationCorners,
      silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
      spatialTransform: 'one projective transform applied to the directly traced physical silhouette and its directly traced sole opening; no morphology, template boundary, inferred opening, or synthesized geometry',
    },
    transform: {
      kind: 'real-video-physical-edge-tracing-projective-rectification-and-alpha-only-neutral-matte-relighting',
      geometrySource: asset.geometrySource,
      crop: cropped.crop,
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
      significantOpenings: [{ ...opening, openingId: 'camera' }],
      expectedOpeningCount: 1,
      openingQaPassed: true,
    },
    candidates,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reviewDir = argumentValue('--review-dir', DEFAULT_REVIEW_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const provenance = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(provenance.assets?.length === 1, 'Expected one A22 source asset')
  const result = await deriveAsset(provenance.assets[0], outputDir, reviewDir)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: provenance.source,
    summary: {
      models: 1,
      candidates: result.candidates.length,
      sourceThresholdStabilityPassed: result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou ? 1 : 0,
      temporalGeometryStabilityPassed: result.sourceGeometry.minimumTemporalIou >= result.sourceGeometry.requiredMinimumThresholdIou ? 1 : 0,
      rectifiedThresholdStabilityPassed: result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou ? 1 : 0,
      exactOpeningTopologyPassed: result.alpha.openingQaPassed && result.alpha.significantOpenings.length === 1 ? 1 : 0,
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