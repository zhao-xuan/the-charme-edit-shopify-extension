#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE_DIR = 'reference/case-history/generated/all-phone-real-image-completion'
const SOURCE_MANIFEST_PATH = `${BASE_DIR}/spigen-a-series-case-sources.json`
const SOURCE_PROVENANCE_PATH = `${BASE_DIR}/spigen-a-series-case-asset-provenance.json`
const DERIVATION_PROVENANCE_PATH = `${BASE_DIR}/spigen-a-series-case-derived-provenance.json`
const OUTPUT_PATH = `${BASE_DIR}/spigen-a-series-case-review.json`
const REVIEWED_AT = '2026-08-01T20:35:00.000Z'

const OFFICIAL_DIMENSIONS = {
  'galaxy-a12-4g': {
    widthMm: 75.8,
    heightMm: 164,
    depthMm: 8.9,
    reportedValue: '164.0 x 75.8 x 8.9',
    sourceUrl: 'https://www.samsung.com/sg/business/smartphones/galaxy-a/galaxy-a12-a125-sm-a125fzkhxsp/',
    sourcePageTitle: 'Galaxy A12 Black 128 GB | Samsung Business Singapore',
  },
  'galaxy-a21s-4g': {
    widthMm: 75.3,
    heightMm: 163.7,
    depthMm: 8.9,
    reportedValue: '163.7 x 75.3 x 8.9',
    sourceUrl: 'https://www.samsung.com/sa_en/smartphones/galaxy-a/galaxy-a21s-black-128gb-sm-a217fzkjksa/',
    sourcePageTitle: 'Samsung Galaxy A21s - Black 128GB | Samsung KSA',
  },
  'galaxy-a25': {
    widthMm: 76.5,
    heightMm: 161,
    depthMm: 8.3,
    reportedValue: '161.0 x 76.5 x 8.3',
    sourceUrl: 'https://www.samsung.com/uk/business/smartphones/galaxy-a/galaxy-a25-5g-blue-128gb-sm-a256bzbdeub/',
    sourcePageTitle: 'Samsung Galaxy A25 Smartphone | View Specs | Samsung Business UK',
  },
  'galaxy-a26-5g': {
    widthMm: 77.5,
    heightMm: 164,
    depthMm: 7.7,
    reportedValue: '164.0 x 77.5 x 7.7',
    sourceUrl: 'https://www.samsung.com/be/smartphones/galaxy-a/galaxy-a26-5g-black-128gb-sm-a266bzkbeub/',
    sourcePageTitle: 'Galaxy A26 | 128GB | Black | Smartphones | Samsung BE',
  },
  'galaxy-a32-5g': {
    widthMm: 76.1,
    heightMm: 164.2,
    depthMm: 9.1,
    reportedValue: '164.2 x 76.1 x 9.1',
    sourceUrl: 'https://www.samsung.com/ie/business/smartphones/galaxy-a/galaxy-a32-5g-sm-a326bzwueua/',
    sourcePageTitle: 'Buy White Samsung Galaxy A32 5G | Samsung Business Ireland',
  },
  'galaxy-a33': {
    widthMm: 74,
    heightMm: 159.7,
    depthMm: 8.1,
    reportedValue: '159.7 x 74.0 x 8.1',
    sourceUrl: 'https://www.samsung.com/uk/business/smartphones/galaxy-a/galaxy-a33-5g-awesome-blue-128gb-sm-a336blbgeub/',
    sourcePageTitle: 'Galaxy A33 5G | Specs & Camera | Samsung Business UK',
  },
  'galaxy-a34': {
    widthMm: 78.1,
    heightMm: 161.3,
    depthMm: 8.2,
    reportedValue: '161.3 x 78.1 x 8.2',
    sourceUrl: 'https://www.samsung.com/uk/business/smartphones/galaxy-a/galaxy-a34-5g-lime-256gb-sm-a346blgeeub/',
    sourcePageTitle: 'Samsung Galaxy A34 5G | View Specs | Samsung Business UK',
  },
  'galaxy-a35': {
    widthMm: 78,
    heightMm: 161.7,
    depthMm: 8.2,
    reportedValue: '161.7 x 78.0 x 8.2',
    sourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a35-5g-awesome-navy-128gb-sm-a356bzkbeub/',
    sourcePageTitle: 'Samsung Galaxy A35 5G | Specs, Camera & Battery | Samsung UK',
  },
  'galaxy-a36-5g': {
    widthMm: 78.2,
    heightMm: 162.9,
    depthMm: 7.4,
    reportedValue: '162.9 x 78.2 x 7.4',
    sourceUrl: 'https://www.samsung.com/uk/smartphones/galaxy-a/galaxy-a36-5g-awesome-lavender-256gb-sm-a366blvgeub/',
    sourcePageTitle: 'Samsung Galaxy A36 5G | Features & Specs | Samsung UK',
  },
  'galaxy-a50': {
    widthMm: 74.7,
    heightMm: 158.5,
    depthMm: 7.7,
    reportedValue: '158.5 x 74.7 x 7.7',
    sourceUrl: 'https://www.samsung.com/ie/business/smartphones/galaxy-a/galaxy-a50-sm-a505fzksbtu/',
    sourcePageTitle: 'Samsung Galaxy A50 (Black) | Samsung Business Ireland',
  },
  'galaxy-a51-4g': {
    widthMm: 73.6,
    heightMm: 158.5,
    depthMm: 7.9,
    reportedValue: '158.5 x 73.6 x 7.9',
    sourceUrl: 'https://www.samsung.com/ie/business/smartphones/galaxy-a/galaxy-a51-sm-a515fzkveua/',
    sourcePageTitle: 'Buy Galaxy A51 4G, Black | View Prices | Samsung Business Ireland',
  },
}

