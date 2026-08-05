#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/pixel-5-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/pixel-5-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/pixel-5-case-review.json`
const REVIEWED_AT = '2026-08-02T08:30:00.000Z'
const EXPECTED = {
  modelId: 'pixel-5',
  modelName: 'Pixel 5',
  productId: '83890',
  sku: 'ACS01894',
  sourceSha256: '81351ae4b365b187b673928d3684d9512ea88d4ff5425c42aa67579e1dba012e',
  alphaSha256: '7b3936fbe5eaa9938b0a3d4188b9904a6aa54c85201cd6311f3a8150bfd91816',
  blackSha256: 'c59a66fc69b051c93a1fbf770a9f2b2039b8e48c0d8d398eb2bdc1c01baae586',
  whiteSha256: 'badd71663046fabfe010076c00b2825223b336daa5e0f9712d858f34828ab58f',
}
const OFFICIAL_DIMENSIONS = {
  manufacturer: 'Google',
  widthMm: 70.4,
  heightMm: 144.7,
  depthMm: 8,
  reportedValue: '144.7 x 70.4 x 8.0',
  reportedLabel: 'Dimensions',
  reportedOrder: 'height x width x depth',
  sourceUrl: 'https://support.google.com/pixelphone/answer/16043605?hl=en',
  sourcePageTitle: 'Pixel phone hardware tech specs (earlier models) - Pixel Phone Help',
  directPageVerification: {
    httpStatus: 200,
    modelIdentityFound: true,
    reportedValueFound: true,
    verifiedAt: REVIEWED_AT,
    evidence: [{
      modelLabel: 'Pixel 5 phone (2020)',
      reportedValue: '144.7 x 70.4 x 8.0',
      sourceUrl: 'https://support.google.com/pixelphone/answer/16043605?hl=en',
      sourcePageTitle: 'Pixel phone hardware tech specs (earlier models) - Pixel Phone Help',
      verificationMethod: 'Expanded the archived Pixel 5 model row and read Dimensions.',
      httpStatus: 200,
      modelIdentityFound: true,
      reportedValueFound: true,
      verifiedAt: REVIEWED_AT,
    }],
  },
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

async function assertImage(filePath, expectedSha256, expectedWidth, expectedHeight, expectedFormat) {
  const bytes = await readFile(filePath)
  assert(sha256(bytes) === expectedSha256, `${filePath}: encoded SHA-256 changed`)
  const metadata = await sharp(bytes).metadata()
  assert(metadata.format === expectedFormat, `${filePath}: expected ${expectedFormat}, found ${metadata.format}`)
  assert(metadata.width === expectedWidth && metadata.height === expectedHeight, `${filePath}: dimensions changed`)
}

const [sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

assert(sourceProvenance.assets.length === 1, 'Expected exactly one Pixel 5 source asset')
assert(derivation.results.length === 1, 'Expected exactly one Pixel 5 derivation result')
assert(derivation.summary.models === 1, 'Expected one derived model')
assert(derivation.summary.candidates === 2, 'Expected two derived candidates')
assert(derivation.summary.thresholdStabilityPassed === 1, 'Foreground threshold stability failed')
assert(derivation.summary.cameraOpeningQaPassed === 1, 'Dual-opening QA failed')
assert(derivation.summary.exactPairAlpha === 1, 'Black and White alpha differ')
assert(derivation.summary.automatedQaPassed === 2, 'Candidate automated QA failed')

const source = sourceProvenance.assets[0]
const result = derivation.results[0]
assert(source.targetModelId === EXPECTED.modelId && result.modelId === EXPECTED.modelId, 'Pixel 5 model identity changed')
assert(source.targetModelName === EXPECTED.modelName && result.modelName === EXPECTED.modelName, 'Pixel 5 model name changed')
assert(source.sourceKind === 'verified-reseller-real-product-image', 'Source is not the reviewed real-product photograph')
assert(result.sourceKind === 'derived-verified-real-product-source', 'Derived source classification changed')
assert(source.publicationEligible && source.productRecordVerified, 'Pixel 5 source is not publication-eligible')
assert(source.repeatedFetchByteIdentical, 'Repeated source downloads differ')
assert(source.productRecord.productId === EXPECTED.productId, 'Reseller product identity changed')
assert(source.productRecord.sku === EXPECTED.sku && result.sourceAsset.sku === EXPECTED.sku, 'Spigen SKU changed')
assert(source.encodedSha256 === EXPECTED.sourceSha256, 'Reviewed source SHA-256 changed')
assert(result.sourceAsset.encodedSha256 === EXPECTED.sourceSha256, 'Derived source SHA-256 changed')
assert(source.manufacturerEvidence.length === 2, 'Expected two manufacturer catalog records')
assert(source.manufacturerEvidence.every((evidence) => evidence.claim.includes('Pixel 5')), 'Manufacturer evidence lost Pixel 5 identity')
assert(source.sourceVisibleOpenings.length === 2, 'Expected camera and fingerprint source openings')
assert(new Set(source.sourceVisibleOpenings.map((opening) => opening.id)).size === 2, 'Source openings are not unique')
assert(JSON.stringify(result.transform.sourceVisibleOpeningTransform.openings) === JSON.stringify(source.sourceVisibleOpenings), 'Derived opening coordinates differ from reviewed provenance')

await assertImage(source.path, EXPECTED.sourceSha256, 487, 960, 'jpeg')
assert(result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou, 'Threshold IoU failed')
assert(result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift, 'Threshold bounds drift failed')
assert(result.alpha.cameraOpeningProfile.id === 'pixel-5-camera-and-fingerprint', 'Pixel 5 opening profile changed')
assert(result.alpha.cameraOpeningProfilePassed, 'Pixel 5 opening profile failed')
assert(result.alpha.unexpectedSignificantHoles.length === 0, 'Unexpected significant opening found')
assert(result.alpha.significantHoles.length === 2, 'Expected exactly two significant openings')
assert(new Set(result.alpha.significantHoles.map((hole) => hole.openingId)).size === 2, 'Opening profile did not uniquely match both holes')
assert(result.alpha.sha256 === EXPECTED.alphaSha256, 'Visually accepted alpha changed')

const candidates = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
assert(candidates.size === 2 && candidates.has('black') && candidates.has('white'), 'Expected Black and White candidates')
const expectedCandidateHashes = { black: EXPECTED.blackSha256, white: EXPECTED.whiteSha256 }
for (const finish of ['black', 'white']) {
  const candidate = candidates.get(finish)
  assert(candidate.outputEncodedSha256 === expectedCandidateHashes[finish], `${finish}: visually accepted SHA-256 changed`)
  assert(candidate.outputAlphaSha256 === EXPECTED.alphaSha256, `${finish}: accepted alpha changed`)
  assert(candidate.qa.passed && candidate.qa.alphaExact, `${finish}: automated QA failed`)
  assert(candidate.qa.hiddenRgbPixels === 0, `${finish}: hidden RGB found`)
  assert(candidate.qa.maximumChannelSpread === 0, `${finish}: non-neutral RGB found`)
  assert(candidate.qa.cornerAlpha.every((value) => value === 0), `${finish}: opaque canvas corner found`)
  await assertImage(candidate.outputPath, expectedCandidateHashes[finish], 487, 960, 'png')
}

const output = (finish) => {
  const candidate = candidates.get(finish)
  return {
    sourceKind: result.sourceKind,
    path: candidate.outputPath,
    sha256: candidate.outputEncodedSha256,
    pixelSha256: candidate.outputPixelSha256,
    alphaSha256: candidate.outputAlphaSha256,
    width: result.alpha.width,
    height: result.alpha.height,
    alphaBounds: candidate.bounds,
  }
}

const review = {
  schemaVersion: 1,
  reviewedAt: REVIEWED_AT,
  reviewedBy: 'GitHub Copilot visual inspection in VS Code',
  sourceProvenancePath: SOURCE_PROVENANCE_PATH,
  derivationProvenancePath: DERIVATION_PROVENANCE_PATH,
  acceptanceCriteria: [
    'The exact Pixel 5 Spigen Thin Fit ACS01894 identity is corroborated by two Spigen catalog pages.',
    'The real-product source is byte-identical across repeated downloads and its local SHA-256 remains locked.',
    'The source-axis silhouette is stable across thresholds 11, 12, and 13 with no perspective or geometry reconstruction.',
    'The visibly bounded camera and fingerprint interiors are explicitly transparent and uniquely match the strict Pixel 5 dual-opening profile.',
    'Black and White outputs retain the visually accepted shared alpha, zero hidden RGB, neutral channels, and transparent canvas corners.',
    'Pixel 5 physical dimensions are supported by the archived official Google hardware specification page.',
  ],
  summary: {
    sourceAssets: 1,
    modelsVisuallyAccepted: 1,
    candidateImagesVisuallyAccepted: 2,
    modelsPublicationEligible: 1,
    modelsBlockedByCatalogIdentity: 0,
  },
  models: [{
    modelId: EXPECTED.modelId,
    modelName: EXPECTED.modelName,
    sourceModelId: source.sourceModelId,
    reviewStatus: 'accepted',
    publicationEligible: true,
    catalogIdentityEvidence: source.eligibilityReason,
    visualReview: {
      status: 'accepted',
      criteria: 'Complete orthogonal real-case silhouette, source-bounded camera and fingerprint openings, clean outer edge, transparent background, and matched Black/White geometry.',
    },
    officialDimensions: OFFICIAL_DIMENSIONS,
    sourceEvidence: {
      kind: source.sourceKind,
      productRecordUrl: source.productRecordUrl,
      sourceUrl: source.sourceUrl,
      path: source.path,
      sha256: source.encodedSha256,
      productId: source.productRecord.productId,
      sku: source.productRecord.sku,
      manufacturerEvidence: source.manufacturerEvidence,
    },
    geometryQa: {
      foregroundThreshold: result.sourceGeometry.primaryThreshold,
      minimumThresholdIou: result.sourceGeometry.minimumThresholdIou,
      requiredMinimumThresholdIou: result.sourceGeometry.requiredMinimumThresholdIou,
      maximumBoundsDrift: result.sourceGeometry.maximumBoundsDrift,
      allowedMaximumBoundsDrift: result.sourceGeometry.allowedMaximumBoundsDrift,
      sharedAlphaSha256: result.alpha.sha256,
      sourceVisibleOpeningTransform: result.transform.sourceVisibleOpeningTransform,
      cameraOpeningProfile: result.alpha.cameraOpeningProfile,
      significantOpenings: result.alpha.significantHoles,
      unexpectedSignificantHoles: result.alpha.unexpectedSignificantHoles,
      cameraOpeningProfilePassed: result.alpha.cameraOpeningProfilePassed,
    },
    black: output('black'),
    white: output('white'),
  }],
  blockedModels: [],
  publicationPolicy: {
    acceptedOnly: true,
    requirePublicationEligible: true,
    requireExactPathAndSha256: true,
    requireOfficialDimensions: true,
    requireExactCameraAndFingerprintOpeningProfile: true,
    requireShopifyFileMetaobjectProductMediaAndAllVariantAssociations: true,
  },
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`)
console.log(JSON.stringify({
  outputPath: OUTPUT_PATH,
  models: review.summary.modelsPublicationEligible,
  candidates: review.summary.candidateImagesVisuallyAccepted,
}, null, 2))