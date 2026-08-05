#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/spigen-a17-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/spigen-a17-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/spigen-a17-case-derived-provenance.json`
const OVERLAY_PATH = `${BASE_DIR}/reviews/galaxy-a17-spigen-real-shell-geometry-overlay.png`
const OUTPUT_PATH = `${BASE_DIR}/spigen-a17-case-review.json`
const EXPECTED = {
  modelId: 'galaxy-a17',
  modelName: 'Galaxy A17',
  sourceModelId: 'galaxy-a17-5g',
  productId: '7295548358703',
  sku: 'ACS09844',
  gtin: '8800283312409',
  compatibilityText: 'Designed for Galaxy A17/A17 5G',
  modelCodes: ['SM-A175FZKNMEA', 'SM-A176BZKAEUB'],
  networks: ['4G', '5G'],
  widthMm: 77.9,
  heightMm: 164.4,
  depthMm: 7.5,
  reportedValue: '164.4 x 77.9 x 7.5',
  thresholds: [11, 12, 13],
  primaryThreshold: 12,
  openingProfile: 'galaxy-a17-camera-and-flash-single',
  openingId: 'camera-and-flash',
}
const overlayOnly = process.argv.includes('--overlay-only')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function assertExactArray(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} changed`)
}

function floodOutside(alpha, width, height) {
  const outside = new Uint8Array(alpha.length)
  const queue = new Int32Array(alpha.length)
  let head = 0
  let tail = 0
  const add = (index) => {
    if (index < 0 || index >= alpha.length || alpha[index] || outside[index]) return
    outside[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    add(x)
    add((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width)
    add(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    if (x > 0) add(index - 1)
    if (x + 1 < width) add(index + 1)
    if (index >= width) add(index - width)
    if (index + width < alpha.length) add(index + width)
  }
  return outside
}

function internalTransparentComponents(alpha, width, height, outside) {
  const visited = new Uint8Array(alpha.length)
  const queue = new Int32Array(alpha.length)
  const components = []
  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] || outside[start] || visited[start]) continue
    let head = 0
    let tail = 1
    let pixels = 0
    const bounds = { minX: width, minY: height, maxX: -1, maxY: -1 }
    queue[0] = start
    visited[start] = 1
    while (head < tail) {
      const index = queue[head]
      head += 1
      pixels += 1
      const x = index % width
      const y = Math.floor(index / width)
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor < 0 || alpha[neighbor] || outside[neighbor] || visited[neighbor]) continue
        visited[neighbor] = 1
        queue[tail] = neighbor
        tail += 1
      }
    }
    components.push({ pixels, bounds })
  }
  return components.sort((left, right) => right.pixels - left.pixels)
}

async function assertSourceAsset(asset) {
  const bytes = await readFile(asset.path)
  assert(sha256(bytes) === asset.encodedSha256, 'A17 source encoded SHA-256 changed')
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === asset.width && decoded.info.height === asset.height, 'A17 source dimensions changed')
  assert(decoded.info.channels === 3, 'A17 source channels changed')
  assert(sha256(decoded.data) === asset.decodedPixelSha256, 'A17 source pixels changed')
  return bytes
}

async function decodeCandidate(candidate, width, height) {
  const bytes = await readFile(candidate.outputPath)
  assert(sha256(bytes) === candidate.outputEncodedSha256, `${candidate.finish}: encoded SHA-256 changed`)
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === width && decoded.info.height === height && decoded.info.channels === 4, `${candidate.finish}: RGBA dimensions changed`)
  assert(sha256(decoded.data) === candidate.outputPixelSha256, `${candidate.finish}: decoded pixels changed`)
  const alpha = Buffer.alloc(width * height)
  let nonBinaryAlphaPixels = 0
  let hiddenRgbPixels = 0
  let maximumChannelSpread = 0
  let opaqueLuminanceTotal = 0
  let opaquePixels = 0
  for (let source = 0, target = 0; source < decoded.data.length; source += 4, target += 1) {
    const red = decoded.data[source]
    const green = decoded.data[source + 1]
    const blue = decoded.data[source + 2]
    const pixelAlpha = decoded.data[source + 3]
    alpha[target] = pixelAlpha
    if (pixelAlpha !== 0 && pixelAlpha !== 255) nonBinaryAlphaPixels += 1
    if (!pixelAlpha && (red || green || blue)) hiddenRgbPixels += 1
    maximumChannelSpread = Math.max(maximumChannelSpread, Math.max(red, green, blue) - Math.min(red, green, blue))
    if (pixelAlpha) {
      opaqueLuminanceTotal += red
      opaquePixels += 1
    }
  }
  assert(sha256(alpha) === candidate.outputAlphaSha256, `${candidate.finish}: alpha SHA-256 changed`)
  assert(nonBinaryAlphaPixels === 0, `${candidate.finish}: alpha is not binary`)
  assert(hiddenRgbPixels === 0, `${candidate.finish}: hidden RGB found`)
  assert(maximumChannelSpread === 0, `${candidate.finish}: RGB is not neutral`)
  const corners = [alpha[0], alpha[width - 1], alpha[(height - 1) * width], alpha.at(-1)]
  assert(corners.every((value) => value === 0), `${candidate.finish}: canvas corner is opaque`)
  return { alpha, meanOpaqueLuminance: opaqueLuminanceTotal / opaquePixels }
}

async function writeReviewOverlay(sourceBytes, crop, alpha, width, height, sourcePath) {
  const source = await sharp(sourceBytes).extract(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(source.info.width === width && source.info.height === height, 'A17 overlay crop dimensions changed')
  const outside = floodOutside(alpha, width, height)
  const overlay = Buffer.alloc(width * height * 4)
  const radius = 2
  for (let index = 0; index < alpha.length; index += 1) {
    if (!alpha[index]) continue
    const x = index % width
    const y = Math.floor(index / width)
    let touchesOutside = false
    let touchesOpening = false
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const neighborX = x + offsetX
        const neighborY = y + offsetY
        if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue
        const neighbor = neighborY * width + neighborX
        if (alpha[neighbor]) continue
        if (outside[neighbor]) touchesOutside = true
        else touchesOpening = true
      }
    }
    const target = index * 4
    if (touchesOpening) {
      overlay[target] = 0
      overlay[target + 1] = 108
      overlay[target + 2] = 255
      overlay[target + 3] = 255
    } else {
      overlay[target] = 255
      overlay[target + 1] = 32
      overlay[target + 2] = 56
      overlay[target + 3] = touchesOutside ? 255 : 48
    }
  }
  const outputBuffer = await sharp(source.data, { raw: source.info })
    .composite([{ input: overlay, raw: { width, height, channels: 4 } }])
    .png()
    .toBuffer()
  const decoded = await sharp(outputBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  await mkdir(path.dirname(OVERLAY_PATH), { recursive: true })
  await writeFile(OVERLAY_PATH, outputBuffer)
  return {
    path: OVERLAY_PATH,
    sourceFramePath: sourcePath,
    encodedSha256: sha256(outputBuffer),
    decodedPixelSha256: sha256(decoded.data),
    width,
    height,
    outerEdgeColour: '#ff2038',
    openingEdgeColour: '#006cff',
    bodyFillOpacity: 48 / 255,
    edgeRadiusPixels: radius,
    geometryUse: 'visual review only; never sampled by candidate generation',
  }
}

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

assert(sourceManifest.targetModelId === EXPECTED.modelId, 'A17 manifest model ID changed')
assert(sourceManifest.targetModelName === EXPECTED.modelName, 'A17 manifest model name changed')
assert(sourceManifest.sourceModelId === EXPECTED.sourceModelId, 'A17 source model changed')
assert(sourceManifest.product.productId === EXPECTED.productId, 'Spigen product ID changed')
assert(sourceManifest.product.sku === EXPECTED.sku, 'Spigen SKU changed')
assert(sourceManifest.product.gtin === EXPECTED.gtin, 'Spigen GTIN changed')
assert(sourceManifest.product.compatibilityMedia.alt.includes(EXPECTED.compatibilityText), 'Spigen A17 compatibility statement changed')
assertExactArray(sourceManifest.officialModels.map((model) => model.network), EXPECTED.networks, 'Samsung A17 networks')
assertExactArray(sourceManifest.officialModels.map((model) => model.modelCode), EXPECTED.modelCodes, 'Samsung A17 model codes')
for (const model of sourceManifest.officialModels) {
  assert(model.reportedValue === EXPECTED.reportedValue, `Samsung A17 ${model.network} dimensions changed`)
}

assert(sourceProvenance.assets.length === 1, 'Expected exactly one verified A17 source')
assert(sourceProvenance.summary.catalogIdentitiesVerified === 1, 'A17 catalog identity verification failed')
assert(sourceProvenance.summary.productRecordsVerified === 1, 'Spigen product verification failed')
assert(sourceProvenance.summary.compatibilityStatementsVerified === 1, 'Spigen A17 compatibility verification failed')
assert(sourceProvenance.summary.repeatedSourceFetchesByteIdentical === 2, 'Repeated Spigen image bytes differ')
assert(sourceProvenance.summary.sourceImagesPixelVerified === 2, 'Spigen evidence pixel verification failed')
assert(sourceProvenance.summary.officialModelsVerified === 2, 'Samsung A17 model verification failed')
assert(sourceProvenance.summary.officialDimensionsVerified === 2, 'Samsung A17 dimension verification failed')
assert(sourceProvenance.summary.crossNetworkDimensionsExact === 1, 'Samsung A17 4G/5G dimensions differ')
assert(sourceProvenance.summary.publicationEligible === 1, 'A17 source is not publication-eligible')
assert(derivation.results.length === 1, 'Expected exactly one A17 derivation result')
assert(derivation.summary.thresholdStabilityPassed === 1, 'A17 threshold stability failed')
assert(derivation.summary.cameraOpeningQaPassed === 1, 'A17 camera opening QA failed')
assert(derivation.summary.exactPairAlpha === 1, 'A17 Black and White alpha differs')
assert(derivation.summary.automatedQaPassed === 2, 'Both A17 candidates must pass automated QA')

const asset = sourceProvenance.assets[0]
const result = derivation.results[0]
assert(asset.targetModelId === EXPECTED.modelId && result.modelId === EXPECTED.modelId, 'Derived A17 identity changed')
assert(asset.targetModelName === EXPECTED.modelName && result.modelName === EXPECTED.modelName, 'Derived A17 name changed')
assert(asset.sourceModelId === EXPECTED.sourceModelId && result.sourceModelId === EXPECTED.sourceModelId, 'Derived A17 source model changed')
assert(asset.publicationEligible, 'Verified A17 source is not publication-eligible')
assert(asset.sourceKind === 'official-spigen-empty-case-image', 'A17 source kind changed')
assert(result.sourceKind === 'derived-official-source', 'A17 derived source kind changed')
assert(asset.catalogIdentityEvidence.verified, 'A17 live catalog identity is not verified')
assert(asset.catalogIdentityEvidence.matchedModel.name === EXPECTED.modelName, 'A17 live catalog name changed')
assert(asset.productRecordVerified && asset.repeatedFetchByteIdentical, 'Spigen A17 source verification is incomplete')
assert(asset.productRecord.productId === EXPECTED.productId, 'Verified Spigen product changed')
assert(asset.productRecord.sku === EXPECTED.sku && asset.productRecord.gtin === EXPECTED.gtin, 'Verified Spigen variant changed')
assert(asset.productRecord.compatibilityMediaAlt.includes(EXPECTED.compatibilityText), 'Verified Spigen compatibility changed')
assert(asset.onlineSourceEvidence.compatibilityEvidence.repeatedFetchByteIdentical, 'Spigen compatibility evidence bytes differ')
assert(asset.officialDimensionEvidence.crossNetworkDimensionsExact, 'A17 cross-network dimensions are not exact')
assert(asset.officialDimensionEvidence.reportedValue === EXPECTED.reportedValue, 'Verified Samsung dimension value changed')
assertExactArray(asset.officialModelEvidence.map((model) => model.network), EXPECTED.networks, 'Verified Samsung A17 networks')
assertExactArray(asset.officialModelEvidence.map((model) => model.modelCode), EXPECTED.modelCodes, 'Verified Samsung A17 model codes')
for (const model of asset.officialModelEvidence) {
  assert(model.apiStatusCode === 200, `Samsung A17 ${model.network} API status changed`)
  assert(model.reportedValueFound && model.networkIdentityVerified && model.plmDimensionsVerified, `Samsung A17 ${model.network} evidence is incomplete`)
  assert(model.reportedValue === EXPECTED.reportedValue, `Verified Samsung A17 ${model.network} dimensions changed`)
}

const sourceBytes = await assertSourceAsset(asset)
assert(result.sourceAsset.path === asset.path, 'A17 derivation source path changed')
assert(result.sourceAsset.encodedSha256 === asset.encodedSha256, 'A17 derivation source hash changed')
assert(result.sourceGeometry.primaryThreshold === EXPECTED.primaryThreshold, 'A17 primary threshold changed')
assertExactArray(result.sourceGeometry.stabilityThresholds, EXPECTED.thresholds, 'A17 threshold band')
assert(result.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'A17 minimum IoU policy changed')
assert(result.sourceGeometry.allowedMaximumBoundsDrift === 4, 'A17 bounds drift policy changed')
assert(result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou, 'A17 threshold IoU failed')
assert(result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift, 'A17 threshold bounds drift failed')
assert(result.transform.spatialTransform === 'source-axis crop with fixed transparent padding only', 'A17 spatial transform changed')
assert(result.transform.sourceVisibleOpeningTransform.clearedPixels === 0, 'A17 source opening pixels were replaced')
assert(result.transform.morphologyOperations === 0, 'A17 morphology is forbidden')
assert(result.transform.inferredBoundaryPixels === 0, 'A17 boundary pixels were inferred')
assert(result.transform.inferredOpeningPixels === 0, 'A17 opening pixels were inferred')
assert(result.transform.sourceRgbUsed === false, 'A17 source RGB leaked into neutral candidates')
assert(result.alpha.cameraOpeningProfile.id === EXPECTED.openingProfile, 'A17 opening profile changed')
assert(result.alpha.cameraOpeningProfilePassed, 'A17 exact opening profile failed')
assert(result.alpha.unexpectedSignificantHoles.length === 0, 'A17 has an unexpected significant opening')
assert(result.alpha.significantHoles.length === 1, 'A17 must have exactly one significant connected opening')
assert(result.alpha.significantHoles[0].openingId === EXPECTED.openingId, 'A17 opening identity changed')

const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), 'Expected A17 Black and White outputs')
const black = finishes.get('black')
const white = finishes.get('white')
assert(black.outputAlphaSha256 === white.outputAlphaSha256, 'A17 Black and White alpha differs')
assert(black.outputAlphaSha256 === result.alpha.sha256, 'A17 candidate alpha differs from reviewed alpha')
const [decodedBlack, decodedWhite] = await Promise.all([
  decodeCandidate(black, result.alpha.width, result.alpha.height),
  decodeCandidate(white, result.alpha.width, result.alpha.height),
])
assert(decodedBlack.alpha.equals(decodedWhite.alpha), 'A17 decoded pair alpha differs')
assert(decodedBlack.meanOpaqueLuminance < 70, 'A17 Black finish is too bright')
assert(decodedWhite.meanOpaqueLuminance > 220, 'A17 White finish is too dark')
const outside = floodOutside(decodedBlack.alpha, result.alpha.width, result.alpha.height)
const openings = internalTransparentComponents(decodedBlack.alpha, result.alpha.width, result.alpha.height, outside)
assert(openings.length === 1, `Expected one decoded A17 opening, found ${openings.length}`)
assert(openings[0].pixels === result.alpha.significantHoles[0].pixels, 'Decoded A17 opening pixels changed')
const overlayEvidence = await writeReviewOverlay(
  sourceBytes,
  result.transform.crop,
  decodedBlack.alpha,
  result.alpha.width,
  result.alpha.height,
  asset.path,
)

if (overlayOnly) {
  console.log(JSON.stringify({ overlayPath: OVERLAY_PATH, overlaySha256: overlayEvidence.encodedSha256 }, null, 2))
} else {
  const output = (candidate) => ({
    sourceKind: result.sourceKind,
    path: candidate.outputPath,
    sha256: candidate.outputEncodedSha256,
    pixelSha256: candidate.outputPixelSha256,
    alphaSha256: candidate.outputAlphaSha256,
    width: result.alpha.width,
    height: result.alpha.height,
    alphaBounds: candidate.bounds,
  })
  const review = {
    schemaVersion: 1,
    reviewedAt: new Date().toISOString(),
    reviewedBy: 'GitHub Copilot visual inspection in VS Code',
    sourceManifestPath: SOURCE_MANIFEST_PATH,
    sourceProvenancePath: SOURCE_PROVENANCE_PATH,
    derivationProvenancePath: DERIVATION_PROVENANCE_PATH,
    acceptanceCriteria: [
      'The live Shopify case catalog defines galaxy-a17 as Galaxy A17.',
      'The official Spigen product, SKU ACS09844, GTIN, inner-shell media, twice-fetched bytes, and same-SKU compatibility media identify a complete real shell designed for Galaxy A17/A17 5G.',
      'Samsung independently identifies the 4G SM-A175F and 5G SM-A176B models and reports 164.4 x 77.9 x 7.5 mm for each through both model APIs and all three PLM dimension fields.',
      'Foreground thresholds 11, 12, and 13 retain IoU of at least 0.995 with no more than four pixels of bounds drift.',
      'The source-aligned review overlay confirms the red outer contour follows the real shell and the blue contour follows the sole connected camera-and-flash opening.',
      'Source-axis cropping preserves observed geometry with zero morphology, zero inferred boundary pixels, zero inferred opening pixels, and no projective or template transform.',
      'Black and White candidates share exact binary alpha, contain zero hidden RGB, use neutral RGB channels, and retain transparent canvas corners.',
    ],
    summary: {
      sourceCandidates: 1,
      modelsVisuallyAccepted: 1,
      candidateImagesVisuallyAccepted: 2,
      modelsPublicationEligible: 1,
      modelsBlockedByCatalogIdentity: 0,
    },
    models: [{
      modelId: result.modelId,
      modelName: result.modelName,
      reviewStatus: 'accepted',
      publicationEligible: true,
      catalogIdentityEvidence: asset.catalogIdentityEvidence,
      compatibilityEvidence: asset.onlineSourceEvidence.compatibilityEvidence,
      visualReview: {
        status: 'accepted',
        criteria: 'The hash-locked source overlay confirms a complete real shell outer boundary and the sole connected camera-and-flash opening with transparent margin on every side.',
        evidence: overlayEvidence,
      },
      officialDimensions: {
        manufacturer: 'Samsung',
        widthMm: EXPECTED.widthMm,
        heightMm: EXPECTED.heightMm,
        depthMm: EXPECTED.depthMm,
        reportedLabel: 'Dimension (HxWxD, mm)',
        reportedValue: EXPECTED.reportedValue,
        reportedOrder: 'height x width x depth',
        crossNetworkDimensionsExact: true,
        directPageVerification: {
          verifiedAt: sourceProvenance.generatedAt,
          evidence: asset.officialDimensionEvidence,
        },
      },
      officialSource: {
        manufacturer: 'Spigen',
        productRecordUrl: asset.productRecordUrl,
        sourceUrl: asset.sourceUrl,
        path: asset.path,
        sha256: asset.encodedSha256,
        decodedPixelSha256: asset.decodedPixelSha256,
        productRecord: asset.productRecord,
        onlineEvidence: asset.onlineSourceEvidence,
      },
      geometryQa: {
        sourceGeometry: result.sourceGeometry,
        transform: result.transform,
        visualReviewEvidence: overlayEvidence,
        sharedAlphaSha256: result.alpha.sha256,
        significantOpenings: result.alpha.significantHoles,
        expectedOpeningCount: 1,
        openingQaPassed: result.alpha.cameraOpeningProfilePassed,
        decodedOpeningComponents: openings,
      },
      black: output(black),
      white: output(white),
    }],
    blockedModels: [],
    publicationPolicy: {
      acceptedOnly: true,
      requirePublicationEligible: true,
      requireExactPathAndSha256: true,
      requireVerifiedDimensions: true,
      shopifyStorageOnly: true,
      allowedDestinations: ['Shopify Files', 'charme_product.body_image_black', 'charme_product.body_image_white'],
      forbiddenDestinations: ['Shopify Product Media', 'Shopify variant media associations'],
    },
  }
  await writeFile(OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`)
  console.log(JSON.stringify({
    outputPath: OUTPUT_PATH,
    models: review.summary.modelsPublicationEligible,
    candidates: review.summary.candidateImagesVisuallyAccepted,
  }, null, 2))
}