#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/samsung-icecat-case-pair-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/samsung-icecat-case-pair-derived-provenance.json'
const DEFAULT_EXPECTED_MODELS = 1
const BACKGROUND_DELTA_THRESHOLD = 3
const MINIMUM_PAIR_MASK_IOU = 0.999
const MINIMUM_SIGNIFICANT_HOLE_PIXELS = 1_000
const EDGE_BLUR_SIGMA = 8
const FINISHES = ['black', 'white']

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

function connectedForeground(data, info) {
  const pixelCount = info.width * info.height
  const candidates = new Uint8Array(pixelCount)
  let seed = -1
  let maximumDelta = -1
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * info.channels
    const delta = 255 - Math.min(data[offset], data[offset + 1], data[offset + 2])
    if (delta >= BACKGROUND_DELTA_THRESHOLD) candidates[index] = 1
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

function cropMask(mask, width, height) {
  const size = Math.min(width, height)
  const left = Math.floor((width - size) / 2)
  const top = Math.floor((height - size) / 2)
  const output = Buffer.alloc(size * size)
  for (let y = 0; y < size; y += 1) {
    const sourceStart = (y + top) * width + left
    for (let x = 0; x < size; x += 1) output[y * size + x] = mask[sourceStart + x] ? 255 : 0
  }
  return { alpha: output, size, crop: { left, top, width: size, height: size } }
}

function significantHoles(alpha, width, height) {
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
  const holes = []
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
    if (tail >= MINIMUM_SIGNIFICANT_HOLE_PIXELS) holes.push({ pixels: tail, bounds })
  }
  return holes.sort((left, right) => right.pixels - left.pixels)
}