const VISUALLY_ACCEPTED_MODEL_IDS = new Set(Object.keys(OFFICIAL_DIMENSIONS))

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
const blockedSources = sourceManifest.candidates.filter((candidate) => !candidate.publicationEligible)
const eligibleIds = new Set(eligibleSources.map((candidate) => candidate.targetModelId))
const derivedIds = new Set(derivation.results.map((result) => result.modelId))

assert(sourceManifest.candidates.length === 15, `Expected 15 source candidates, found ${sourceManifest.candidates.length}`)
assert(eligibleSources.length === 11, `Expected 11 eligible source candidates, found ${eligibleSources.length}`)
assert(blockedSources.length === 4, `Expected 4 blocked source candidates, found ${blockedSources.length}`)
assert(derivation.results.length === 11, `Expected 11 derived models, found ${derivation.results.length}`)
assertExactSet(eligibleIds, VISUALLY_ACCEPTED_MODEL_IDS, 'Eligible source models')
assertExactSet(derivedIds, VISUALLY_ACCEPTED_MODEL_IDS, 'Derived models')

const provenanceById = new Map(
  sourceProvenance.assets.map((result) => [result.targetModelId, result]),
)
const sourceById = new Map(eligibleSources.map((candidate) => [candidate.targetModelId, candidate]))
const models = []

for (const result of derivation.results) {
  const source = sourceById.get(result.modelId)
  const downloaded = provenanceById.get(result.modelId)
  const dimensions = OFFICIAL_DIMENSIONS[result.modelId]
  assert(source, `${result.modelId}: eligible source record missing`)
  assert(downloaded, `${result.modelId}: download provenance missing`)
  assert(dimensions, `${result.modelId}: official dimensions missing`)
  assert(downloaded.repeatedFetchByteIdentical, `${result.modelId}: repeated source download differs`)
  assert(downloaded.productRecordVerified, `${result.modelId}: Spigen product record was not verified`)
  assert(result.sourceAsset.sourceUrl === source.sourceUrl, `${result.modelId}: source URL mismatch`)
  assert(result.sourceAsset.sku === source.sku, `${result.modelId}: source SKU mismatch`)
  assert(result.sourceAsset.gtin === source.gtin, `${result.modelId}: source GTIN mismatch`)
  assert(result.alpha.upperRightCameraHolePassed, `${result.modelId}: camera-opening QA failed`)
  assert(result.sourceGeometry.minimumThresholdIou >= result.sourceGeometry.requiredMinimumThresholdIou, `${result.modelId}: threshold IoU failed`)
  assert(result.sourceGeometry.maximumBoundsDrift <= result.sourceGeometry.allowedMaximumBoundsDrift, `${result.modelId}: threshold bounds drift failed`)

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

  models.push({
    modelId: result.modelId,
    modelName: result.modelName,
    reviewStatus: 'accepted',
    publicationEligible: true,
    visualReview: {
      status: 'accepted',
      criteria: 'Complete orthogonal body, exact camera openings, clean outer edge, transparent background, and matched Black/White geometry.',
    },
    officialDimensions: {
      ...dimensions,
      reportedLabel: 'Dimension (HxWxD, mm)',
      reportedOrder: 'height x width x depth',
      directPageVerification: {
        httpStatus: 200,
        modelIdentityFound: true,
        reportedValueFound: true,
        verifiedAt: REVIEWED_AT,
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
      significantCameraOpenings: result.alpha.significantHoles.length,
      upperRightCameraHolePassed: result.alpha.upperRightCameraHolePassed,
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
    'Official Spigen product records, variant titles, media identity, SKU, and GTIN identify the exact target geometry.',
    'Every official source is byte-identical across repeated downloads and its local SHA-256 remains locked.',
    'Foreground threshold samples 11, 12, and 13 retain IoU of at least 0.995 with no more than four pixels of bounds drift.',
    'Artifact cleanup preserves every significant upper-right camera opening while removing enclosed texture-derived cracks.',
    'Black and White outputs use the exact same alpha, preserve transparent openings, contain zero hidden RGB, and have neutral RGB channels.',
    'Visual review confirms a complete orthogonal body, clean outer edge, transparent background, exact camera geometry, and matched Black/White framing.',
    'Physical width and height are supported by a directly verified official Samsung product page.',
  ],
  summary: {
    sourceCandidates: sourceManifest.candidates.length,
    modelsVisuallyAccepted: models.length,
    candidateImagesVisuallyAccepted: models.length * 2,
    modelsPublicationEligible: models.length,
    modelsBlockedByCatalogIdentity: blockedSources.length,
  },
  models,
  blockedModels: blockedSources.map((source) => ({
    modelId: source.targetModelId,
    modelName: source.targetModelName,
    reviewStatus: 'accepted-image-blocked-catalog',
    publicationEligible: false,
    blockReason: source.eligibilityReason,
    sourceModelId: source.sourceModelId,
    productRecordUrl: sourceManifest.products[source.product].productRecordUrl,
    sourceUrl: source.sourceUrl,
    sku: source.sku,
    gtin: source.gtin,
  })),
  publicationPolicy: {
    acceptedOnly: true,
    requirePublicationEligible: true,
    requireExactPathAndSha256: true,
    requireOfficialDimensions: true,
    requireShopifyFileMetaobjectProductMediaAndAllVariantAssociations: true,
  },
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(review, null, 2)}\n`)
console.log(JSON.stringify({
  outputPath: path.relative(process.cwd(), OUTPUT_PATH),
  models: review.summary.modelsPublicationEligible,
  candidates: review.summary.candidateImagesVisuallyAccepted,
  blocked: review.summary.modelsBlockedByCatalogIdentity,
}, null, 2))