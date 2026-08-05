#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-android-asset-provenance.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/candidates'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/rhinoshield-derived-white-provenance.json'
const BODY_LUMA_FLOOR = 150
const TARGET_BODY_LUMA = { p5: 235, p50: 247, p95: 251 }
const PAIRED_ALPHA_THRESHOLD = 128
const MINIMUM_PAIRED_ALPHA_IOU = 0.9995

function argumentValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function alphaChannel(data) {
  const alpha = Buffer.allocUnsafe(data.length / 4)
  for (let sourceOffset = 3, targetOffset = 0; sourceOffset < data.length; sourceOffset += 4, targetOffset += 1) {
    alpha[targetOffset] = data[sourceOffset]
  }
  return alpha
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
}

function luma(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
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

function alphaStats(data, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let visiblePixelCount = 0
  const edgeCounts = { top: 0, right: 0, bottom: 0, left: 0 }
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue
    const pixelIndex = offset / 4
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    visiblePixelCount += 1
    if (y === 0) edgeCounts.top += 1
    if (x === width - 1) edgeCounts.right += 1
    if (y === height - 1) edgeCounts.bottom += 1
    if (x === 0) edgeCounts.left += 1
  }
  return {
    bounds: { minX, minY, maxX, maxY },
    visiblePixelCount,
    edgeCounts,
    cornerAlpha: [
      data[3],
      data[(width - 1) * 4 + 3],
      data[((height - 1) * width) * 4 + 3],
      data[(height * width - 1) * 4 + 3],
    ],
  }
}

function pairedAlphaGeometry(sourceData, pairedData, width, height) {
  const sourceBounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
  const pairedBounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
  let sourcePixelCount = 0
  let pairedPixelCount = 0
  let intersectionPixelCount = 0
  let unionPixelCount = 0
  let differingPixelCount = 0
  let changedAlphaPixels = 0
  let maximumAlphaDelta = 0
  let totalAlphaDelta = 0
  for (let offset = 0; offset < sourceData.length; offset += 4) {
    const sourceAlpha = sourceData[offset + 3]
    const pairedAlpha = pairedData[offset + 3]
    const alphaDelta = Math.abs(sourceAlpha - pairedAlpha)
    if (alphaDelta) changedAlphaPixels += 1
    maximumAlphaDelta = Math.max(maximumAlphaDelta, alphaDelta)
    totalAlphaDelta += alphaDelta

    const sourceVisible = sourceAlpha >= PAIRED_ALPHA_THRESHOLD
    const pairedVisible = pairedAlpha >= PAIRED_ALPHA_THRESHOLD
    const pixelIndex = offset / 4
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    if (sourceVisible) {
      sourcePixelCount += 1
      sourceBounds.minX = Math.min(sourceBounds.minX, x)
      sourceBounds.minY = Math.min(sourceBounds.minY, y)
      sourceBounds.maxX = Math.max(sourceBounds.maxX, x)
      sourceBounds.maxY = Math.max(sourceBounds.maxY, y)
    }
    if (pairedVisible) {
      pairedPixelCount += 1
      pairedBounds.minX = Math.min(pairedBounds.minX, x)
      pairedBounds.minY = Math.min(pairedBounds.minY, y)
      pairedBounds.maxX = Math.max(pairedBounds.maxX, x)
      pairedBounds.maxY = Math.max(pairedBounds.maxY, y)
    }
    if (sourceVisible && pairedVisible) intersectionPixelCount += 1
    if (sourceVisible || pairedVisible) unionPixelCount += 1
    if (sourceVisible !== pairedVisible) differingPixelCount += 1
  }
  if (!sourcePixelCount || !pairedPixelCount || !unionPixelCount) {
    throw new Error('Paired images have no analyzable core silhouette')
  }
  return {
    alphaThreshold: PAIRED_ALPHA_THRESHOLD,
    minimumIoU: MINIMUM_PAIRED_ALPHA_IOU,
    sourceBounds,
    pairedBounds,
    sourcePixelCount,
    pairedPixelCount,
    intersectionPixelCount,
    unionPixelCount,
    differingPixelCount,
    intersectionOverUnion: Number((intersectionPixelCount / unionPixelCount).toFixed(9)),
    changedAlphaPixels,
    maximumAlphaDelta,
    meanAlphaDelta: Number((totalAlphaDelta / (width * height)).toFixed(6)),
  }
}