async function encodeCandidate(modelId, finish, alpha, size, outputDir) {
  const alphaRaw = { raw: { width: size, height: size, channels: 1 } }
  const { data: edgeAlpha, info: edgeInfo } = await sharp(alpha, alphaRaw)
    .blur(EDGE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { bounds } = boundsForMask(alpha, size, size)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const halfWidth = Math.max(1, (bounds.maxX - bounds.minX) / 2)
  const halfHeight = Math.max(1, (bounds.maxY - bounds.minY) / 2)
  const outputData = Buffer.alloc(size * size * 4)
  for (let index = 0; index < alpha.length; index += 1) {
    const outputOffset = index * 4
    const pixelAlpha = alpha[index]
    if (!pixelAlpha) continue
    const x = index % size
    const y = Math.floor(index / size)
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
    raw: { width: size, height: size, channels: 4 },
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
  const decodedAlpha = Buffer.alloc(size * size)
  for (let source = 3, target = 0; source < decoded.length; source += 4, target += 1) decodedAlpha[target] = decoded[source]
  const alphaExact = decodedAlpha.equals(alpha)
  const cornerAlpha = [decodedAlpha[0], decodedAlpha[size - 1], decodedAlpha[(size - 1) * size], decodedAlpha.at(-1)]
  const qa = {
    passed: info.width === size
      && info.height === size
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
  const outputPath = path.join(outputDir, `${modelId}-${finish}-v1-samsung-silicone-alpha-matte.png`)
  await writeFile(outputPath, outputBuffer)
  return {
    finish,
    outputPath,
    outputEncodedSha256: sha256(outputBuffer),
    outputPixelSha256: sha256(decoded),
    outputAlphaSha256: sha256(decodedAlpha),
    bounds: boundsForMask(decodedAlpha, size, size).bounds,
    qa,
  }
}

async function deriveModel(model, assets, outputDir) {
  const pair = Object.fromEntries(assets.map((asset) => [asset.finish, asset]))
  if (!FINISHES.every((finish) => pair[finish])) throw new Error(`Missing source pair: ${model.modelId}`)
  const decoded = {}
  for (const finish of FINISHES) {
    const buffer = await readFile(pair[finish].path)
    if (sha256(buffer) !== pair[finish].encodedSha256) throw new Error(`Source hash mismatch: ${pair[finish].path}`)
    decoded[finish] = await sharp(buffer).raw().toBuffer({ resolveWithObject: true })
  }
  if (
    decoded.black.info.width !== decoded.white.info.width
    || decoded.black.info.height !== decoded.white.info.height
    || decoded.black.info.channels !== decoded.white.info.channels
  ) {
    throw new Error(`Source pair dimensions differ: ${model.modelId}`)
  }

  const masks = Object.fromEntries(FINISHES.map((finish) => [
    finish,
    connectedForeground(decoded[finish].data, decoded[finish].info),
  ]))
  const pairMaskIou = maskIou(masks.black.mask, masks.white.mask)
  const boundsMatch = JSON.stringify(masks.black.bounds) === JSON.stringify(masks.white.bounds)
  if (pairMaskIou < MINIMUM_PAIR_MASK_IOU || !boundsMatch) {
    throw new Error(`Source-pair geometry mismatch: ${model.modelId} ${JSON.stringify({ pairMaskIou, masks })}`)
  }

  const cropped = cropMask(masks.black.mask, decoded.black.info.width, decoded.black.info.height)
  const holes = significantHoles(cropped.alpha, cropped.size, cropped.size)
  if (holes.length !== 1) throw new Error(`Expected one camera opening: ${model.modelId}, found ${holes.length}`)
  await mkdir(outputDir, { recursive: true })
  const candidates = []
  for (const finish of FINISHES) {
    candidates.push(await encodeCandidate(model.modelId, finish, cropped.alpha, cropped.size, outputDir))
  }
  if (new Set(candidates.map((candidate) => candidate.outputAlphaSha256)).size !== 1) {
    throw new Error(`Output pair alpha mismatch: ${model.modelId}`)
  }

  return {
    modelId: model.modelId,
    modelName: model.modelName,
    sourceKind: 'derived-official-source',
    sourceAssets: FINISHES.map((finish) => ({
      finish,
      path: pair[finish].path,
      sourceUrl: pair[finish].sourceUrl,
      productRecordUrl: pair[finish].productRecordUrl,
      mpn: pair[finish].productRecord.mpn,
      gtin: pair[finish].productRecord.gtin,
      encodedSha256: pair[finish].encodedSha256,
    })),
    sourcePairGeometry: {
      threshold: BACKGROUND_DELTA_THRESHOLD,
      pairMaskIou,
      minimumPairMaskIou: MINIMUM_PAIR_MASK_IOU,
      boundsMatch,
      black: { bounds: masks.black.bounds, pixels: masks.black.pixels },
      white: { bounds: masks.white.bounds, pixels: masks.white.pixels },
    },
    transform: {
      kind: 'connected-white-background-segmentation-and-alpha-only-matte-relighting',
      geometrySource: 'official black Samsung accessory photograph',
      pairValidationSource: 'independently segmented official white Samsung accessory photograph',
      spatialTransform: 'centered square crop only',
      crop: cropped.crop,
      alphaTransform: 'foreground connected-component extraction at fixed white-background threshold',
      sourceRgbUsed: false,
      fullyTransparentRgb: 'zeroed',
      edgeBlurSigmaForRgbLightingOnly: EDGE_BLUR_SIGMA,
    },
    alpha: {
      sha256: sha256(cropped.alpha),
      bounds: boundsForMask(cropped.alpha, cropped.size, cropped.size).bounds,
      significantHoles: holes,
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
  if (!Number.isInteger(expectedModels) || provenance.models.length !== expectedModels) {
    throw new Error(`Expected ${expectedModels} models, found ${provenance.models.length}`)
  }
  const results = []
  for (const model of provenance.models) {
    results.push(await deriveModel(model, provenance.assets.filter((asset) => asset.modelId === model.modelId), outputDir))
  }
  const candidates = results.flatMap((result) => result.candidates)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Exact-model Samsung black/white accessory photographs with deterministic geometry extraction',
    summary: {
      models: results.length,
      candidates: candidates.length,
      pairGeometryPassed: results.filter((result) => result.sourcePairGeometry.pairMaskIou >= MINIMUM_PAIR_MASK_IOU).length,
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