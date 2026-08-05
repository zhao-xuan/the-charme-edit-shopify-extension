#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-textured-derived-plain-provenance.json'
const EXPECTED_MODELS = 3
const EDGE_BLUR_SIGMA = 8
const FINISHES = ['black', 'white']

function argumentValue(flag, fallback) {
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

function controlPoints(sourceQuantiles, targets, modelId) {
  const groups = []
  for (const [name, target] of Object.entries(targets)) {
    const input = sourceQuantiles[name]
    const previous = groups.at(-1)
    if (previous?.input === input) previous.targets.push(target)
    else groups.push({ input, targets: [target] })
  }
  return groups.map(({ input, targets: outputs }) => {
    const minimumOutput = Math.max(...outputs.map((target) => target - 1))
    const maximumOutput = Math.min(...outputs.map((target) => target + 1))
    if (minimumOutput > maximumOutput) throw new Error(`Duplicate luma cannot satisfy QA: ${modelId}`)
    return [input, Math.round((minimumOutput + maximumOutput) / 2)]
  })
}

function piecewiseMap(value, points) {
  if (value <= points[0][0]) return points[0][1]
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
  for (let source = 3, target = 0; source < data.length; source += 4, target += 1) alpha[target] = data[source]
  return alpha
}

function sourceMaterialLabel(sourceFinish) {
  if (/carbon fiber/i.test(sourceFinish)) return 'carbon-texture-neutralized'
  if (/leather/i.test(sourceFinish)) return 'leather-texture-neutralized'
  return 'textured-source-neutralized'
}

function imageStats(data, width, height) {
  const opaqueLumas = []
  const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
  let maximumChannelSpread = 0
  let visiblePixels = 0
  let fullyTransparentPixels = 0
  let nonzeroRgbFullyTransparentPixels = 0
  let gradientTotal = 0
  let gradientPairs = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]
    const pixelIndex = offset / 4
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    if (alpha > 0) {
      visiblePixels += 1
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      maximumChannelSpread = Math.max(
        maximumChannelSpread,
        Math.max(data[offset], data[offset + 1], data[offset + 2])
          - Math.min(data[offset], data[offset + 1], data[offset + 2]),
      )
    } else {
      fullyTransparentPixels += 1
      if (data[offset] || data[offset + 1] || data[offset + 2]) nonzeroRgbFullyTransparentPixels += 1
    }
    if (alpha < 250) continue
    const currentLuma = luma(data[offset], data[offset + 1], data[offset + 2])
    opaqueLumas.push(currentLuma)
    if (x + 1 < width && data[offset + 7] >= 250) {
      gradientTotal += Math.abs(currentLuma - luma(data[offset + 4], data[offset + 5], data[offset + 6]))
      gradientPairs += 1
    }
    const below = offset + width * 4
    if (y + 1 < height && data[below + 3] >= 250) {
      gradientTotal += Math.abs(currentLuma - luma(data[below], data[below + 1], data[below + 2]))
      gradientPairs += 1
    }
  }
  if (!visiblePixels || !opaqueLumas.length || !gradientPairs) throw new Error('Image has no analyzable case body')
  return {
    bounds,
    visiblePixels,
    fullyTransparentPixels,
    nonzeroRgbFullyTransparentPixels,
    opaqueLuma: quantiles(opaqueLumas),
    maximumChannelSpread,
    meanOpaqueNeighborDelta: Number((gradientTotal / gradientPairs).toFixed(6)),
    cornerAlpha: [
      data[3],
      data[(width - 1) * 4 + 3],
      data[((height - 1) * width) * 4 + 3],
      data[(height * width - 1) * 4 + 3],
    ],
  }
}