function boundsMatch(left, right) {
  return left.minX === right.minX
    && left.minY === right.minY
    && left.maxX === right.maxX
    && left.maxY === right.maxY
}

function colorStats(data, sourceData = null) {
  const bodyLumas = []
  const opaqueLumas = []
  const darkLumas = []
  let maximumChannelSpread = 0
  let changedAlphaPixels = 0
  let nonzeroRgbFullyTransparentPixels = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]
    if (sourceData && alpha !== sourceData[offset + 3]) changedAlphaPixels += 1
    if (alpha === 0 && (data[offset] || data[offset + 1] || data[offset + 2])) {
      nonzeroRgbFullyTransparentPixels += 1
    }
    if (alpha < 250) continue
    const pixelLuma = luma(data[offset], data[offset + 1], data[offset + 2])
    opaqueLumas.push(pixelLuma)
    if (pixelLuma >= BODY_LUMA_FLOOR) bodyLumas.push(pixelLuma)
    if (sourceData) {
      const sourceLuma = luma(sourceData[offset], sourceData[offset + 1], sourceData[offset + 2])
      if (sourceLuma < 120) darkLumas.push(pixelLuma)
    }
    maximumChannelSpread = Math.max(
      maximumChannelSpread,
      Math.max(data[offset], data[offset + 1], data[offset + 2])
        - Math.min(data[offset], data[offset + 1], data[offset + 2]),
    )
  }
  if (!bodyLumas.length || !opaqueLumas.length) throw new Error('Image has no analyzable opaque body pixels')
  bodyLumas.sort((left, right) => left - right)
  opaqueLumas.sort((left, right) => left - right)
  darkLumas.sort((left, right) => left - right)
  const quantiles = (values) => ({
    p5: Number(percentile(values, 0.05).toFixed(3)),
    p50: Number(percentile(values, 0.5).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
  })
  return {
    bodyPixelCount: bodyLumas.length,
    bodyLuma: quantiles(bodyLumas),
    opaqueLuma: quantiles(opaqueLumas),
    darkStructurePixelCount: darkLumas.length,
    darkStructureLuma: darkLumas.length ? quantiles(darkLumas) : null,
    maximumChannelSpread,
    changedAlphaPixels,
    nonzeroRgbFullyTransparentPixels,
  }
}

