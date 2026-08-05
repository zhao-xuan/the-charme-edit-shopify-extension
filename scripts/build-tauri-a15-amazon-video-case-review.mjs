#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/tauri-a15-amazon-video-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/tauri-a15-amazon-video-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/tauri-a15-amazon-video-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/tauri-a15-amazon-video-case-review.json`
const MODEL_ID = 'galaxy-a15-4g-5g'
const EXPECTED = {
  sourceModelId: 'galaxy-a15-5g',
  asin: 'B0CRDYG64S',
  accessoryCode: 'EF-QA156CTEGWW',
  compatibility: 'Galaxy A15 5G/LTE',
  widthMm: 76.8,
  heightMm: 160.1,
  depthMm: 8.4,
  reportedValue: '160.1 x 76.8 x 8.4',
  silhouetteTimestampSeconds: 17.8,
  openingTimestampSeconds: 6.5,
  silhouetteThresholds: [79, 80, 81],
  openingThresholds: [114, 115, 116],
  openingIds: ['upper-camera', 'middle-camera', 'lower-camera', 'flash'],
  silhouetteSampling: 'destination-pixel-center-to-source-pixel-cell-nearest-neighbor',
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

function assertExactSet(actual, expected, label) {
  assert(actual.size === expected.size, `${label}: expected ${expected.size}, found ${actual.size}`)
  for (const value of expected) assert(actual.has(value), `${label}: missing ${value}`)
}

async function assertSourceFrame(frame, expectedWidth, expectedHeight) {
  const bytes = await readFile(frame.path)
  assert(sha256(bytes) === frame.encodedSha256, `${frame.path}: encoded SHA-256 changed`)
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === expectedWidth && decoded.info.height === expectedHeight, `${frame.path}: dimensions changed`)
  assert(sha256(decoded.data) === frame.decodedPixelSha256, `${frame.path}: decoded pixels changed`)
}

async function assertCandidate(candidate, width, height) {
  const bytes = await readFile(candidate.outputPath)
  assert(sha256(bytes) === candidate.outputEncodedSha256, `${candidate.finish}: encoded SHA-256 changed`)
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === width && decoded.info.height === height, `${candidate.finish}: dimensions changed`)
  assert(decoded.info.channels === 4, `${candidate.finish}: expected RGBA output`)
  assert(sha256(decoded.data) === candidate.outputPixelSha256, `${candidate.finish}: decoded pixels changed`)
}

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

assert(sourceManifest.targetModelId === MODEL_ID, 'Source target model changed')
assert(sourceManifest.sourceModelId === EXPECTED.sourceModelId, 'Source model changed')
assert(sourceManifest.product.asin === EXPECTED.asin, 'Amazon ASIN changed')
assert(sourceProvenance.assets.length === 1, 'Expected exactly one verified source asset')
assert(sourceProvenance.summary.productRecordsVerified === 1, 'Amazon product record verification failed')
assert(sourceProvenance.summary.videoRecordsVerified === 1, 'Amazon video record verification failed')
assert(sourceProvenance.summary.hlsManifestsRepeatedFetchByteIdentical === 2, 'HLS manifest byte stability failed')
assert(sourceProvenance.summary.hlsSegmentsRepeatedFetchByteIdentical === 3, 'HLS segment byte stability failed')
assert(sourceProvenance.summary.realFramesPixelVerified === 2, 'Both physical video frames must be pixel verified')
assert(sourceProvenance.summary.officialCompatibilityVerified === 1, 'Samsung shared-case compatibility verification failed')
assert(sourceProvenance.summary.officialDimensionsVerified === 2, 'Both Samsung dimension records must be verified')
assert(derivation.results.length === 1, 'Expected exactly one A15 derivation result')
assert(derivation.summary.sourceThresholdStabilityPassed === 1, 'Silhouette threshold stability failed')
assert(derivation.summary.openingFrameThresholdStabilityPassed === 1, 'Opening threshold stability failed')
assert(derivation.summary.rectifiedThresholdStabilityPassed === 1, 'Rectified threshold stability failed')
assert(derivation.summary.exactOpeningTopologyPassed === 1, 'Exact four-opening topology failed')
assert(derivation.summary.circularCalibrationPassed === 1, 'Circular opening calibration failed')
assert(derivation.summary.exactPairAlpha === 1, 'Black and White alpha differs')
assert(derivation.summary.automatedQaPassed === 2, 'Both candidates must pass automated QA')