async function encodeCandidate(sourceData, outputData, info, sourceStats, finish, asset) {
  const outputBuffer = await sharp(outputData, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
  const { data: decodedData } = await sharp(outputBuffer).raw().toBuffer({ resolveWithObject: true })
  const outputStats = imageStats(decodedData, info.width, info.height)
  const sourceAlphaSha256 = sha256(alphaChannel(sourceData))
  const outputAlphaSha256 = sha256(alphaChannel(decodedData))
  const lumaPassed = finish === 'black'
    ? outputStats.opaqueLuma.p1 >= 18 && outputStats.opaqueLuma.p50 >= 30 && outputStats.opaqueLuma.p50 <= 60 && outputStats.opaqueLuma.p99 <= 85
    : outputStats.opaqueLuma.p1 >= 180 && outputStats.opaqueLuma.p50 >= 235 && outputStats.opaqueLuma.p99 <= 255
  const alphaIdentityPassed = sourceAlphaSha256 === outputAlphaSha256
  const boundsIdentityPassed = JSON.stringify(sourceStats.bounds) === JSON.stringify(outputStats.bounds)
  const cornerTransparencyPassed = outputStats.cornerAlpha.every((alpha) => alpha === 0)
  const transparentRgbClearedPassed = outputStats.nonzeroRgbFullyTransparentPixels === 0
  const neutralChannelsPassed = outputStats.maximumChannelSpread === 0
  const smoothnessPassed = outputStats.meanOpaqueNeighborDelta <= 4
  const qaPassed = alphaIdentityPassed
    && boundsIdentityPassed
    && cornerTransparencyPassed
    && transparentRgbClearedPassed
    && neutralChannelsPassed
    && smoothnessPassed
    && lumaPassed
  if (!qaPassed) throw new Error(`Derived ${finish} QA failed: ${asset.modelId} ${JSON.stringify({
    sourceAlphaSha256,
    outputAlphaSha256,
    sourceStats,
    outputStats,
  })}`)
  const outputPath = path.join(
    argumentValue('--output-dir', DEFAULT_OUTPUT_DIR),
    `${asset.modelId}-${finish}-v1-rhinoshield-${sourceMaterialLabel(asset.finish)}.png`,
  )
  await writeFile(outputPath, outputBuffer)
  return {
    finish,
    outputPath,
    outputEncodedSha256: sha256(outputBuffer),
    alphaIdentity: { sourceSha256: sourceAlphaSha256, outputSha256: outputAlphaSha256, exact: true },
    automatedQa: {
      passed: true,
      alphaIdentityPassed,
      boundsIdentityPassed,
      cornerTransparencyPassed,
      transparentRgbClearedPassed,
      neutralChannelsPassed,
      smoothnessPassed,
      lumaPassed,
    },
    outputStats,
  }
}

async function derive(asset, outputDir) {
  const sourceBuffer = await readFile(asset.path)
  const metadata = await sharp(sourceBuffer).metadata()
  if (metadata.format !== 'png' || metadata.width !== 2000 || metadata.height !== 2000 || metadata.channels !== 4 || !metadata.hasAlpha) {
    throw new Error(`Expected 2000x2000 RGBA PNG: ${asset.path}`)
  }
  const { data: sourceData, info } = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true })
  const sourceStats = imageStats(sourceData, info.width, info.height)
  const alpha = alphaChannel(sourceData)
  const rawAlpha = { raw: { width: info.width, height: info.height, channels: 1 } }
  const { data: edgeAlpha, info: edgeInfo } = await sharp(alpha, rawAlpha)
    .blur(EDGE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (edgeInfo.width !== info.width || edgeInfo.height !== info.height) throw new Error(`Blurred alpha dimensions changed: ${asset.modelId}`)
  const halfWidth = Math.max(1, (sourceStats.bounds.maxX - sourceStats.bounds.minX) / 2)
  const halfHeight = Math.max(1, (sourceStats.bounds.maxY - sourceStats.bounds.minY) / 2)
  const centerX = (sourceStats.bounds.minX + sourceStats.bounds.maxX) / 2
  const centerY = (sourceStats.bounds.minY + sourceStats.bounds.maxY) / 2
  await mkdir(outputDir, { recursive: true })
  const candidates = []
  for (const finish of FINISHES) {
    const relitData = Buffer.from(sourceData)
    for (let offset = 0; offset < relitData.length; offset += 4) {
      const pixelIndex = offset / 4
      if (sourceData[offset + 3] === 0) {
        relitData.fill(0, offset, offset + 3)
        continue
      }
      const x = pixelIndex % info.width
      const y = Math.floor(pixelIndex / info.width)
      const edgeProximity = 1 - edgeAlpha[pixelIndex * edgeInfo.channels] / 255
      const horizontalLight = 1 - Math.min(1, Math.abs(x - centerX) / halfWidth)
      const verticalLight = 1 - Math.min(1, Math.abs(y - centerY) / halfHeight)
      const neutral = finish === 'black'
        ? Math.round(30 + horizontalLight * 12 + verticalLight * 6 + edgeProximity * 18)
        : Math.round(235 + horizontalLight * 12 + verticalLight * 6)
      relitData[offset] = neutral
      relitData[offset + 1] = neutral
      relitData[offset + 2] = neutral
    }
    candidates.push(await encodeCandidate(sourceData, relitData, info, sourceStats, finish, asset))
  }
  return {
    modelId: asset.modelId,
    sourceKind: 'derived-official-source',
    sourcePath: asset.path,
    sourceUrl: asset.sourceUrl,
    sourceProductPageUrl: asset.productPageUrl,
    sourceOfficialTitle: asset.officialTitle,
    sourceSku: asset.sku,
    sourceEncodedSha256: asset.encodedSha256,
    transform: {
      kind: 'alpha-mask-only-matte-relighting',
      edgeBlurSigma: EDGE_BLUR_SIGMA,
      edgeBlurChannels: edgeInfo.channels,
      sourceRgbUsed: false,
      fullyTransparentRgb: 'zeroed',
      spatialTransform: 'none',
      alphaTransform: 'none',
    },
    sourceStats,
    candidates,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const provenance = JSON.parse(await readFile(inputPath, 'utf8'))
  const assets = provenance.assets.filter((asset) => asset.role === 'dark-structure')
  if (assets.length !== EXPECTED_MODELS) throw new Error(`Expected ${EXPECTED_MODELS} dark-structure sources, found ${assets.length}`)
  const results = []
  for (const asset of assets) results.push(await derive(asset, outputDir))
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Official same-model RhinoShield textured case PNGs with deterministic RGB-only texture neutralization',
    summary: {
      models: results.length,
      candidates: results.flatMap((result) => result.candidates).length,
      exactAlphaMatches: results.flatMap((result) => result.candidates).filter((candidate) => candidate.alphaIdentity.exact).length,
      automatedQaPassed: results.flatMap((result) => result.candidates).filter((candidate) => candidate.automatedQa.passed).length,
    },
    results,
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()