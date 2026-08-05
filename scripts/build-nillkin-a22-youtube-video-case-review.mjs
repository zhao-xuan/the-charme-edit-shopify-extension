#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/nillkin-a22-youtube-video-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/nillkin-a22-youtube-video-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/nillkin-a22-youtube-video-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/nillkin-a22-youtube-video-case-review.json`
const MODEL_ID = 'galaxy-a22-5g'
const EXPECTED = {
  videoId: 'qNzLAFOzqpg',
  videoTitle: 'Haul Samsung A22 5g Cases & Covers',
  channelId: 'UCoUZLkW0V_yJ_uxduSvR79Q',
  videoSha256: '53b8547e5a3c94b1e29cd6f18da9216ca4867f5da2d8c757e4323b2b07678227',
  modelCode: 'SM-A226BZAUMEA',
  packageModelLabel: 'Samsung Galaxy A22 5G - White - 4336',
  widthMm: 76.4,
  heightMm: 167.2,
  depthMm: 9,
  reportedValue: '167.2 x 76.4 x 9.0',
  geometryFrameIds: ['empty-shell-geometry-before', 'empty-shell-geometry', 'empty-shell-geometry-after'],
  geometryTimestamps: [471, 472, 473],
  edgeThresholds: [1.5, 1.75, 2],
  primaryEdgeThreshold: 1.75,
  silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
  candidateWidth: 419,
  candidateHeight: 878,
}

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

async function assertSourceFrame(frame) {
  const bytes = await readFile(frame.path)
  assert(sha256(bytes) === frame.encodedSha256, `${frame.id}: encoded SHA-256 changed`)
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === 1920 && decoded.info.height === 1080, `${frame.id}: dimensions changed`)
  assert(sha256(decoded.data) === frame.decodedPixelSha256, `${frame.id}: decoded pixels changed`)
}

async function assertReviewOverlay(evidence) {
  const bytes = await readFile(evidence.path)
  assert(sha256(bytes) === evidence.encodedSha256, 'Visual review overlay encoded SHA-256 changed')
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === evidence.width && decoded.info.height === evidence.height, 'Visual review overlay dimensions changed')
  assert(sha256(decoded.data) === evidence.decodedPixelSha256, 'Visual review overlay pixels changed')
}

async function decodeCandidate(candidate, width, height) {
  const bytes = await readFile(candidate.outputPath)
  assert(sha256(bytes) === candidate.outputEncodedSha256, `${candidate.finish}: encoded SHA-256 changed`)
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === width && decoded.info.height === height && decoded.info.channels === 4, `${candidate.finish}: RGBA dimensions changed`)
  assert(sha256(decoded.data) === candidate.outputPixelSha256, `${candidate.finish}: decoded pixels changed`)
  const alpha = Buffer.alloc(width * height)
  let hiddenRgbPixels = 0
  let nonBinaryAlphaPixels = 0
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

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

assert(sourceManifest.targetModelId === MODEL_ID && sourceManifest.sourceModelId === MODEL_ID, 'A22 source identity changed')
assert(sourceManifest.video.videoId === EXPECTED.videoId, 'YouTube video ID changed')
assert(sourceManifest.video.title === EXPECTED.videoTitle, 'YouTube video title changed')
assert(sourceManifest.video.channelId === EXPECTED.channelId, 'YouTube channel changed')
assert(sourceManifest.video.download.expectedSha256 === EXPECTED.videoSha256, 'Source video SHA-256 changed')
assert(sourceManifest.video.download.width === 1920 && sourceManifest.video.download.height === 1080, 'Source video dimensions changed')
assert(sourceManifest.video.identityChain.packageModelLabel === EXPECTED.packageModelLabel, 'Nillkin package model label changed')
assert(sourceManifest.officialDimension.modelCode === EXPECTED.modelCode, 'Samsung model code changed')
assert(sourceManifest.officialDimension.normalizedValue === EXPECTED.reportedValue, 'Samsung dimensions changed')

assert(sourceProvenance.assets.length === 1, 'Expected exactly one verified A22 source')
assert(sourceProvenance.summary.onlineVideoRecordsVerified === 1, 'Online video record verification failed')
assert(sourceProvenance.summary.sourceVideosByteVerified === 1, 'Source video byte verification failed')
assert(sourceProvenance.summary.realFramesPixelVerified === 6, 'All six real frames must be pixel verified')
assert(sourceProvenance.summary.identityChainFramesVerified === 3, 'Identity chain frame verification failed')
assert(sourceProvenance.summary.geometryFramesVerified === 3, 'Geometry frame verification failed')
assert(sourceProvenance.summary.officialDimensionsVerified === 1, 'Samsung dimension verification failed')
assert(derivation.results.length === 1, 'Expected exactly one A22 derivation result')
assert(derivation.summary.sourceThresholdStabilityPassed === 1, 'Source threshold stability failed')
assert(derivation.summary.temporalGeometryStabilityPassed === 1, 'Temporal geometry stability failed')
assert(derivation.summary.rectifiedThresholdStabilityPassed === 1, 'Rectified threshold stability failed')
assert(derivation.summary.exactOpeningTopologyPassed === 1, 'Exact opening topology failed')
assert(derivation.summary.exactPairAlpha === 1, 'Black and White alpha differs')
assert(derivation.summary.automatedQaPassed === 2, 'Both candidates must pass automated QA')

