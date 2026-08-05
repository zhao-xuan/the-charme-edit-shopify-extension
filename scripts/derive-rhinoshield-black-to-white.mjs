#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_AUDIT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-source-audit-after-batch-1.json'
const DEFAULT_PROVENANCE = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-black-derived-white-provenance.json'
const EXPECTED_MODELS = 12
const TARGET_LUMA = { p1: 160, p5: 220, p50: 246, p95: 252, p99: 254 }

function argumentValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function luma(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
}

function quantiles(values) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) throw new Error('Image has no analyzable opaque pixels')
  return Object.fromEntries([
    ['p1', 0.01],
    ['p5', 0.05],
    ['p50', 0.5],
    ['p95', 0.95],
    ['p99', 0.99],
  ].map(([name, fraction]) => [name, Number(percentile(sorted, fraction).toFixed(3))]))
}

function quantileControlPoints(sourceLuma, modelId) {
  const groups = []
  for (const [name, target] of Object.entries(TARGET_LUMA)) {
    const input = sourceLuma[name]
    const previous = groups.at(-1)
    if (previous?.input === input) previous.targets.push(target)
    else groups.push({ input, targets: [target] })
  }
  return groups.map(({ input, targets }) => {
    const minimumOutput = Math.max(...targets.map((target) => target - 1))
    const maximumOutput = Math.min(...targets.map((target) => target + 1))
    if (minimumOutput > maximumOutput) {
      throw new Error(`Duplicate source luma cannot satisfy target QA: ${modelId}`)
    }
    return [input, Math.round((minimumOutput + maximumOutput) / 2)]
  })
}

function piecewiseMap(value, points) {
  for (let index = 1; index < points.length; index += 1) {
    const [rightInput, rightOutput] = points[index]
    if (value <= rightInput) {
      const [leftInput, leftOutput] = points[index - 1]
      const fraction = (value - leftInput) / (rightInput - leftInput)
      return leftOutput + fraction * (rightOutput - leftOutput)
    }
  }
  return points.at(-1)[1]
}

function alphaChannel(data) {
  const alpha = Buffer.allocUnsafe(data.length / 4)
  for (let source = 3, target = 0; source < data.length; source += 4, target += 1) {
    alpha[target] = data[source]
  }
  return alpha
}

function imageStats(data, width, height) {
  const opaqueLumas = []
  let visiblePixels = 0
  let transparentPixels = 0
  let nonzeroRgbFullyTransparentPixels = 0
  let maximumChannelSpread = 0
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
  const edgePixels = { top: 0, right: 0, bottom: 0, left: 0 }
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]
    const pixelIndex = offset / 4
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    if (alpha === 0) {
      transparentPixels += 1
      if (data[offset] || data[offset + 1] || data[offset + 2]) nonzeroRgbFullyTransparentPixels += 1
    }
    if (alpha > 0) {
      visiblePixels += 1
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      if (y === 0) edgePixels.top += 1
      if (x === width - 1) edgePixels.right += 1
      if (y === height - 1) edgePixels.bottom += 1
      if (x === 0) edgePixels.left += 1
      maximumChannelSpread = Math.max(
        maximumChannelSpread,
        Math.max(data[offset], data[offset + 1], data[offset + 2])
          - Math.min(data[offset], data[offset + 1], data[offset + 2]),
      )
    }
    if (alpha >= 250) opaqueLumas.push(luma(data[offset], data[offset + 1], data[offset + 2]))
  }
  return {
    visiblePixels,
    transparentPixels,
    nonzeroRgbFullyTransparentPixels,
    bounds,
    edgePixels,
    cornerAlpha: [
      data[3],
      data[(width - 1) * 4 + 3],
      data[((height - 1) * width) * 4 + 3],
      data[(height * width - 1) * 4 + 3],
    ],
    opaqueLuma: quantiles(opaqueLumas),
    maximumChannelSpread,
  }
}

