import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outputPath = 'reference/case-history/iphone-14-16-final-review.json'
const shouldWrite = process.argv.includes('--write')
const restorationCommit = 'd29eaa7560f7a071ecccabe6facc35ed22f878ea'

const provenancePaths = [
  'reference/case-history/generated/iphone-14-16-user-corrections/candidate-provenance.json',
  'reference/case-history/generated/iphone-16-logo-safe-shape-corrections/candidate-provenance.json',
  'reference/case-history/generated/iphone-16-shape-grid-retries/candidate-provenance.json',
  'reference/case-history/generated/iphone-14-15-grid-retries/candidate-provenance.json',
]

const selectionVersions = new Map([
  ['iphone-14-plus:black', 'v4-gpt'],
  ['iphone-14-plus:white', 'v3-gpt'],
  ['iphone-14-pro:black', 'v5-gpt'],
  ['iphone-14-pro:white', 'v3-gpt'],
  ['iphone-14-pro-max:black', 'v5-gpt'],
  ['iphone-14-pro-max:white', 'v2-gpt'],
  ['iphone-15:black', 'v2-gpt'],
  ['iphone-15:white', 'v4-gpt'],
  ['iphone-15-plus:black', 'v4-gpt'],
  ['iphone-15-plus:white', 'v3-gpt'],
  ['iphone-15-pro:black', 'v8-gpt'],
  ['iphone-15-pro:white', 'v3-gpt'],
  ['iphone-16:black', 'v6-gpt'],
  ['iphone-16:white', 'v3-gpt'],
  ['iphone-16:glitter', 'v1-gpt'],
  ['iphone-16-plus:black', 'v1-gpt'],
  ['iphone-16-plus:white', 'v2-gpt'],
  ['iphone-16-pro:black', 'v1-gpt'],
  ['iphone-16-pro:white', 'v1-gpt'],
  ['iphone-16-pro-max:black', 'v1-gpt'],
  ['iphone-16-pro-max:white', 'v1-gpt'],
])

const reviewPairModelIds = [
  'iphone-14-plus',
  'iphone-14-pro',
  'iphone-14-pro-max',
  'iphone-15',
  'iphone-15-plus',
  'iphone-15-pro',
  'iphone-16',
  'iphone-16-plus',
  'iphone-16-pro',
  'iphone-16-pro-max',
]

const protectedNonTargets = [
  {
    target: 'iphone-15-pro-max:*',
    reason: 'Not requested in the iPhone 14/15 size-correction scope',
  },
  {
    target: 'iphone-16-plus:glitter',
    reason: 'Authoritative geometry benchmark; preserve without regeneration',
  },
  {
    target: 'iphone-16-pro:glitter',
    reason: 'Only Black and White were requested for full regeneration',
  },
  {
    target: 'iphone-16-pro-max:glitter',
    reason: 'Only Black and White were requested for full regeneration',
  },
]

const restoredIphone17Assets = [
  {
    modelId: 'iphone-17-pro',
    modelName: 'iPhone 17 Pro',
    finish: 'black',
    destinationPath: 'public/assets/cases/case-with-gel/integrated-iphone-17-pro-black.png',
    sha256: 'e2fa58daca606a5093a24d527264288404659b8973decd88d3450f0d26a6dd8b',
    widthPx: 784,
    heightPx: 1659,
  },
  {
    modelId: 'iphone-17-pro',
    modelName: 'iPhone 17 Pro',
    finish: 'white',
    destinationPath: 'public/assets/cases/case-with-gel/integrated-iphone-17-pro-white.png',
    sha256: '60984c87a65c3e5938ad576cf001c8e6d3afc7f6b4cb36ef5a2620c60f52dd77',
    widthPx: 784,
    heightPx: 1659,
  },
  {
    modelId: 'iphone-17-pro-max',
    modelName: 'iPhone 17 Pro Max',
    finish: 'black',
    destinationPath: 'public/assets/cases/case-with-gel/integrated-iphone-17-pro-max-black.png',
    sha256: 'e1cb233191d169ec6845bdd926fb26b4762c7163c04baf478ec57b2a932d625c',
    widthPx: 780,
    heightPx: 1643,
  },
  {
    modelId: 'iphone-17-pro-max',
    modelName: 'iPhone 17 Pro Max',
    finish: 'white',
    destinationPath: 'public/assets/cases/case-with-gel/integrated-iphone-17-pro-max-white.png',
    sha256: 'b8e7460a4cd8387b71d3f35ece5d328aa02e9f17f6dd656e53f7c496b8c4ca1c',
    widthPx: 780,
    heightPx: 1643,
  },
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function round(value) {
  return Number(value.toFixed(6))
}

function candidateKey(candidate) {
  return `${candidate.modelId}:${candidate.finish}`
}

function matchesProtectedTarget(pattern, target) {
  return pattern.endsWith('*')
    ? target.startsWith(pattern.slice(0, -1))
    : target === pattern
}

async function imageEvidence(filePath) {
  const bytes = await readFile(filePath)
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let alphaHasBackground = false
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * 4 + 3] <= 40) {
      alphaHasBackground = true
      break
    }
  }

  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  let redGuideLikePixels = 0
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    const alpha = data[offset + 3]
    const isSubject = alphaHasBackground
      ? alpha > 40
      : Math.min(data[offset], data[offset + 1], data[offset + 2]) < 246
    if (isSubject) {
      const x = index % info.width
      const y = Math.floor(index / info.width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
    if (
      alpha > 40
      && data[offset] > 180
      && data[offset] - data[offset + 1] > 55
      && data[offset] - data[offset + 2] > 55
    ) {
      redGuideLikePixels += 1
    }
  }
  if (right < left || bottom < top) throw new Error(`No visible subject in ${filePath}`)

  return {
    bytes,
    sha256: sha256(bytes),
    widthPx: info.width,
    heightPx: info.height,
    canvasRatio: info.width / info.height,
    productBounds: [left, top, right, bottom],
    widthFill: (right - left + 1) / info.width,
    heightFill: (bottom - top + 1) / info.height,
    redGuideLikePixels,
  }
}