const asset = sourceProvenance.assets[0]
const result = derivation.results[0]
assert(asset.targetModelId === MODEL_ID && result.modelId === MODEL_ID, 'Derived A22 identity changed')
assert(asset.publicationEligible, 'A22 source is not publication-eligible')
assert(asset.sourceKind === 'verified-youtube-real-product-video-frame', 'Source kind changed')
assert(result.sourceKind === 'derived-verified-retail-source', 'Derived source kind changed')
assert(asset.videoEvidence.structuredMetadataVerified, 'YouTube structured metadata is not verified')
assert(asset.videoEvidence.oembedHttpStatus === 200, 'YouTube oEmbed verification failed')
assert(asset.videoFileEvidence.sha256 === EXPECTED.videoSha256, 'Verified video bytes changed')
assert(asset.identityChain.packageModelLabel === EXPECTED.packageModelLabel, 'Verified package label changed')
assert(asset.officialDimensionEvidence.modelCode === EXPECTED.modelCode, 'Verified Samsung model code changed')
assert(asset.officialDimensionEvidence.normalizedValue === EXPECTED.reportedValue, 'Verified Samsung dimensions changed')
assert(asset.officialDimensionEvidence.sourcePageHttpStatus === 200, 'Samsung source page verification failed')
assert(asset.officialDimensionEvidence.apiHttpStatus === 200 && asset.officialDimensionEvidence.apiStatusCode === 200, 'Samsung model API verification failed')
assert(asset.officialDimensionEvidence.reportedValueFound && asset.officialDimensionEvidence.plmDimensionsVerified, 'Samsung dimension fields are incomplete')

assert(asset.frames.length === 6, 'Expected six locked A22 frames')
await Promise.all(asset.frames.map(assertSourceFrame))
const geometryFrames = asset.frames.filter((frame) => frame.id.startsWith('empty-shell-geometry'))
assertExactArray(geometryFrames.map((frame) => frame.id), EXPECTED.geometryFrameIds, 'Geometry frame IDs')
assertExactArray(geometryFrames.map((frame) => frame.timestampSeconds), EXPECTED.geometryTimestamps, 'Geometry frame timestamps')

