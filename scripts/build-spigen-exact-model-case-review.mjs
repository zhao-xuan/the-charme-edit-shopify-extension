#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/spigen-exact-model-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/spigen-exact-model-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/spigen-exact-model-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/spigen-exact-model-case-review.json`
const REVIEWED_AT = '2026-08-01T21:00:00.000Z'

const OFFICIAL_DIMENSIONS = {
  'galaxy-s9': {
    manufacturer: 'Samsung',
    widthMm: 68.7,
    heightMm: 147.7,
    depthMm: 8.5,
    reportedValue: '147.7 x 68.7 x 8.5',
    sourceUrl: 'https://www.samsung.com/nz/smartphones/galaxy-s9/specs/',
    sourcePageTitle: 'Samsung Galaxy S9 and S9+ Specs and Features | Samsung New Zealand',
    directPageEvidence: [{
      modelLabel: 'Galaxy S9 Single Sim (256GB)',
      modelCode: 'SM-G960FZKFTNZ',
      reportedValue: '147.7 x 68.7 x 8.5',
      sourceUrl: 'https://www.samsung.com/nz/smartphones/galaxy-s9/specs/',
      sourcePageTitle: 'Samsung Galaxy S9 and S9+ Specs and Features | Samsung New Zealand',
      verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
      httpStatus: 200,
    }],
  },
  'galaxy-s9-plus': {
    manufacturer: 'Samsung',
    widthMm: 73.8,
    heightMm: 158.1,
    depthMm: 8.5,
    reportedValue: '158.1 x 73.8 x 8.5',
    sourceUrl: 'https://www.samsung.com/nz/smartphones/galaxy-s9/specs/',
    sourcePageTitle: 'Samsung Galaxy S9 and S9+ Specs and Features | Samsung New Zealand',
    directPageEvidence: [{
      modelLabel: 'Galaxy S9+ Single Sim (256GB)',
      modelCode: 'SM-G965FZKFTNZ',
      reportedValue: '158.1 x 73.8 x 8.5',
      sourceUrl: 'https://www.samsung.com/nz/smartphones/galaxy-s9/specs/',
      sourcePageTitle: 'Samsung Galaxy S9 and S9+ Specs and Features | Samsung New Zealand',
      verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
      httpStatus: 200,
    }],
  },
  'galaxy-s10-plus': {
    manufacturer: 'Samsung',
    widthMm: 74.1,
    heightMm: 157.6,
    depthMm: 7.8,
    reportedValue: '157.6 x 74.1 x 7.8',
    sourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-s10/specs/',
    sourcePageTitle: 'Specifications | Samsung Galaxy S10 | Samsung UK',
    directPageEvidence: [{
      modelLabel: 'Galaxy S10+ (128GB)',
      modelCode: 'SM-G975FZWDBTU',
      reportedValue: '157.6 x 74.1 x 7.8',
      sourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-s10/specs/',
      sourcePageTitle: 'Specifications | Samsung Galaxy S10 | Samsung UK',
      verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
      httpStatus: 200,
    }],
  },
  'galaxy-note-20-4g-5g': {
    manufacturer: 'Samsung',
    widthMm: 75.2,
    heightMm: 161.6,
    depthMm: 8.3,
    reportedValue: '161.6 x 75.2 x 8.3',
    sourceUrl: 'https://www.samsung.com/ie/smartphones/galaxy-note20/specs/',
    sourcePageTitle: 'Specs | Samsung Galaxy Note20 & Note20 Ultra | Samsung IE',
    directPageEvidence: [
      {
        network: 'LTE',
        modelLabel: 'Galaxy Note20',
        modelCode: 'SM-N980FZNGEUA',
        reportedValue: '161.6 x 75.2 x 8.3',
        sourceUrl: 'https://www.samsung.com/ie/smartphones/galaxy-note20/specs/',
        sourcePageTitle: 'Specs | Samsung Galaxy Note20 & Note20 Ultra | Samsung IE',
        verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
        httpStatus: 200,
      },
      {
        network: '5G',
        modelLabel: 'Galaxy Note20 5G',
        modelCode: 'SM-N981BZNGEUA',
        reportedValue: '161.6 x 75.2 x 8.3',
        sourceUrl: 'https://www.samsung.com/ie/smartphones/galaxy-note20/specs/',
        sourcePageTitle: 'Specs | Samsung Galaxy Note20 & Note20 Ultra | Samsung IE',
        verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
        httpStatus: 200,
      },
    ],
  },
  'galaxy-note-20-ultra-4g-5g': {
    manufacturer: 'Samsung',
    widthMm: 77.2,
    heightMm: 164.8,
    depthMm: 8.1,
    reportedValue: '164.8 x 77.2 x 8.1',
    sourceUrl: 'https://www.samsung.com/ie/smartphones/galaxy-note20/specs/',
    sourcePageTitle: 'Specs | Samsung Galaxy Note20 & Note20 Ultra | Samsung IE',
    directPageEvidence: [
      {
        network: 'LTE',
        modelLabel: 'Galaxy Note20 Ultra',
        modelCode: 'SM-N985FZNGAFR',
        reportedValue: '164.8 x 77.2 x 8.1',
        sourceUrl: 'https://www.samsung.com/africa_pt/business/smartphones/galaxy-note/galaxy-note20-ultra-n985-sm-n985fzngafr/',
        sourcePageTitle: 'Galaxy Note20 Ultra | SM-N985FZNGAFR | Samsung Business Africa (Portuguese)',
        verificationMethod: 'Read the model code and Dimensao (AxLxP, mm) from the Samsung Business product page.',
        httpStatus: 200,
      },
      {
        network: '5G',
        modelLabel: 'Galaxy Note20 Ultra 5G',
        modelCode: 'SM-N986BZNHEUA',
        reportedValue: '164.8 x 77.2 x 8.1',
        sourceUrl: 'https://www.samsung.com/ie/smartphones/galaxy-note20/specs/',
        sourcePageTitle: 'Specs | Samsung Galaxy Note20 & Note20 Ultra | Samsung IE',
        verificationMethod: 'Selected the exact Samsung specification tab and read Dimension (HxWxD, mm).',
        httpStatus: 200,
      },
    ],
  },
  'pixel-9a': {
    manufacturer: 'Google',
    widthMm: 73.3,
    heightMm: 154.7,
    depthMm: 8.9,
    reportedValue: '154.7 x 73.3 x 8.9',
    sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
    sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
    directPageEvidence: [{
      modelLabel: 'Pixel 9a',
      reportedValue: '154.7 x 73.3 x 8.9',
      sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
      sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
      verificationMethod: 'Expanded the exact Google Pixel model accordion and read Dimensions & weight.',
      httpStatus: 200,
    }],
  },
  'pixel-10': {
    manufacturer: 'Google',
    widthMm: 72,
    heightMm: 152.8,
    depthMm: 8.6,
    reportedValue: '152.8 x 72.0 x 8.6',
    sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
    sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
    directPageEvidence: [{
      modelLabel: 'Pixel 10',
      reportedValue: '152.8 x 72.0 x 8.6',
      sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
      sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
      verificationMethod: 'Expanded the exact Google Pixel model accordion and read Dimensions & weight.',
      httpStatus: 200,
    }],
  },
  'pixel-10-pro': {
    manufacturer: 'Google',
    widthMm: 72,
    heightMm: 152.8,
    depthMm: 8.6,
    reportedValue: '152.8 x 72.0 x 8.6',
    sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
    sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
    directPageEvidence: [{
      modelLabel: 'Pixel 10 Pro',
      reportedValue: '152.8 x 72.0 x 8.6',
      sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
      sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
      verificationMethod: 'Expanded the exact Google Pixel model accordion and read Dimensions & weight.',
      httpStatus: 200,
    }],
  },
  'pixel-10-pro-xl': {
    manufacturer: 'Google',
    widthMm: 76.6,
    heightMm: 162.8,
    depthMm: 8.5,
    reportedValue: '162.8 x 76.6 x 8.5',
    sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
    sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
    directPageEvidence: [{
      modelLabel: 'Pixel 10 Pro XL',
      reportedValue: '162.8 x 76.6 x 8.5',
      sourceUrl: 'https://support.google.com/pixelphone/answer/7158570?hl=en',
      sourcePageTitle: 'Pixel phone hardware tech specs - Pixel Phone Help',
      verificationMethod: 'Expanded the exact Google Pixel model accordion and read Dimensions & weight.',
      httpStatus: 200,
    }],
  },
}