async function derive(asset, pairedBlack, outputDir) {
  const sourceBuffer = await readFile(asset.path)
  const metadata = await sharp(sourceBuffer).metadata()
  if (metadata.format !== 'png' || metadata.channels !== 4 || !metadata.hasAlpha) {
    throw new Error(`Expected RGBA PNG source: ${asset.path}`)
  }
  const { data: sourceData, info } = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true })
  const pairedBlackBuffer = await readFile(pairedBlack.path)
  const pairedBlackMetadata = await sharp(pairedBlackBuffer).metadata()
  const { data: pairedBlackData, info: pairedBlackInfo } = await sharp(pairedBlackBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    pairedBlackMetadata.format !== 'png'
    || pairedBlackMetadata.channels !== 4
    || !pairedBlackMetadata.hasAlpha
    || pairedBlackInfo.width !== info.width
    || pairedBlackInfo.height !== info.height
    || pairedBlackInfo.channels !== info.channels
  ) {
    throw new Error(`Paired Black source geometry differs: ${asset.modelId}`)
  }
  const sourceAlphaBytes = alphaChannel(sourceData)
  const pairedBlackAlphaBytes = alphaChannel(pairedBlackData)
  const pairedGeometry = pairedAlphaGeometry(sourceData, pairedBlackData, info.width, info.height)
  if (
    !boundsMatch(pairedGeometry.sourceBounds, pairedGeometry.pairedBounds)
    || pairedGeometry.intersectionOverUnion < MINIMUM_PAIRED_ALPHA_IOU
  ) {
    throw new Error(`Paired Black/White core geometry differs: ${asset.modelId}`)
  }
  const sourceColors = colorStats(sourceData)
  const sourcePoints = [
    [0, 0],
    [BODY_LUMA_FLOOR - 1, BODY_LUMA_FLOOR - 1],
    [sourceColors.bodyLuma.p5, TARGET_BODY_LUMA.p5],
    [sourceColors.bodyLuma.p50, TARGET_BODY_LUMA.p50],
    [sourceColors.bodyLuma.p95, TARGET_BODY_LUMA.p95],
    [255, 255],
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
  const outputRaw = await sharp(outputBuffer).raw().toBuffer()
  const sourceAlphaSha256 = sha256(sourceAlphaBytes)
  const outputAlphaSha256 = sha256(alphaChannel(outputRaw))
  if (sourceAlphaSha256 !== outputAlphaSha256) throw new Error(`Alpha changed: ${asset.modelId}`)

  const sourceAlpha = alphaStats(sourceData, info.width, info.height)
  const outputAlpha = alphaStats(outputRaw, info.width, info.height)
  const outputColors = colorStats(outputRaw, sourceData)
  if (
    outputColors.changedAlphaPixels !== 0
    || outputColors.nonzeroRgbFullyTransparentPixels !== 0
    || outputAlpha.cornerAlpha.some(Boolean)
    || Object.values(outputAlpha.edgeCounts).some(Boolean)
    || outputColors.maximumChannelSpread !== 0
    || outputColors.bodyLuma.p5 < TARGET_BODY_LUMA.p5 - 1
    || outputColors.bodyLuma.p50 < TARGET_BODY_LUMA.p50 - 1
    || outputColors.bodyLuma.p95 < TARGET_BODY_LUMA.p95 - 1
    || (outputColors.darkStructureLuma?.p95 ?? 0) > 150
  ) {
    throw new Error(`Derived White QA failed: ${asset.modelId}`)
  }

  const outputPath = path.join(outputDir, `${asset.modelId}-white-v1-rhinoshield-shell-beige-neutralized.png`)
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, outputBuffer)
  return {
    modelId: asset.modelId,
    finish: 'white',
    candidateVersion: 'derived-official-source',
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
      kind: 'global-monotonic-luminance-neutralization',
      spatialTransform: 'none',
      fullyTransparentRgb: 'zeroed',
      bodyLumaFloor: BODY_LUMA_FLOOR,
      sourceControlPoints: sourcePoints,
      targetBodyLuma: TARGET_BODY_LUMA,
    },
    alphaIdentity: {
      sourceSha256: sourceAlphaSha256,
      outputSha256: outputAlphaSha256,
      changedPixels: outputColors.changedAlphaPixels,
      source: sourceAlpha,
      output: outputAlpha,
    },
    pairedBlackConsistency: {
      sourcePath: pairedBlack.path,
      sourceUrl: pairedBlack.sourceUrl,
      sourceOfficialTitle: pairedBlack.officialTitle,
      sourceSku: pairedBlack.sku,
      sourceEncodedSha256: pairedBlack.encodedSha256,
      alphaSha256: sha256(pairedBlackAlphaBytes),
      exactAlphaIdentity: sourceAlphaBytes.equals(pairedBlackAlphaBytes),
      coreGeometry: pairedGeometry,
      alpha: alphaStats(pairedBlackData, pairedBlackInfo.width, pairedBlackInfo.height),
    },
    sourceColors,
    outputColors,
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const modelId = argumentValue('--model-id')
  const deriveAll = process.argv.includes('--all')
  if ((!modelId && !deriveAll) || (modelId && deriveAll)) {
    throw new Error('Pass exactly one of --model-id <id> or --all')
  }

  const provenance = JSON.parse(await readFile(inputPath, 'utf8'))
  const sources = provenance.assets.filter((asset) => asset.role === 'light-neutral')
  const pairedBlackByModel = new Map(
    provenance.assets
      .filter((asset) => asset.role === 'black')
      .map((asset) => [asset.modelId, asset]),
  )
  const selected = deriveAll ? sources : sources.filter((asset) => asset.modelId === modelId)
  if (!selected.length) throw new Error(`No verified light-neutral source found${modelId ? ` for ${modelId}` : ''}`)

  const results = []
  for (const asset of selected) {
    const pairedBlack = pairedBlackByModel.get(asset.modelId)
    if (!pairedBlack) throw new Error(`No verified paired Black source found for ${asset.modelId}`)
    results.push(await derive(asset, pairedBlack, outputDir))
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    summary: { derived: results.length },
    results,
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary, outputs: results.map((result) => result.outputPath) }, null, 2))
}

await main()