const asset = sourceProvenance.assets[0]
const result = derivation.results[0]
assert(asset.targetModelId === MODEL_ID && result.modelId === MODEL_ID, 'Derived model identity changed')
assert(asset.sourceModelId === EXPECTED.sourceModelId && result.sourceModelId === EXPECTED.sourceModelId, 'Derived source model changed')
assert(asset.publicationEligible, 'Verified A15 source is not publication-eligible')
assert(asset.productRecord.productIdentityVerified, 'Amazon product identity is not verified')
assert(asset.productRecord.asin === EXPECTED.asin && result.sourceAsset.asin === EXPECTED.asin, 'Derivation ASIN mismatch')
assert(asset.productRecord.title === sourceManifest.product.title, 'Amazon product title changed')
assert(asset.videoRecord.structuredMetadataVerified, 'Amazon video metadata is not verified')
assert(asset.videoRecord.associatedAsin === EXPECTED.asin, 'Amazon video is no longer associated with the exact ASIN')
assert(asset.hlsEvidence.master.repeatedFetchByteIdentical, 'HLS master changed between fetches')
assert(asset.hlsEvidence.variant.repeatedFetchByteIdentical, 'HLS variant changed between fetches')
assert(asset.hlsEvidence.segments.every((segment) => segment.repeatedFetchByteIdentical), 'An HLS segment changed between fetches')
assert(asset.hlsEvidence.frame.timestampSeconds === EXPECTED.silhouetteTimestampSeconds, 'Silhouette frame timestamp changed')
assert(asset.hlsEvidence.openingFrame.timestampSeconds === EXPECTED.openingTimestampSeconds, 'Opening frame timestamp changed')
assert(result.sourceAsset.geometryUse === 'complete physical silhouette only', 'Silhouette frame geometry role changed')
assert(result.openingSourceAsset.geometryUse.includes('four physical opening masks only'), 'Opening frame geometry role changed')

const compatibility = asset.officialCompatibilityEvidence
assert(compatibility.compatibilityVerified, 'Samsung LTE/5G compatibility is not verified')
assert(compatibility.accessoryCode === EXPECTED.accessoryCode, 'Samsung accessory code changed')
assert(compatibility.reportedValue === EXPECTED.compatibility, 'Samsung shared-case compatibility changed')
assert(compatibility.httpStatus === 200, 'Samsung accessory page did not return HTTP 200')
assert(asset.officialDimensionEvidence.length === 2, 'Expected LTE and 5G dimension evidence')
assertExactSet(new Set(asset.officialDimensionEvidence.map((evidence) => evidence.network)), new Set(['LTE', '5G']), 'Dimension networks')
for (const evidence of asset.officialDimensionEvidence) {
  assert(evidence.sourcePageHttpStatus === 200, `${evidence.network}: Samsung source page failed`)
  assert(evidence.apiHttpStatus === 200 && evidence.apiStatusCode === 200, `${evidence.network}: Samsung model API failed`)
  assert(evidence.reportedValueFound, `${evidence.network}: Samsung dimensions were not found`)
  assert(evidence.reportedValue === EXPECTED.reportedValue, `${evidence.network}: dimensions changed`)
}