const geometry = result.sourceGeometry
assert(geometry.method === 'closed-gradient-paths-in-fixed-narrow-corridors-over-pixel-locked-real-video-frames', 'Physical edge method changed')
assert(geometry.primaryThreshold === EXPECTED.primaryEdgeThreshold, 'Primary edge threshold changed')
assertExactArray(geometry.stabilityThresholds, EXPECTED.edgeThresholds, 'Edge threshold band')
assert(geometry.requiredMinimumThresholdIou === 0.995, 'Minimum IoU policy changed')
assert(geometry.allowedMaximumBoundsDrift === 4, 'Maximum bounds drift policy changed')
assert(geometry.minimumThresholdIou >= geometry.requiredMinimumThresholdIou, 'Threshold IoU failed')
assert(geometry.maximumThresholdBoundsDrift <= geometry.allowedMaximumBoundsDrift, 'Threshold bounds drift failed')
assert(geometry.minimumTemporalIou >= geometry.requiredMinimumThresholdIou, 'Temporal IoU failed')
assert(geometry.maximumTemporalBoundsDrift <= geometry.allowedMaximumBoundsDrift, 'Temporal bounds drift failed')
assert(geometry.thresholdStability.every((item) => item.outerDiagnostics.minimumGradientResponse >= item.threshold), 'An outer path left its physical-edge threshold')
assert(geometry.thresholdStability.every((item) => item.openingDiagnostics.minimumGradientResponse >= item.threshold), 'An opening path left its physical-edge threshold')
assert(result.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling changed')
assert(Object.values(result.rectification.outerLineFits).every((fit) => fit.rms <= 3), 'An observed outer edge fit is unstable')
assert(result.transform.morphologyOperations === 0, 'Morphology is forbidden')
assert(result.transform.inferredBoundaryPixels === 0, 'Boundary pixels were inferred')
assert(result.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(result.transform.sourceRgbUsed === false, 'Source RGB must not leak into neutral candidates')
assert(result.alpha.expectedOpeningCount === 1 && result.alpha.openingQaPassed, 'Exact one-opening QA failed')
assert(result.alpha.significantOpenings.length === 1 && result.alpha.significantOpenings[0].openingId === 'camera', 'Reviewed camera opening changed')
assert(result.alpha.width === EXPECTED.candidateWidth && result.alpha.height === EXPECTED.candidateHeight, 'Candidate dimensions changed')

assert(result.visualReviewEvidence.geometryUse === 'visual review only; never sampled by candidate generation', 'Visual overlay geometry role changed')
assert(result.visualReviewEvidence.sourceFramePath === asset.path, 'Visual overlay source frame changed')
assert(result.visualReviewEvidence.outerEdgeColour === '#ff2038', 'Outer review edge colour changed')
assert(result.visualReviewEvidence.openingEdgeColour === '#006cff', 'Opening review edge colour changed')
await assertReviewOverlay(result.visualReviewEvidence)

const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), 'Expected Black and White outputs')
const black = finishes.get('black')
const white = finishes.get('white')
assert(black.outputAlphaSha256 === white.outputAlphaSha256, 'Black and White alpha differs')
assert(black.outputAlphaSha256 === result.alpha.sha256, 'Candidate alpha differs from reviewed alpha')
for (const candidate of [black, white]) {
  assert(candidate.qa.passed && candidate.qa.alphaExact, `${candidate.finish}: automated QA failed`)
  assert(candidate.qa.hiddenRgbPixels === 0 && candidate.qa.maximumChannelSpread === 0, `${candidate.finish}: RGB QA failed`)
}
const [decodedBlack, decodedWhite] = await Promise.all([
  decodeCandidate(black, result.alpha.width, result.alpha.height),
  decodeCandidate(white, result.alpha.width, result.alpha.height),
])
assert(decodedBlack.alpha.equals(decodedWhite.alpha), 'Black and White decoded alpha differs')
assert(decodedBlack.meanOpaqueLuminance < 70, 'Black finish is too bright')
assert(decodedWhite.meanOpaqueLuminance > 220, 'White finish is too dark')

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
    'The continuous real YouTube video identifies Galaxy A22 5G, shows the Nillkin package label, unboxes the same shell, installs it, and ends on the unobstructed empty shell.',
    'All six 1920x1080 real frames and the source video are byte or pixel locked; the 471, 472, and 473-second frames independently stabilize the complete physical shell geometry.',
    'Samsung identifies SM-A226BZAUMEA and reports 167.2 x 76.4 x 9.0 mm through the first-party model page and API.',
    'The complete outer edge and sole physical camera opening remain stable across thresholds 1.5, 1.75, and 2.0 with IoU of at least 0.995 and at most four pixels of bounds drift.',
    'The hash-locked red and blue source overlay was visually inspected: the traced paths follow the real shell outer edge and camera opening, including the physical right-side structures and weak bottom edge.',
    'One projective transform preserves the directly traced binary alpha without morphology, template boundaries, inferred openings, or inferred boundary pixels.',
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
    catalogIdentityEvidence: asset.eligibilityReason,
    visualReview: {
      status: 'accepted',
      criteria: 'The hash-locked source overlay confirms that the red outer contour follows the real Nillkin shell edge, the blue contour follows its sole physical camera opening, and the rectified candidates preserve transparent margin on every side.',
      evidence: result.visualReviewEvidence,
    },
    officialDimensions: {
      manufacturer: 'Samsung',
      widthMm: EXPECTED.widthMm,
      heightMm: EXPECTED.heightMm,
      depthMm: EXPECTED.depthMm,
      reportedLabel: 'Dimension (HxWxD, mm)',
      reportedValue: EXPECTED.reportedValue,
      reportedOrder: 'height x width x depth',
      directPageVerification: {
        verifiedAt: sourceProvenance.generatedAt,
        evidence: asset.officialDimensionEvidence,
      },
    },
    verifiedRetailSource: {
      manufacturer: 'Nillkin',
      provider: sourceManifest.video.provider,
      videoId: sourceManifest.video.videoId,
      videoUrl: asset.sourceUrl,
      videoTitle: asset.videoEvidence.title,
      channel: asset.videoEvidence.channel,
      identityChain: asset.identityChain,
      videoEvidence: asset.videoEvidence,
      videoFileEvidence: asset.videoFileEvidence,
      geometryFrames: result.sourceAssets,
    },
    geometryQa: {
      sourceGeometry: result.sourceGeometry,
      rectification: result.rectification,
      transform: result.transform,
      visualReviewEvidence: result.visualReviewEvidence,
      sharedAlphaSha256: result.alpha.sha256,
      significantOpenings: result.alpha.significantOpenings,
      expectedOpeningCount: result.alpha.expectedOpeningCount,
      openingQaPassed: result.alpha.openingQaPassed,
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