const VISUALLY_ACCEPTED_MODEL_IDS = new Set(Object.keys(OFFICIAL_DIMENSIONS))
const COMBINED_NETWORK_MODEL_IDS = new Set([
  'galaxy-note-20-4g-5g',
  'galaxy-note-20-ultra-4g-5g',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function assertFile(filePath, expectedSha256, expectedWidth, expectedHeight) {
  const bytes = await readFile(filePath)
  assert(sha256(bytes) === expectedSha256, `${filePath}: encoded SHA-256 changed`)
  const metadata = await sharp(bytes).metadata()
  assert(metadata.format === 'png' || metadata.format === 'jpeg', `${filePath}: unsupported format ${metadata.format}`)
  assert(metadata.width === expectedWidth && metadata.height === expectedHeight, `${filePath}: dimensions changed`)
}

function assertExactSet(actual, expected, label) {
  assert(actual.size === expected.size, `${label}: expected ${expected.size}, found ${actual.size}`)
  for (const value of expected) assert(actual.has(value), `${label}: missing ${value}`)
}

const [sourceManifest, sourceProvenance, derivation] = await Promise.all([
  readJson(SOURCE_MANIFEST_PATH),
  readJson(SOURCE_PROVENANCE_PATH),
  readJson(DERIVATION_PROVENANCE_PATH),
])

const eligibleSources = sourceManifest.candidates.filter((candidate) => candidate.publicationEligible)
const eligibleIds = new Set(eligibleSources.map((candidate) => candidate.targetModelId))
const derivedIds = new Set(derivation.results.map((result) => result.modelId))

assert(sourceManifest.candidates.length === 9, `Expected 9 source candidates, found ${sourceManifest.candidates.length}`)
assert(eligibleSources.length === 9, `Expected 9 eligible source candidates, found ${eligibleSources.length}`)
assert(derivation.results.length === 9, `Expected 9 derived models, found ${derivation.results.length}`)
assert(sourceProvenance.summary.productRecordsVerified === 9, 'Expected all nine Spigen product records to be verified')
assert(sourceProvenance.summary.repeatedFetchByteIdentical === 9, 'Expected all nine source records to be byte-stable')
assert(derivation.summary.cameraOpeningQaPassed === 9, 'Expected all nine camera-opening profiles to pass')
assert(derivation.summary.automatedQaPassed === 18, 'Expected all 18 derived images to pass automated QA')
assertExactSet(eligibleIds, VISUALLY_ACCEPTED_MODEL_IDS, 'Eligible source models')
assertExactSet(derivedIds, VISUALLY_ACCEPTED_MODEL_IDS, 'Derived models')

const provenanceById = new Map(sourceProvenance.assets.map((asset) => [asset.targetModelId, asset]))
const sourceById = new Map(eligibleSources.map((candidate) => [candidate.targetModelId, candidate]))
const models = []

for (const result of derivation.results) {
  const source = sourceById.get(result.modelId)
  const downloaded = provenanceById.get(result.modelId)
  const dimensions = OFFICIAL_DIMENSIONS[result.modelId]
  assert(source, `${result.modelId}: eligible source record missing`)
  assert(downloaded, `${result.modelId}: download provenance missing`)
  assert(dimensions, `${result.modelId}: official dimensions missing`)
  assert(dimensions.directPageEvidence.length > 0, `${result.modelId}: direct official dimension evidence missing`)
  for (const evidence of dimensions.directPageEvidence) {
    assert(evidence.httpStatus === 200, `${result.modelId}: official dimension evidence did not return HTTP 200`)
    assert(evidence.reportedValue === dimensions.reportedValue, `${result.modelId}: official dimension evidence value differs`)
    assert(evidence.modelLabel, `${result.modelId}: official dimension evidence model identity missing`)
  }
  if (COMBINED_NETWORK_MODEL_IDS.has(result.modelId)) {
    assertExactSet(
      new Set(dimensions.directPageEvidence.map((evidence) => evidence.network)),
      new Set(['LTE', '5G']),
      `${result.modelId} network identities`,
    )
  }
  assert(downloaded.repeatedFetchByteIdentical, `${result.modelId}: repeated source download differs`)
  assert(downloaded.productRecordVerified, `${result.modelId}: Spigen product record was not verified`)
  assert(result.sourceAsset.sourceUrl === source.sourceUrl, `${result.modelId}: source URL mismatch`)
  assert(result.sourceAsset.sku === source.sku, `${result.modelId}: source SKU mismatch`)
  assert(result.sourceAsset.gtin === source.gtin, `${result.modelId}: source GTIN mismatch`)
  assert(result.alpha.cameraOpeningProfilePassed, `${result.modelId}: camera-opening profile failed`)
  assert(result.alpha.unexpectedSignificantHoles.length === 0, `${result.modelId}: unexpected significant camera opening found`)
  assert(
    result.alpha.significantHoles.length === result.alpha.cameraOpeningProfile.openings.length,
    `${result.modelId}: camera-opening count differs from its profile`,
  )
  assert(
    result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou,
    `${result.modelId}: threshold IoU failed`,
  )
  assert(
    result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift,
    `${result.modelId}: threshold bounds drift failed`,
  )

  await assertFile(
    result.sourceAsset.path,
    result.sourceAsset.encodedSha256,
    source.expectedWidth,
    source.expectedHeight,
  )

  const finishes = new Map(result.candidates.map((candidate) => [candidate.finish, candidate]))
  assert(finishes.size === 2 && finishes.has('black') && finishes.has('white'), `${result.modelId}: expected Black and White outputs`)
  const black = finishes.get('black')
  const white = finishes.get('white')
  assert(black.outputAlphaSha256 === white.outputAlphaSha256, `${result.modelId}: pair alpha differs`)
  assert(black.outputAlphaSha256 === result.alpha.sha256, `${result.modelId}: output alpha differs from model alpha`)

  for (const candidate of [black, white]) {
    assert(candidate.qa.passed && candidate.qa.alphaExact, `${result.modelId} ${candidate.finish}: automated QA failed`)
    assert(candidate.qa.hiddenRgbPixels === 0, `${result.modelId} ${candidate.finish}: hidden RGB found`)
    assert(candidate.qa.maximumChannelSpread === 0, `${result.modelId} ${candidate.finish}: non-neutral RGB found`)
    assert(candidate.qa.cornerAlpha.every((value) => value === 0), `${result.modelId} ${candidate.finish}: opaque canvas corner found`)
    await assertFile(candidate.outputPath, candidate.outputEncodedSha256, result.alpha.width, result.alpha.height)
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

  const { directPageEvidence, ...dimensionValues } = dimensions

  models.push({
    modelId: result.modelId,
    modelName: result.modelName,
    sourceModelId: result.sourceModelId,
    reviewStatus: 'accepted',
    publicationEligible: true,
    catalogIdentityEvidence: source.eligibilityReason,
    visualReview: {
      status: 'accepted',
      criteria: 'Complete orthogonal body, exact profile-matched camera openings, clean outer edge, transparent background, and matched Black/White geometry.',
    },
    officialDimensions: {
      ...dimensionValues,
      reportedLabel: 'Dimensions (height x width x depth, mm)',
      reportedOrder: 'height x width x depth',
      directPageVerification: {
        httpStatus: 200,
        modelIdentityFound: true,
        reportedValueFound: true,
        verifiedAt: REVIEWED_AT,
        evidence: directPageEvidence.map((entry) => ({
          ...entry,
          modelIdentityFound: true,
          reportedValueFound: true,
          verifiedAt: REVIEWED_AT,
        })),
      },
    },
    officialSource: {
      manufacturer: 'Spigen',
      productRecordUrl: result.sourceAsset.productRecordUrl,
      sourceUrl: result.sourceAsset.sourceUrl,
      path: result.sourceAsset.path,
      sha256: result.sourceAsset.encodedSha256,
      sku: result.sourceAsset.sku,
      gtin: result.sourceAsset.gtin,
    },
    geometryQa: {
      foregroundThreshold: result.sourceGeometry.primaryThreshold,
      minimumThresholdIou: result.sourceGeometry.minimumThresholdIou,
      requiredMinimumThresholdIou: result.sourceGeometry.requiredMinimumThresholdIou,
      maximumBoundsDrift: result.sourceGeometry.maximumBoundsDrift,
      allowedMaximumBoundsDrift: result.sourceGeometry.allowedMaximumBoundsDrift,
      sharedAlphaSha256: result.alpha.sha256,
      cameraOpeningProfile: result.alpha.cameraOpeningProfile,
      significantCameraOpenings: result.alpha.significantHoles,
      unexpectedSignificantHoles: result.alpha.unexpectedSignificantHoles,
      cameraOpeningProfilePassed: result.alpha.cameraOpeningProfilePassed,
      filledArtifactComponents: result.alpha.filledArtifactComponents,
      filledArtifactPixels: result.alpha.filledArtifactPixels,
    },
    black: output(black),
    white: output(white),
  })
}

models.sort((left, right) => left.modelId.localeCompare(right.modelId))

const review = {
  schemaVersion: 1,
  reviewedAt: REVIEWED_AT,
  reviewedBy: 'GitHub Copilot visual inspection in VS Code',
  sourceManifestPath: SOURCE_MANIFEST_PATH,
  sourceProvenancePath: SOURCE_PROVENANCE_PATH,
  derivationProvenancePath: DERIVATION_PROVENANCE_PATH,
  acceptanceCriteria: [
    'Official Spigen product records, exact variant titles, media identity, SKU, and GTIN identify every target geometry.',
    'Every official source is byte-identical across repeated downloads and its local SHA-256 remains locked.',
    'Foreground threshold samples 11, 12, and 13 retain IoU of at least 0.995 with no more than four pixels of bounds drift.',
    'Each model matches its strict camera-opening profile exactly, including Pixel 9a two-opening geometry, with no unexpected significant holes.',
    'Black and White outputs use the exact same alpha, preserve transparent openings, contain zero hidden RGB, and have neutral RGB channels.',
    'Visual review confirms a complete orthogonal body, clean outer edge, transparent background, exact camera geometry, and matched Black/White framing.',
    'Physical width and height are supported by a directly verified official Samsung or Google specification page.',
  ],
  summary: {
    sourceCandidates: sourceManifest.candidates.length,
    uniqueOfficialSourceImages: new Set(sourceProvenance.assets.map((asset) => asset.encodedSha256)).size,
    modelsVisuallyAccepted: models.length,
    candidateImagesVisuallyAccepted: models.length * 2,
    modelsPublicationEligible: models.length,
    modelsBlockedByCatalogIdentity: 0,
  },
  models,
  blockedModels: [],
  publicationPolicy: {
    acceptedOnly: true,
    requirePublicationEligible: true,
    requireExactPathAndSha256: true,
    requireOfficialDimensions: true,
    requireExactCameraOpeningProfile: true,
    requireShopifyFileMetaobjectProductMediaAndAllVariantAssociations: true,
  },
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`)
console.log(JSON.stringify({
  outputPath: path.relative(process.cwd(), OUTPUT_PATH),
  models: review.summary.modelsPublicationEligible,
  candidates: review.summary.candidateImagesVisuallyAccepted,
  uniqueOfficialSourceImages: review.summary.uniqueOfficialSourceImages,
  blocked: review.summary.modelsBlockedByCatalogIdentity,
}, null, 2))