assert(result.sourceKind === 'derived-verified-retail-source', 'Derived source kind changed')
assert(result.sourceGeometry.primaryThreshold === 80, 'Silhouette primary threshold changed')
assertExactArray(result.sourceGeometry.stabilityThresholds, EXPECTED.silhouetteThresholds, 'Silhouette threshold band')
assert(result.sourceGeometry.requiredMinimumThresholdIou === 0.995, 'Silhouette minimum IoU policy changed')
assert(result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou, 'Silhouette threshold IoU failed')
assert(result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift, 'Silhouette bounds drift failed')
assert(result.openingFrameGeometry.primaryThreshold === 115, 'Opening primary threshold changed')
assertExactArray(result.openingFrameGeometry.stabilityThresholds, EXPECTED.openingThresholds, 'Opening threshold band')
assert(result.openingFrameGeometry.requiredMinimumThresholdIou === 0.995, 'Opening minimum IoU policy changed')
assert(result.openingFrameGeometry.minimumThresholdIou >= result.openingFrameGeometry.requiredMinimumThresholdIou, 'Opening threshold IoU failed')
assert(result.openingFrameGeometry.maximumBoundsDrift <= result.openingFrameGeometry.allowedMaximumBoundsDrift, 'Opening bounds drift failed')
assert(result.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling method changed')
assert(result.rectification.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou, 'Rectified threshold IoU failed')
assert(result.rectification.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift, 'Rectified bounds drift failed')
assert(result.rectification.openingMappingQa.every((item) => item.mappedOutsideBodyPixels === 0), 'An observed opening mapped outside the body')
assert(result.rectification.openingMappingQa.every((item) => item.filledSourceOpenings.components === 4), 'Source opening replacement count changed')
assert(result.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(result.transform.shadowAffectedSourceOpeningsReplaced === 4, 'Expected all four shadow-affected source openings to be replaced')
assert(result.alpha.expectedOpeningCount === 4 && result.alpha.openingQaPassed, 'Four-opening QA failed')
assertExactSet(new Set(result.alpha.significantOpenings.map((opening) => opening.openingId)), new Set(EXPECTED.openingIds), 'Rectified openings')
for (const opening of result.alpha.significantOpenings.filter((item) => ['middle-camera', 'lower-camera'].includes(item.openingId))) {
  assert(opening.aspect >= 0.96 && opening.aspect <= 1.04, `${opening.openingId}: circular calibration failed`)
}

await Promise.all([
  assertSourceFrame(asset, sourceManifest.video.expectedFrameWidth, sourceManifest.video.expectedFrameHeight),
  assertSourceFrame(asset.openingFrame, sourceManifest.video.openingFrame.expectedWidth, sourceManifest.video.openingFrame.expectedHeight),
])

const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), 'Expected Black and White outputs')
const black = finishes.get('black')
const white = finishes.get('white')
assert(black.outputAlphaSha256 === white.outputAlphaSha256, 'Black and White alpha differs')
assert(black.outputAlphaSha256 === result.alpha.sha256, 'Candidate alpha differs from reviewed model alpha')
for (const candidate of [black, white]) {
  assert(candidate.qa.passed && candidate.qa.alphaExact, `${candidate.finish}: automated QA failed`)
  assert(candidate.qa.hiddenRgbPixels === 0, `${candidate.finish}: hidden RGB found`)
  assert(candidate.qa.maximumChannelSpread === 0, `${candidate.finish}: non-neutral RGB found`)
  assert(candidate.qa.cornerAlpha.every((value) => value === 0), `${candidate.finish}: opaque canvas corner found`)
  await assertCandidate(candidate, result.alpha.width, result.alpha.height)
}

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
    'Amazon ASIN B0CRDYG64S and its structured video record identify the real TAURI Galaxy A15 5G empty case shown in both geometry frames.',
    'The HLS master, 1080p variant, and all three segments are byte stable; the 17.8-second silhouette frame and 6.5-second opening frame are pixel locked.',
    'Samsung accessory EF-QA156CTEGWW explicitly reports Galaxy A15 5G/LTE compatibility, and Samsung LTE and 5G records both report 160.1 x 76.8 x 8.4 mm.',
    'The complete physical outer silhouette remains stable at thresholds 79, 80, and 81 with IoU of at least 0.995 and at most four pixels of bounds drift.',
    'All four physical openings are taken from the separately verified bright-backed frame and remain stable at thresholds 114, 115, and 116; no opening pixels are inferred.',
    'Pixel-center projective sampling preserves the observed silhouette without morphology, and red/blue high-contrast review confirms the physical side structures and transparent canvas margin.',
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
      criteria: 'The 17.8-second real empty-shell frame directly supplies the complete outer boundary; the 6.5-second real frame directly supplies all four unoccluded openings; high-contrast review confirms the side-key contours and an unclipped transparent margin.',
    },
    officialDimensions: {
      manufacturer: 'Samsung',
      widthMm: EXPECTED.widthMm,
      heightMm: EXPECTED.heightMm,
      depthMm: EXPECTED.depthMm,
      reportedLabel: 'Dimension (HxWxD, mm)',
      reportedValue: EXPECTED.reportedValue,
      reportedOrder: 'height x width x depth',
      compatibleNetworks: ['LTE', '5G'],
      sharedCaseCompatibility: compatibility,
      directPageVerification: {
        verifiedAt: sourceProvenance.generatedAt,
        evidence: asset.officialDimensionEvidence,
      },
    },
    verifiedRetailSource: {
      manufacturer: sourceManifest.product.brand,
      retailer: asset.productRecord.retailer,
      asin: asset.productRecord.asin,
      productTitle: asset.productRecord.title,
      productRecordUrl: asset.productRecordUrl,
      videoUrl: asset.sourceUrl,
      videoTitle: asset.videoRecord.title,
      hlsEvidence: asset.hlsEvidence,
      silhouetteFrame: result.sourceAsset,
      openingFrame: result.openingSourceAsset,
    },
    geometryQa: {
      sourceGeometry: result.sourceGeometry,
      openingFrameGeometry: result.openingFrameGeometry,
      rectification: result.rectification,
      transform: result.transform,
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