async function metadataEvidence(filePath) {
  const metadata = await sharp(filePath).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error(`${filePath} is not a valid PNG`)
  }
  return {
    widthPx: metadata.width,
    heightPx: metadata.height,
    canvasRatio: metadata.width / metadata.height,
  }
}

function assertCandidateContract(candidate, provenancePath) {
  const key = `${candidateKey(candidate)}:${candidate.candidateVersion}`
  if (candidate.publish !== false || candidate.setCurrent !== false) {
    throw new Error(`${key} in ${provenancePath} is not candidate-only`)
  }
  if (candidate.reviewStatus !== 'pending-review') {
    throw new Error(`${key} is ${candidate.reviewStatus}, not pending-review`)
  }
  if (sha256(candidate.promptText) !== candidate.promptSha256) {
    throw new Error(`${key} has a mismatched prompt hash`)
  }
}

async function verifySelectedCandidate(candidate, provenancePath, campaign) {
  assertCandidateContract(candidate, provenancePath)
  await Promise.all(candidate.referenceImages.map((filePath) => access(filePath)))
  const evidence = await imageEvidence(candidate.candidatePath)
  if (
    evidence.sha256 !== candidate.sha256
    || evidence.widthPx !== candidate.widthPx
    || evidence.heightPx !== candidate.heightPx
  ) {
    throw new Error(`${candidateKey(candidate)}:${candidate.candidateVersion} does not match provenance`)
  }

  const sourcePath = candidate.referenceImages[0]
  const source = await metadataEvidence(sourcePath)
  const relativeRatioDrift = Math.abs(evidence.canvasRatio / source.canvasRatio - 1)
  const requiresSizeGate = candidate.modelId.startsWith('iphone-14') || candidate.modelId.startsWith('iphone-15')
  const maximumRelativeRatioDrift = requiresSizeGate || campaign === 'iphone-16-shape-grid-retries'
    ? 0.01
    : 0.02
  const sourceRatioPass = relativeRatioDrift <= maximumRelativeRatioDrift
  const redResiduePass = evidence.redGuideLikePixels === 0
  const sizeGatePass = !requiresSizeGate || (evidence.widthFill >= 0.97 && evidence.heightFill >= 0.98)
  if (!sourceRatioPass || !redResiduePass || !sizeGatePass) {
    throw new Error(`${candidateKey(candidate)}:${candidate.candidateVersion} failed final numeric QA`)
  }

  return {
    selectionKey: `${candidateKey(candidate)}:${candidate.candidateVersion}`,
    modelId: candidate.modelId,
    modelName: candidate.modelName,
    finish: candidate.finish,
    correctionType: candidate.correctionType,
    candidateVersion: candidate.candidateVersion,
    candidatePath: candidate.candidatePath,
    sha256: candidate.sha256,
    widthPx: candidate.widthPx,
    heightPx: candidate.heightPx,
    publish: false,
    setCurrent: false,
    reviewStatus: 'pending-user-paired-review',
    provenance: {
      provenancePath,
      campaign,
      promptSha256: candidate.promptSha256,
      conversationUrl: candidate.conversationUrl,
      recordedAt: candidate.recordedAt,
    },
    authority: {
      sourcePath,
      hardwarePath: candidate.referenceImages.find((filePath) => filePath.includes('camera-lock')) || null,
    },
    qa: {
      byteIntegrity: {
        pass: true,
        sha256: evidence.sha256,
        widthPx: evidence.widthPx,
        heightPx: evidence.heightPx,
      },
      sourceCanvasRatio: {
        pass: sourceRatioPass,
        maximumRelativeDrift: maximumRelativeRatioDrift,
        relativeDrift: round(relativeRatioDrift),
        sourceWidthPx: source.widthPx,
        sourceHeightPx: source.heightPx,
        sourceRatio: round(source.canvasRatio),
        candidateRatio: round(evidence.canvasRatio),
      },
      redGuideResidue: {
        pass: redResiduePass,
        pixels: evidence.redGuideLikePixels,
      },
      ...(requiresSizeGate ? {
        productFill: {
          pass: sizeGatePass,
          minimumWidthFill: 0.97,
          minimumHeightFill: 0.98,
          productBounds: evidence.productBounds,
          widthFill: round(evidence.widthFill),
          heightFill: round(evidence.heightFill),
        },
      } : {}),
      hardwareIdentity: {
        status: 'pending-user-paired-review',
        authorityPath: candidate.referenceImages.find((filePath) => filePath.includes('camera-lock')) || null,
      },
    },
  }
}

