#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/supcase-a23-amazon-video-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/supcase-a23-amazon-video-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/supcase-a23-amazon-video-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/supcase-a23-amazon-video-case-review.json`
const MODEL_ID = 'galaxy-a23-4g-5g'
const EXPECTED = {
  asin: 'B0BMFRJYLG',
  widthMm: 76.9,
  heightMm: 165.4,
  depthMm: 8.4,
  reportedValue: '165.4 x 76.9 x 8.4',
  frameTimestampSeconds: 52,
  silhouetteThresholds: [1.5, 1.625, 1.75],
  primarySilhouetteThreshold: 1.625,
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

async function assertSourceImage(asset) {
  const bytes = await readFile(asset.path)
  assert(sha256(bytes) === asset.encodedSha256, 'Verified A23 source bytes changed')
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(decoded.info.width === asset.width && decoded.info.height === asset.height, 'Verified A23 source dimensions changed')
  assert(sha256(decoded.data) === asset.decodedPixelSha256, 'Verified A23 source pixels changed')
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
assert(sourceManifest.sourceModelId === MODEL_ID, 'Source model changed')
assert(sourceManifest.product.asin === EXPECTED.asin, 'Amazon ASIN changed')
assert(sourceProvenance.assets.length === 1, 'Expected exactly one verified source asset')
assert(sourceProvenance.summary.amazonProductHtmlFetchesVerified === 2, 'Amazon product verification failed')
assert(sourceProvenance.summary.amazonVideoHtmlFetchesVerified === 2, 'Amazon video verification failed')
assert(sourceProvenance.summary.hlsManifestsRepeatedFetchByteIdentical === 2, 'HLS manifest byte stability failed')
assert(sourceProvenance.summary.hlsSegmentsRepeatedFetchByteIdentical === 10, 'HLS segment byte stability failed')
assert(sourceProvenance.summary.realFramesPixelVerified === 1, 'Physical source frame is not pixel verified')
assert(sourceProvenance.summary.officialModelsVerified === 2, 'Both Samsung models must be verified')
assert(sourceProvenance.summary.sourceQualified === 1, 'A23 source qualification failed')
assert(sourceProvenance.summary.shopifyWrites === 0, 'Source qualification unexpectedly wrote to Shopify')
assert(derivation.results.length === 1, 'Expected exactly one A23 derivation result')
assert(derivation.summary.sourceThresholdStabilityPassed === 1, 'Source threshold stability failed')
assert(derivation.summary.observedEdgeFitsPassed === 1, 'Observed physical edge fitting failed')
assert(derivation.summary.rectifiedThresholdStabilityPassed === 1, 'Rectified threshold stability failed')
assert(derivation.summary.exactOpeningTopologyPassed === 1, 'Camera opening topology failed')
assert(derivation.summary.completeContourMarginsPassed === 1, 'Transparent contour margin QA failed')
assert(derivation.summary.exactPairAlpha === 1, 'Black and White alpha differs')
assert(derivation.summary.automatedQaPassed === 2, 'Both candidates must pass automated QA')
assert(derivation.summary.shopifyWrites === 0, 'Derivation unexpectedly wrote to Shopify')

const asset = sourceProvenance.assets[0]
const result = derivation.results[0]
assert(asset.targetModelId === MODEL_ID && result.modelId === MODEL_ID, 'Derived model identity changed')
assert(asset.sourceModelId === MODEL_ID && result.sourceModelId === MODEL_ID, 'Derived source identity changed')
assert(asset.geometryReview === 'accepted-real-product-video-frame-complete-empty-rear-shell-separately-visible-with-no-phone-inserted', 'Source frame review changed')
assert(result.sourceKind === 'derived-verified-retail-source', 'Derived source kind changed')
assert(result.reviewStatus === 'pending-independent-visual-review', 'A23 derivation review state changed')
assert(!result.publicationEligible, 'A23 derivation unexpectedly became publication-eligible')
assert(asset.hlsEvidence.frame.timestampSeconds === EXPECTED.frameTimestampSeconds, 'Source frame timestamp changed')
assert(asset.hlsEvidence.frame.encodedSha256 === asset.encodedSha256, 'Source frame hash evidence differs')

const officialModels = asset.officialModelEvidence
assert(officialModels.length === 2, 'Expected separate A23 4G and 5G evidence')
assertExactArray(officialModels.map((item) => item.network), ['4G LTE', '5G'], 'Samsung network identities')
for (const evidence of officialModels) {
  assert(evidence.reportedValue === EXPECTED.reportedValue, `${evidence.network}: dimensions changed`)
  assert(evidence.sourcePageHttpStatus === 200, `${evidence.network}: Samsung source page failed`)
  assert(evidence.apiHttpStatus === 200 && evidence.apiStatusCode === 200, `${evidence.network}: Samsung API failed`)
  assert(evidence.dimensionVerified && evidence.networkIdentityVerified, `${evidence.network}: Samsung evidence is incomplete`)
}

assert(result.sourceGeometry.primaryThreshold === EXPECTED.primarySilhouetteThreshold, 'Primary silhouette threshold changed')
assertExactArray(result.sourceGeometry.stabilityThresholds, EXPECTED.silhouetteThresholds, 'Silhouette threshold band')
assert(result.sourceGeometry.minimumThresholdIou >= 0.995, 'Silhouette threshold stability failed')
assert(result.sourceGeometry.maximumBoundsDrift <= 4, 'Silhouette bounds drift failed')
assert(result.rectification.silhouetteSampling === EXPECTED.silhouetteSampling, 'Silhouette sampling method changed')
assert(result.transform.morphologyOperations === 0, 'Morphology is forbidden')
assert(result.transform.inferredBoundaryPixels === 0, 'Boundary pixels were inferred')
assert(result.transform.inferredOpeningPixels === 0, 'Opening pixels were inferred')
assert(result.alpha.expectedOpeningCount === 1 && result.alpha.openingQaPassed, 'Exact camera-opening QA failed')
assert(result.alpha.significantOpenings.length === 1 && result.alpha.significantOpenings[0].openingId === 'camera', 'Reviewed opening changed')

await assertSourceImage(asset)
const overlayBytes = await readFile(result.visualReviewEvidence.path)
assert(sha256(overlayBytes) === result.visualReviewEvidence.encodedSha256, 'Visual review overlay changed')

const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), 'Expected Black and White outputs')
const black = finishes.get('black')
const white = finishes.get('white')
assert(black.outputAlphaSha256 === white.outputAlphaSha256, 'Black and White alpha differs')
assert(black.outputAlphaSha256 === result.alpha.sha256, 'Candidate alpha differs from reviewed geometry')
for (const candidate of [black, white]) {
  assert(candidate.qa.passed && candidate.qa.alphaExact, `${candidate.finish}: automated QA failed`)
  assert(candidate.qa.hiddenRgbPixels === 0, `${candidate.finish}: hidden RGB found`)
  assert(candidate.qa.maximumChannelSpread === 0, `${candidate.finish}: non-neutral RGB found`)
  assert(candidate.qa.nonBinaryAlphaPixels === 0, `${candidate.finish}: non-binary alpha found`)
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
    'Amazon ASIN B0BMFRJYLG explicitly identifies the real SUPCASE Galaxy A23 4G / 5G case and the exact-ASIN product video.',
    'The HLS manifests and all ten segments are byte stable; the 52-second complete empty rear-shell frame is pixel locked.',
    'Samsung independently identifies the A23 4G and A23 5G models and reports identical 165.4 x 76.9 x 8.4 mm dimensions.',
    'The directly observed outer contour remains stable across edge-fit thresholds 1.5, 1.625, and 1.75 and retains the physical side structures without inferred boundary pixels.',
    'The directly observed camera opening is preserved as the sole significant opening and remains inside the body contour.',
    'The red outer-edge and blue opening-edge overlay confirms a complete physical contour with transparent canvas margin.',
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
    catalogIdentityEvidence: asset.compatibilityReason,
    visualReview: {
      status: 'accepted',
      criteria: 'The real empty rear-shell frame directly supplies the complete outer boundary and camera opening; the high-contrast overlay confirms the physical side structures, opening topology, and unclipped transparent margin.',
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
      compatibleNetworks: ['4G LTE', '5G'],
      directPageVerification: {
        verifiedAt: sourceProvenance.generatedAt,
        evidence: officialModels,
      },
    },
    verifiedRetailSource: {
      manufacturer: sourceManifest.product.brand,
      retailer: sourceManifest.product.retailer,
      asin: sourceManifest.product.asin,
      productTitle: sourceManifest.product.title,
      productRecordUrl: sourceManifest.product.productPageUrl,
      videoUrl: sourceManifest.video.pageUrl,
      videoTitle: sourceManifest.video.title,
      hlsEvidence: asset.hlsEvidence,
      frame: result.sourceAsset,
    },
    geometryQa: {
      sourceGeometry: result.sourceGeometry,
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