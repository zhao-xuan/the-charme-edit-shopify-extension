#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a-series-case-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/spigen-a-series-case-derived-provenance.json'
const DEFAULT_EXPECTED_MODELS = 11
const BACKGROUND_DELTA_THRESHOLD = 12
const STABILITY_THRESHOLDS = [11, 12, 13]
const MINIMUM_THRESHOLD_IOU = 0.995
const MAXIMUM_BOUNDS_DRIFT = 4
const MINIMUM_SIGNIFICANT_HOLE_PIXELS = 1_000
const OUTPUT_PADDING = 16
const EDGE_BLUR_SIGMA = 8
const FINISHES = ['black', 'white']
const DEFAULT_CAMERA_OPENING_PROFILE = {
  id: 'upper-right-significant',
  minimumCount: 1,
  repeatPattern: true,
  openings: [
    { minPixels: 1_000, centerX: [0.55, 1], centerY: [0, 0.45] },
  ],
}
const CAMERA_OPENING_PROFILES = {
  'galaxy-a16': {
    id: 'galaxy-a16-camera-and-flash-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-flash', minPixels: 30_000, centerX: [0.72, 0.78], centerY: [0.16, 0.21], width: [0.27, 0.32], height: [0.25, 0.30], aspect: [0.48, 0.56] },
    ],
  },
  'galaxy-a17': {
    id: 'galaxy-a17-camera-and-flash-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-flash', minPixels: 65_000, centerX: [0.70, 0.74], centerY: [0.17, 0.21], width: [0.32, 0.37], height: [0.26, 0.30], aspect: [0.58, 0.64] },
    ],
  },
  'galaxy-note-10': {
    id: 'galaxy-note-10-upper-right-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-flash', minPixels: 3_500, centerX: [0.70, 0.80], centerY: [0.12, 0.22], width: [0.23, 0.31], height: [0.19, 0.26], aspect: [0.50, 0.70] },
    ],
  },
  'galaxy-note-10-plus': {
    id: 'galaxy-note-10-plus-upper-right-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-flash', minPixels: 4_000, centerX: [0.73, 0.78], centerY: [0.13, 0.19], width: [0.23, 0.28], height: [0.19, 0.23], aspect: [0.55, 0.66] },
    ],
  },
  'galaxy-note-9': {
    id: 'galaxy-note-9-centered-t-opening-single',
    normalizeInternalTransparencyForStability: true,
    primaryThreshold: 10,
    stabilityThresholds: [9, 10, 11],
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-fingerprint', minPixels: 500_000, centerX: [0.49, 0.51], centerY: [0.18, 0.21], width: [0.44, 0.48], height: [0.13, 0.17], aspect: [1.35, 1.65] },
    ],
  },
  'galaxy-s10e': {
    id: 'galaxy-s10e-centered-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'wide-camera', minPixels: 4_500, centerX: [0.48, 0.53], centerY: [0.17, 0.21], width: [0.44, 0.50], height: [0.08, 0.11], aspect: [2.30, 2.80] },
    ],
  },
  'galaxy-a40': {
    id: 'galaxy-a40-camera-and-fingerprint',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera', minPixels: 3_000, centerX: [0.05, 0.30], centerY: [0.08, 0.30], width: [0.10, 0.30], height: [0.15, 0.30], aspect: [0.25, 0.75] },
      { id: 'fingerprint', minPixels: 1_500, centerX: [0.35, 0.65], centerY: [0.12, 0.30], width: [0.12, 0.30], height: [0.06, 0.18], aspect: [0.75, 1.40] },
    ],
  },
  'galaxy-a70': {
    id: 'galaxy-a70-upper-left-camera',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera', minPixels: 3_000, centerX: [0.05, 0.30], centerY: [0.08, 0.30], width: [0.10, 0.30], height: [0.15, 0.30], aspect: [0.25, 0.75] },
    ],
  },
  'galaxy-s9': {
    id: 'galaxy-s9-centered-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-fingerprint', minPixels: 20_000, centerX: [0.38, 0.50], centerY: [0.18, 0.28], width: [0.25, 0.38], height: [0.14, 0.21], aspect: [0.75, 1.05] },
    ],
  },
  'galaxy-s9-plus': {
    id: 'galaxy-s9-plus-centered-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-and-fingerprint', minPixels: 25_000, centerX: [0.38, 0.51], centerY: [0.19, 0.29], width: [0.25, 0.37], height: [0.19, 0.27], aspect: [0.55, 0.75] },
    ],
  },
  'galaxy-s10-plus': {
    id: 'galaxy-s10-plus-wide-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'wide-camera', minPixels: 25_000, centerX: [0.45, 0.55], centerY: [0.13, 0.22], width: [0.50, 0.65], height: [0.06, 0.11], aspect: [3.0, 3.7] },
    ],
  },
  'galaxy-note-20-4g-5g': {
    id: 'galaxy-note-20-upper-right-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera', minPixels: 35_000, centerX: [0.68, 0.79], centerY: [0.10, 0.22], width: [0.24, 0.33], height: [0.20, 0.27], aspect: [0.50, 0.70] },
    ],
  },
  'galaxy-note-20-ultra-4g-5g': {
    id: 'galaxy-note-20-ultra-upper-right-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera', minPixels: 55_000, centerX: [0.65, 0.78], centerY: [0.12, 0.24], width: [0.32, 0.40], height: [0.24, 0.31], aspect: [0.55, 0.75] },
    ],
  },
  'pixel-9a': {
    id: 'pixel-9a-dual-opening',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-oval', minPixels: 20_000, centerX: [0.62, 0.72], centerY: [0.12, 0.21], width: [0.36, 0.45], height: [0.09, 0.14], aspect: [1.5, 1.9] },
      { id: 'secondary-circle', minPixels: 2_000, centerX: [0.33, 0.42], centerY: [0.13, 0.20], width: [0.09, 0.14], height: [0.04, 0.07], aspect: [0.85, 1.20] },
    ],
  },
  'pixel-5': {
    id: 'pixel-5-camera-and-fingerprint',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera', minPixels: 15_000, centerX: [0.23, 0.30], centerY: [0.11, 0.18], width: [0.27, 0.35], height: [0.13, 0.19], aspect: [0.85, 1.10] },
      { id: 'fingerprint', minPixels: 2_000, centerX: [0.47, 0.55], centerY: [0.24, 0.32], width: [0.10, 0.16], height: [0.05, 0.09], aspect: [0.85, 1.15] },
    ],
  },
  'pixel-10': {
    id: 'pixel-10-wide-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-bar', minPixels: 65_000, centerX: [0.45, 0.55], centerY: [0.12, 0.21], width: [0.80, 0.90], height: [0.12, 0.17], aspect: [2.6, 3.2] },
    ],
  },
  'pixel-10-pro': {
    id: 'pixel-10-pro-wide-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-bar', minPixels: 65_000, centerX: [0.45, 0.55], centerY: [0.12, 0.21], width: [0.80, 0.90], height: [0.12, 0.17], aspect: [2.6, 3.2] },
    ],
  },
  'pixel-10-pro-xl': {
    id: 'pixel-10-pro-xl-wide-top-single',
    rejectUnexpectedSignificant: true,
    openings: [
      { id: 'camera-bar', minPixels: 65_000, centerX: [0.45, 0.55], centerY: [0.12, 0.21], width: [0.80, 0.90], height: [0.12, 0.17], aspect: [2.6, 3.2] },
    ],
  },
}

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
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
  if (!pixels) throw new Error('Foreground mask is empty')
  return { bounds, pixels }
}