async function derive(asset, outputDir) {
  const sourceBuffer = await readFile(asset.path)
  const metadata = await sharp(sourceBuffer).metadata()
  if (
    metadata.format !== 'png'
    || metadata.width !== 2000
    || metadata.height !== 2000
    || metadata.channels !== 4
    || !metadata.hasAlpha
  ) throw new Error(`Expected 2000x2000 RGBA PNG: ${asset.path}`)

  const { data: sourceData, info } = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true })
  const sourceStats = imageStats(sourceData, info.width, info.height)
  const quantilePoints = quantileControlPoints(sourceStats.opaqueLuma, asset.modelId)
  const sourcePoints = [
    ...(quantilePoints[0][0] > 0 ? [[0, 48]] : []),
    ...quantilePoints,
    ...(quantilePoints.at(-1)[0] < 255 ? [[255, 255]] : []),
  ]
  for (let index = 1; index < sourcePoints.length; index += 1) {
    if (sourcePoints[index][0] <= sourcePoints[index - 1][0]) {
      throw new Error(`Source luma control points are not strictly increasing: ${asset.modelId}`)
    }
  }

  const outputData = Buffer.from(sourceData)
  for (let offset = 0; offset < outputData.length; offset += 4) {
    if (sourceData[offset + 3] === 0) {
      outputData.fill(0, offset, offset + 3)
      continue
    }
    const sourceLuma = luma(sourceData[offset], sourceData[offset + 1], sourceData[offset + 2])
    const neutral = Math.max(0, Math.min(255, Math.round(piecewiseMap(sourceLuma, sourcePoints))))
    outputData[offset] = neutral
    outputData[offset + 1] = neutral
    outputData[offset + 2] = neutral
  }

  const outputBuffer = await sharp(outputData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
  const { data: encodedOutputData } = await sharp(outputBuffer).raw().toBuffer({ resolveWithObject: true })
  const sourceAlphaSha256 = sha256(alphaChannel(sourceData))
  const outputAlphaSha256 = sha256(alphaChannel(encodedOutputData))
  const outputStats = imageStats(encodedOutputData, info.width, info.height)
  if (
    sourceAlphaSha256 !== outputAlphaSha256
    || JSON.stringify(sourceStats.bounds) !== JSON.stringify(outputStats.bounds)
    || outputStats.cornerAlpha.some(Boolean)
    || Object.values(outputStats.edgePixels).some(Boolean)
    || outputStats.nonzeroRgbFullyTransparentPixels !== 0
    || outputStats.maximumChannelSpread !== 0
    || Object.entries(TARGET_LUMA).some(([key, target]) => Math.abs(outputStats.opaqueLuma[key] - target) > 1)
  ) throw new Error(`Derived White QA failed: ${asset.modelId}`)

  const outputPath = path.join(outputDir, `${asset.modelId}-white-v1-rhinoshield-black-luminance-remap.png`)
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, outputBuffer)
  return {
    modelId: asset.modelId,
    finish: 'white',
    candidateVersion: 'derived-official-black-source',
    sourceKind: 'derived-official-source',
    sourcePath: asset.path,
    sourceUrl: asset.sourceUrl,
    sourceProductPageUrl: asset.productPageUrl,
    sourceOfficialTitle: asset.officialTitle,
    sourceSku: asset.sku,
    sourceEncodedSha256: asset.encodedSha256,
    outputPath,
    outputEncodedSha256: sha256(outputBuffer),
    width: info.width,
    height: info.height,
    transform: {
      kind: 'global-monotonic-luminance-remap',
      spatialTransform: 'none',
      alphaTransform: 'none',
      fullyTransparentRgb: 'zeroed',
      sourceControlPoints: sourcePoints,
      targetOpaqueLuma: TARGET_LUMA,
    },
    alphaIdentity: {
      sourceSha256: sourceAlphaSha256,
      outputSha256: outputAlphaSha256,
      exact: sourceAlphaSha256 === outputAlphaSha256,
    },
    sourceStats,
    outputStats,
  }
}

async function main() {
  const auditPath = argumentValue('--audit', DEFAULT_AUDIT)
  const provenancePath = argumentValue('--provenance', DEFAULT_PROVENANCE)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const modelId = argumentValue('--model-id')
  const expectedModels = Number(argumentValue('--expected-models', EXPECTED_MODELS))
  const category = argumentValue('--category', 'black-only')
  const deriveAll = process.argv.includes('--all')
  if ((!modelId && !deriveAll) || (modelId && deriveAll)) {
    throw new Error('Pass exactly one of --model-id <id> or --all')
  }
  if (!Number.isInteger(expectedModels) || expectedModels < 1) {
    throw new Error('--expected-models must be a positive integer')
  }
  if (!['black-only', 'black-and-light-neutral', 'black-and-white'].includes(category)) {
    throw new Error('--category must identify an audit category with a verified plain Black source')
  }

  const audit = JSON.parse(await readFile(auditPath, 'utf8'))
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
  const targetIds = audit.categories?.[category] || []
  if (targetIds.length !== expectedModels) {
    throw new Error(`Expected ${expectedModels} ${category} targets, found ${targetIds.length}`)
  }
  const assetsByModel = new Map(
    provenance.assets
      .filter((asset) => asset.role === 'black')
      .map((asset) => [asset.modelId, asset]),
  )
  const selectedIds = deriveAll ? targetIds : targetIds.filter((id) => id === modelId)
  if (!selectedIds.length) throw new Error(`No verified black-only source found for ${modelId}`)
  const results = []
  for (const id of selectedIds) {
    const asset = assetsByModel.get(id)
    if (!asset) throw new Error(`No downloaded official Black source found for ${id}`)
    results.push(await derive(asset, outputDir))
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    auditPath,
    provenancePath,
    source: 'Official same-model RhinoShield plain Black product PNGs with deterministic RGB-only White derivation',
    summary: { derived: results.length, exactAlphaMatches: results.filter((result) => result.alphaIdentity.exact).length },
    results,
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary, outputs: results.map((result) => result.outputPath) }, null, 2))
}

await main()