async function verifyHistoricalCandidate(candidate, provenancePath) {
  const evidence = await imageEvidence(candidate.candidatePath)
  if (
    evidence.sha256 !== candidate.sha256
    || evidence.widthPx !== candidate.widthPx
    || evidence.heightPx !== candidate.heightPx
  ) {
    throw new Error(`${candidateKey(candidate)}:${candidate.candidateVersion} history does not match provenance`)
  }
  if (candidate.publish !== false || candidate.setCurrent !== false) {
    throw new Error(`${candidateKey(candidate)}:${candidate.candidateVersion} history is not candidate-only`)
  }
  return {
    target: candidateKey(candidate),
    candidateVersion: candidate.candidateVersion,
    candidatePath: candidate.candidatePath,
    sha256: candidate.sha256,
    reviewStatus: candidate.reviewStatus,
    provenancePath,
  }
}

async function verifyRestoration(asset, commitDate, commitSubject) {
  const currentBytes = await readFile(asset.destinationPath)
  const historicalBytes = execFileSync('/usr/bin/git', [
    'show',
    `${restorationCommit}:${asset.destinationPath}`,
  ], { encoding: null, maxBuffer: 100 * 1024 * 1024 })
  const metadata = await metadataEvidence(asset.destinationPath)
  const currentSha256 = sha256(currentBytes)
  const historicalSha256 = sha256(historicalBytes)
  if (
    currentSha256 !== asset.sha256
    || historicalSha256 !== asset.sha256
    || !currentBytes.equals(historicalBytes)
    || metadata.widthPx !== asset.widthPx
    || metadata.heightPx !== asset.heightPx
  ) {
    throw new Error(`${asset.destinationPath} is not an exact restoration from ${restorationCommit}`)
  }
  return {
    modelId: asset.modelId,
    modelName: asset.modelName,
    finish: asset.finish,
    destinationPath: asset.destinationPath,
    sha256: asset.sha256,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
    restorationStatus: 'exact-git-blob-match',
    deploymentStatus: 'local-only-unpublished',
    source: {
      type: 'git-blob',
      commit: restorationCommit,
      commitDate,
      commitSubject,
      path: asset.destinationPath,
      sha256: historicalSha256,
    },
  }
}

if (selectionVersions.size !== 21) {
  throw new Error(`Expected 21 explicit selections, found ${selectionVersions.size}`)
}
if ([...selectionVersions.keys()].some((selectionTarget) => (
  protectedNonTargets.some(({ target }) => matchesProtectedTarget(target, selectionTarget))
))) {
  throw new Error('A protected non-target was selected')
}

const provenanceDocuments = await Promise.all(provenancePaths.map(async (provenancePath) => {
  const document = JSON.parse(await readFile(provenancePath, 'utf8'))
  if (document.publish !== false) throw new Error(`${provenancePath} is not unpublished`)
  return { provenancePath, document }
}))
const provenanceCandidates = provenanceDocuments.flatMap(({ provenancePath, document }) => (
  document.candidates.map((candidate) => ({
    provenancePath,
    campaign: document.campaign,
    candidate,
  }))
))