function connectedForeground(data, info, threshold) {
  const pixelCount = info.width * info.height
  const candidates = new Uint8Array(pixelCount)
  let seed = -1
  let maximumDelta = -1
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * info.channels
    const delta = 255 - Math.min(data[offset], data[offset + 1], data[offset + 2])
    if (delta >= threshold) candidates[index] = 1
    if (delta > maximumDelta) {
      maximumDelta = delta
      seed = index
    }
  }
  if (seed < 0 || !candidates[seed]) throw new Error('Could not locate foreground seed')

  const component = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 1
  queue[0] = seed
  component[seed] = 1
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
      if (neighbor < 0 || !candidates[neighbor] || component[neighbor]) continue
      component[neighbor] = 1
      queue[tail] = neighbor
      tail += 1
    }
  }
  return { mask: component, ...boundsForMask(component, info.width, info.height) }
}

function maskIou(left, right) {
  if (left.length !== right.length) throw new Error('Cannot compare masks with different dimensions')
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

function cropMask(mask, width, height, bounds) {
  const left = Math.max(0, bounds.minX - OUTPUT_PADDING)
  const top = Math.max(0, bounds.minY - OUTPUT_PADDING)
  const right = Math.min(width - 1, bounds.maxX + OUTPUT_PADDING)
  const bottom = Math.min(height - 1, bounds.maxY + OUTPUT_PADDING)
  const outputWidth = right - left + 1
  const outputHeight = bottom - top + 1
  const alpha = Buffer.alloc(outputWidth * outputHeight)
  for (let y = 0; y < outputHeight; y += 1) {
    const sourceStart = (y + top) * width + left
    for (let x = 0; x < outputWidth; x += 1) {
      alpha[y * outputWidth + x] = mask[sourceStart + x] ? 255 : 0
    }
  }
  return {
    alpha,
    width: outputWidth,
    height: outputHeight,
    crop: { left, top, width: outputWidth, height: outputHeight },
  }
}

function clearSourceVisibleOpenings(alpha, width, height, crop, openings = []) {
  let clearedPixels = 0
  for (const opening of openings) {
    if (!['ellipse', 'rounded-rect'].includes(opening.shape)) {
      throw new Error(`Unsupported source-visible opening shape: ${opening.shape}`)
    }
    const { left, top, right, bottom } = opening.bounds
    const radius = opening.shape === 'rounded-rect' ? opening.radius : 0
    for (let y = 0; y < height; y += 1) {
      const sourceY = crop.top + y + 0.5
      if (sourceY < top || sourceY > bottom) continue
      for (let x = 0; x < width; x += 1) {
        const sourceX = crop.left + x + 0.5
        if (sourceX < left || sourceX > right) continue
        let inside = false
        if (opening.shape === 'ellipse') {
          const centerX = (left + right) / 2
          const centerY = (top + bottom) / 2
          inside = ((sourceX - centerX) / ((right - left) / 2)) ** 2
            + ((sourceY - centerY) / ((bottom - top) / 2)) ** 2 <= 1
        } else {
          const nearestX = Math.max(left + radius, Math.min(sourceX, right - radius))
          const nearestY = Math.max(top + radius, Math.min(sourceY, bottom - radius))
          inside = (sourceX - nearestX) ** 2 + (sourceY - nearestY) ** 2 <= radius ** 2
        }
        const index = y * width + x
        if (inside && alpha[index]) {
          alpha[index] = 0
          clearedPixels += 1
        }
      }
    }
  }
  return { openings, clearedPixels }
}

function normalizedHole(hole, bodyBounds) {
  const bodyWidth = bodyBounds.maxX - bodyBounds.minX + 1
  const bodyHeight = bodyBounds.maxY - bodyBounds.minY + 1
  const width = hole.bounds.maxX - hole.bounds.minX + 1
  const height = hole.bounds.maxY - hole.bounds.minY + 1
  return {
    pixels: hole.pixels,
    bounds: hole.bounds,
    centerX: ((hole.bounds.minX + hole.bounds.maxX) / 2 - bodyBounds.minX) / bodyWidth,
    centerY: ((hole.bounds.minY + hole.bounds.maxY) / 2 - bodyBounds.minY) / bodyHeight,
    width: width / bodyWidth,
    height: height / bodyHeight,
    aspect: width / height,
  }
}

function inRange(value, range) {
  return !range || (value >= range[0] && value <= range[1])
}

function matchesOpening(hole, opening) {
  return hole.pixels >= (opening.minPixels || MINIMUM_SIGNIFICANT_HOLE_PIXELS)
    && inRange(hole.centerX, opening.centerX)
    && inRange(hole.centerY, opening.centerY)
    && inRange(hole.width, opening.width)
    && inRange(hole.height, opening.height)
    && inRange(hole.aspect, opening.aspect)
}

function evaluateCameraProfile(holes, bodyBounds, profile) {
  const significant = holes
    .filter((hole) => hole.pixels >= MINIMUM_SIGNIFICANT_HOLE_PIXELS)
    .map((hole) => ({ ...normalizedHole(hole, bodyBounds), componentIndex: hole.componentIndex }))
  if (profile.repeatPattern) {
    const matches = significant.filter((hole) => matchesOpening(hole, profile.openings[0]))
    return {
      passed: matches.length >= profile.minimumCount,
      matches,
      unexpectedSignificant: significant.filter((hole) => !matches.includes(hole)),
    }
  }

  const used = new Set()
  const matches = []
  let passed = true
  for (const opening of profile.openings) {
    const candidates = significant.filter((hole) => (
      !used.has(hole.componentIndex) && matchesOpening(hole, opening)
    ))
    if (candidates.length !== 1) {
      passed = false
      continue
    }
    used.add(candidates[0].componentIndex)
    matches.push({ ...candidates[0], openingId: opening.id })
  }
  const unexpectedSignificant = significant.filter((hole) => !used.has(hole.componentIndex))
  if (profile.rejectUnexpectedSignificant && unexpectedSignificant.length) passed = false
  return { passed: passed && matches.length === profile.openings.length, matches, unexpectedSignificant }
}

function cleanInternalHoles(alpha, width, height, bodyBounds, profile) {
  const pixelCount = width * height
  const exterior = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0
  let tail = 0
  const enqueue = (index) => {
    if (alpha[index] || exterior[index]) return
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
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (index >= width) enqueue(index - width)
    if (index + width < pixelCount) enqueue(index + width)
  }

  const visited = new Uint8Array(pixelCount)
  const components = []
  for (let start = 0; start < pixelCount; start += 1) {
    if (alpha[start] || exterior[start] || visited[start]) continue
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
        if (neighbor < 0 || alpha[neighbor] || exterior[neighbor] || visited[neighbor]) continue
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

  const evaluation = evaluateCameraProfile(components, bodyBounds, profile)
  const retained = new Set(evaluation.matches.map((hole) => hole.componentIndex))
  let filledComponents = 0
  let filledPixels = 0
  for (const component of components) {
    if (retained.has(component.componentIndex)) continue
    for (const index of component.indices) alpha[index] = 255
    filledComponents += 1
    filledPixels += component.pixels
  }
  return {
    profileId: profile.id,
    profilePassed: evaluation.passed,
    holes: evaluation.matches.sort((left, right) => right.pixels - left.pixels),
    unexpectedSignificantHoles: evaluation.unexpectedSignificant,
    filledComponents,
    filledPixels,
  }
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
  const outputData = Buffer.alloc(width * height * 4)
  for (let index = 0; index < alpha.length; index += 1) {
    const outputOffset = index * 4
    const pixelAlpha = alpha[index]
    if (!pixelAlpha) continue
    const x = index % width
    const y = Math.floor(index / width)
    const edgeProximity = 1 - edgeAlpha[index * edgeInfo.channels] / 255
    const horizontalLight = 1 - Math.min(1, Math.abs(x - centerX) / halfWidth)
    const verticalLight = 1 - Math.min(1, Math.abs(y - centerY) / halfHeight)
    const neutral = finish === 'black'
      ? Math.round(30 + horizontalLight * 12 + verticalLight * 6 + edgeProximity * 18)
      : Math.round(235 + horizontalLight * 12 + verticalLight * 6)
    outputData[outputOffset] = neutral
    outputData[outputOffset + 1] = neutral
    outputData[outputOffset + 2] = neutral
    outputData[outputOffset + 3] = pixelAlpha
  }

  const outputBuffer = await sharp(outputData, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer()
  const { data: decoded, info } = await sharp(outputBuffer).raw().toBuffer({ resolveWithObject: true })
  let hiddenRgbPixels = 0
  let maximumChannelSpread = 0
  for (let offset = 0; offset < decoded.length; offset += 4) {
    if (!decoded[offset + 3] && (decoded[offset] || decoded[offset + 1] || decoded[offset + 2])) hiddenRgbPixels += 1
    maximumChannelSpread = Math.max(
      maximumChannelSpread,
      Math.max(decoded[offset], decoded[offset + 1], decoded[offset + 2])
        - Math.min(decoded[offset], decoded[offset + 1], decoded[offset + 2]),
    )
  }
  const decodedAlpha = Buffer.alloc(width * height)
  for (let source = 3, target = 0; source < decoded.length; source += 4, target += 1) decodedAlpha[target] = decoded[source]
  const alphaExact = decodedAlpha.equals(alpha)
  const cornerAlpha = [decodedAlpha[0], decodedAlpha[width - 1], decodedAlpha[(height - 1) * width], decodedAlpha.at(-1)]
  const qa = {
    passed: info.width === width
      && info.height === height
      && info.channels === 4
      && alphaExact
      && hiddenRgbPixels === 0
      && maximumChannelSpread === 0
      && cornerAlpha.every((value) => value === 0),
    alphaExact,
    hiddenRgbPixels,
    maximumChannelSpread,
    cornerAlpha,
  }
  if (!qa.passed) throw new Error(`Candidate QA failed: ${modelId}/${finish} ${JSON.stringify(qa)}`)
  const outputPath = path.join(outputDir, `${modelId}-${finish}-v1-spigen-alpha-matte.png`)
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
  const sourceBuffer = await readFile(asset.path)
  if (sha256(sourceBuffer) !== asset.encodedSha256) throw new Error(`Source hash mismatch: ${asset.path}`)
  const decoded = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true })
  const cameraProfile = CAMERA_OPENING_PROFILES[asset.targetModelId] || DEFAULT_CAMERA_OPENING_PROFILE
  const primaryThreshold = asset.primaryThreshold ?? cameraProfile.primaryThreshold ?? BACKGROUND_DELTA_THRESHOLD
  const stabilityThresholds = asset.stabilityThresholds ?? cameraProfile.stabilityThresholds ?? STABILITY_THRESHOLDS
  if (!stabilityThresholds.includes(primaryThreshold)) {
    throw new Error(`Stability thresholds must include the primary threshold: ${asset.targetModelId}`)
  }
  const thresholdMasks = new Map(stabilityThresholds.map((threshold) => [
    threshold,
    (() => {
      const foreground = connectedForeground(decoded.data, decoded.info, threshold)
      if (!cameraProfile.normalizeInternalTransparencyForStability) return foreground
      const normalizedMask = Uint8Array.from(foreground.mask)
      cleanInternalHoles(
        normalizedMask,
        decoded.info.width,
        decoded.info.height,
        foreground.bounds,
        { ...cameraProfile, rejectUnexpectedSignificant: false },
      )
      const normalization = cleanInternalHoles(
        normalizedMask,
        decoded.info.width,
        decoded.info.height,
        foreground.bounds,
        cameraProfile,
      )
      if (!normalization.profilePassed) {
        throw new Error(`Threshold geometry normalization failed: ${asset.targetModelId}/${threshold} ${JSON.stringify({
          profileId: normalization.profileId,
          matches: normalization.holes,
          unexpectedSignificantHoles: normalization.unexpectedSignificantHoles,
        })}`)
      }
      return {
        mask: normalizedMask,
        ...boundsForMask(normalizedMask, decoded.info.width, decoded.info.height),
        normalization,
      }
    })(),
  ]))
  const primary = thresholdMasks.get(primaryThreshold)
  const thresholdStability = stabilityThresholds.map((threshold) => ({
    threshold,
    iouWithPrimary: maskIou(primary.mask, thresholdMasks.get(threshold).mask),
    boundsDriftFromPrimary: boundsDrift(primary.bounds, thresholdMasks.get(threshold).bounds),
    bounds: thresholdMasks.get(threshold).bounds,
    pixels: thresholdMasks.get(threshold).pixels,
  }))
  const minimumIou = Math.min(...thresholdStability.map((item) => item.iouWithPrimary))
  const maximumBoundsDrift = Math.max(...thresholdStability.map((item) => item.boundsDriftFromPrimary))
  if (minimumIou < MINIMUM_THRESHOLD_IOU || maximumBoundsDrift > MAXIMUM_BOUNDS_DRIFT) {
    throw new Error(`Unstable foreground extraction: ${asset.targetModelId} ${JSON.stringify({ minimumIou, maximumBoundsDrift })}`)
  }

  const cropped = cropMask(primary.mask, decoded.info.width, decoded.info.height, primary.bounds)
  const explicitOpeningTransform = clearSourceVisibleOpenings(
    cropped.alpha,
    cropped.width,
    cropped.height,
    cropped.crop,
    asset.sourceVisibleOpenings,
  )
  const initialBody = boundsForMask(cropped.alpha, cropped.width, cropped.height)
  const holeCleanup = cleanInternalHoles(
    cropped.alpha,
    cropped.width,
    cropped.height,
    initialBody.bounds,
    cameraProfile,
  )
  const body = boundsForMask(cropped.alpha, cropped.width, cropped.height)
  const holes = holeCleanup.holes
  if (!holeCleanup.profilePassed) {
    throw new Error(`Camera opening QA failed: ${asset.targetModelId} ${JSON.stringify({
      profileId: holeCleanup.profileId,
      matches: holes,
      unexpectedSignificantHoles: holeCleanup.unexpectedSignificantHoles,
    })}`)
  }

  await mkdir(outputDir, { recursive: true })
  const candidates = []
  for (const finish of FINISHES) {
    candidates.push(await encodeCandidate(
      asset.targetModelId,
      finish,
      cropped.alpha,
      cropped.width,
      cropped.height,
      outputDir,
    ))
  }
  if (new Set(candidates.map((candidate) => candidate.outputAlphaSha256)).size !== 1) {
    throw new Error(`Output pair alpha mismatch: ${asset.targetModelId}`)
  }

  return {
    modelId: asset.targetModelId,
    modelName: asset.targetModelName,
    sourceModelId: asset.sourceModelId,
    sourceKind: asset.derivedSourceKind || 'derived-official-source',
    sourceAsset: {
      path: asset.path,
      sourceUrl: asset.sourceUrl,
      productRecordUrl: asset.productRecordUrl,
      sku: asset.productRecord.sku,
      gtin: asset.productRecord.gtin,
      asin: asset.productRecord.asin,
      modelNumber: asset.productRecord.modelNumber,
      productTitle: asset.productRecord.productTitle,
      galleryImageId: asset.productRecord.galleryImageId,
      encodedSha256: asset.encodedSha256,
    },
    sourceGeometry: {
      primaryThreshold,
      stabilityThresholds,
      minimumThresholdIou: minimumIou,
      requiredMinimumThresholdIou: MINIMUM_THRESHOLD_IOU,
      maximumBoundsDrift,
      allowedMaximumBoundsDrift: MAXIMUM_BOUNDS_DRIFT,
      thresholdStability,
      primaryBounds: primary.bounds,
      primaryPixels: primary.pixels,
    },
    transform: {
      kind: 'connected-white-background-segmentation-and-alpha-only-matte-relighting',
      geometrySource: asset.geometrySource || 'official Spigen empty-case photograph',
      spatialTransform: 'source-axis crop with fixed transparent padding only',
      crop: cropped.crop,
      alphaTransform: cameraProfile.normalizeInternalTransparencyForStability
        ? 'foreground connected-component extraction at a fixed white-background threshold, then fill enclosed transparent-material regions except the profile-matched opening'
        : 'foreground connected-component extraction at a fixed white-background threshold',
      stabilityMaskTransform: cameraProfile.normalizeInternalTransparencyForStability
        ? `two-pass enclosed-region normalization followed by strict ${cameraProfile.id} opening verification`
        : 'none',
      sourceVisibleOpeningTransform: explicitOpeningTransform,
      enclosedArtifactCleanup: `fill every enclosed void except openings matching ${cameraProfile.id}`,
      sourceRgbUsed: false,
      fullyTransparentRgb: 'zeroed',
      morphologyOperations: 0,
      inferredBoundaryPixels: 0,
      inferredOpeningPixels: 0,
      edgeBlurSigmaForRgbLightingOnly: EDGE_BLUR_SIGMA,
    },
    alpha: {
      sha256: sha256(cropped.alpha),
      width: cropped.width,
      height: cropped.height,
      bounds: body.bounds,
      pixels: body.pixels,
      significantHoles: holes,
      cameraOpeningProfile: cameraProfile,
      cameraOpeningProfilePassed: holeCleanup.profilePassed,
      unexpectedSignificantHoles: holeCleanup.unexpectedSignificantHoles,
      filledArtifactComponents: holeCleanup.filledComponents,
      filledArtifactPixels: holeCleanup.filledPixels,
      upperRightCameraHolePassed: cameraProfile.id === DEFAULT_CAMERA_OPENING_PROFILE.id,
    },
    candidates,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const expectedModels = Number(argumentValue('--expected-models', DEFAULT_EXPECTED_MODELS))
  const provenance = JSON.parse(await readFile(inputPath, 'utf8'))
  const assets = provenance.assets.filter((asset) => asset.publicationEligible)
  if (!Number.isInteger(expectedModels) || assets.length !== expectedModels) {
    throw new Error(`Expected ${expectedModels} publication-eligible models, found ${assets.length}`)
  }
  const results = []
  for (const asset of assets) results.push(await deriveAsset(asset, outputDir))
  const candidates = results.flatMap((result) => result.candidates)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: provenance.source,
    summary: {
      models: results.length,
      candidates: candidates.length,
      thresholdStabilityPassed: results.filter((result) => (
        result.sourceGeometry.minimumThresholdIou >= MINIMUM_THRESHOLD_IOU
        && result.sourceGeometry.maximumBoundsDrift <= MAXIMUM_BOUNDS_DRIFT
      )).length,
      cameraOpeningQaPassed: results.filter((result) => result.alpha.cameraOpeningProfilePassed).length,
      exactPairAlpha: results.filter((result) => new Set(result.candidates.map((candidate) => candidate.outputAlphaSha256)).size === 1).length,
      automatedQaPassed: candidates.filter((candidate) => candidate.qa.passed).length,
    },
    results,
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()