const selections = []
for (const [target, candidateVersion] of selectionVersions) {
  const matches = provenanceCandidates.filter(({ candidate }) => (
    candidateKey(candidate) === target && candidate.candidateVersion === candidateVersion
  ))
  if (matches.length !== 1) {
    throw new Error(`${target}:${candidateVersion} has ${matches.length} provenance matches`)
  }
  const { candidate, provenancePath, campaign } = matches[0]
  selections.push(await verifySelectedCandidate(candidate, provenancePath, campaign))
}
if (new Set(selections.map(({ modelId, finish }) => `${modelId}:${finish}`)).size !== 21) {
  throw new Error('Final selections do not contain 21 unique model/finish targets')
}

const supersededCandidates = []
for (const { provenancePath, candidate } of provenanceCandidates) {
  const selectedVersion = selectionVersions.get(candidateKey(candidate))
  if (!selectedVersion || candidate.candidateVersion === selectedVersion) continue
  supersededCandidates.push(await verifyHistoricalCandidate(candidate, provenancePath))
}

const reviewPairs = reviewPairModelIds.map((modelId) => {
  const black = selections.find((selection) => selection.modelId === modelId && selection.finish === 'black')
  const white = selections.find((selection) => selection.modelId === modelId && selection.finish === 'white')
  if (!black || !white) throw new Error(`${modelId} does not have a complete Black/White review pair`)
  return {
    modelId,
    modelName: black.modelName,
    reviewStatus: 'pending-user-paired-review',
    blackSelectionKey: black.selectionKey,
    whiteSelectionKey: white.selectionKey,
  }
})

const commitMetadata = execFileSync('/usr/bin/git', [
  'show',
  '-s',
  '--format=%cI%x09%s',
  restorationCommit,
], { encoding: 'utf8' }).trim()
const [commitDate, ...commitSubjectParts] = commitMetadata.split('\t')
const commitSubject = commitSubjectParts.join('\t')
const iphone17Restorations = []
for (const asset of restoredIphone17Assets) {
  iphone17Restorations.push(await verifyRestoration(asset, commitDate, commitSubject))
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-14-16-final-review',
  generatedBy: 'scripts/build-iphone-14-16-final-review.mjs',
  assembledFromProvenanceThrough: selections
    .map((selection) => selection.provenance.recordedAt)
    .sort()
    .at(-1),
  publish: false,
  setCurrent: false,
  candidateOnly: true,
  reviewStatus: 'pending-user-paired-review',
  policy: 'Candidate aggregation and QA evidence only. Do not publish, deploy, seed, sync or replace current assets before explicit user approval.',
  qaPolicy: {
    iphone14And15MinimumWidthFill: 0.97,
    iphone14And15MinimumHeightFill: 0.98,
    strictSourceCanvasRatioDrift: 0.01,
    otherIphone16SourceCanvasRatioDrift: 0.02,
    maximumRedGuideLikePixels: 0,
    hardwareIdentity: 'Requires final paired visual review against the recorded hardware authority image',
  },
  summary: {
    selectedCandidates: selections.length,
    blackWhiteReviewPairs: reviewPairs.length,
    additionalSelections: 1,
    supersededCandidates: supersededCandidates.length,
    explicitlyFailedCandidates: supersededCandidates.filter(({ reviewStatus }) => reviewStatus.startsWith('failed-')).length,
    exactIphone17Restorations: iphone17Restorations.length,
  },
  provenancePaths,
  reviewPairs,
  additionalSelections: [
    {
      selectionKey: 'iphone-16:glitter:v1-gpt',
      reason: 'Requested iPhone 16 geometry-only correction; reviewed separately from Black/White pair',
    },
  ],
  protectedNonTargets,
  selections,
  supersededCandidates,
  iphone17Restorations,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  selectedCandidates: selections.length,
  blackWhiteReviewPairs: reviewPairs.length,
  additionalSelections: manifest.additionalSelections.length,
  supersededCandidates: supersededCandidates.length,
  explicitlyFailedCandidates: manifest.summary.explicitlyFailedCandidates,
  exactIphone17Restorations: iphone17Restorations.length,
  numericQaPassed: selections.every((selection) => (
    selection.qa.byteIntegrity.pass
    && selection.qa.sourceCanvasRatio.pass
    && selection.qa.redGuideResidue.pass
    && (selection.qa.productFill?.pass ?? true)
  )),
  wrote: shouldWrite,
  outputPath,
}, null, 2))