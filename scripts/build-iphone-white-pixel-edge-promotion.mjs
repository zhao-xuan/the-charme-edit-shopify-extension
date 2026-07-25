import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const generationManifestPath = 'reference/case-history/iphone-white-pixel-edge-regeneration.json'
const provenancePath = 'reference/case-history/generated/black-white-glitter-shape-trials/candidate-provenance.json'
const outputPath = 'reference/case-history/iphone-white-pixel-edge-promotion.json'
const campaignRoot = 'reference/case-history/generated/black-white-glitter-shape-trials'
const publicDirectory = 'public/assets/cases/case-history/gpt-conversation-attempts'
const publicUrlRoot = '/assets/cases/case-history/gpt-conversation-attempts'
const shouldWrite = process.argv.includes('--write')

const targets = [
  {
    modelId: 'iphone-11-pro-max',
    candidateVersion: 'v6-gpt',
    imageVersion: 'v3',
    sha256: '2224d00e07086cc27193275f1fca73ca08e0c276fcdf93949ec4899f4cbe0f9b',
  },
  {
    modelId: 'iphone-12-pro',
    candidateVersion: 'v4-gpt',
    imageVersion: 'v4',
    sha256: '1ed1106c245d6bf5b59030c23296372230070501fc222c9b85edf854026db84e',
  },
  {
    modelId: 'iphone-12-pro-max',
    candidateVersion: 'v2-gpt',
    imageVersion: 'v3',
    sha256: 'c7a3864d0cd4f3ac160e2a095383dff377d43ea2f615f64aafdfa652fc7405f2',
  },
  {
    modelId: 'iphone-13',
    candidateVersion: 'v2-gpt',
    imageVersion: 'v5',
    sha256: '489fe02fe165da4a8eb0ef01c3441da1cbb2b0525c6cf364a07c5e3d9282d989',
  },
  {
    modelId: 'iphone-13-mini',
    candidateVersion: 'v2-gpt',
    imageVersion: 'v3',
    sha256: 'a18759aaa4293e946c325ce5c61ca6efaba0db59463de4f82142b44984a301f8',
  },
  {
    modelId: 'iphone-14',
    candidateVersion: 'v12-gpt',
    imageVersion: 'v2',
    sha256: '4994ad083e3ab8dc48f93e43b936655161c30ecc237802c39da2aebb79a34e21',
  },
]

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function imageIdentity(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  return {
    sha256: sha256(bytes),
    widthPx: metadata.width,
    heightPx: metadata.height,
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensurePublicCopy(sourcePath, destinationPath, expectedSha256) {
  await mkdir(path.dirname(destinationPath), { recursive: true })
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const identity = await imageIdentity(destinationPath)
  if (identity.sha256 !== expectedSha256) {
    throw new Error(`${destinationPath} exists with an unexpected SHA-256`)
  }
}

function fullReferencePath(referencePath) {
  if (referencePath.startsWith('references/') || referencePath.startsWith('candidates/')) {
    return path.join(campaignRoot, referencePath)
  }
  return referencePath
}

const generationManifest = JSON.parse(await readFile(generationManifestPath, 'utf8'))
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
if (targets.length !== 6 || new Set(targets.map((target) => target.modelId)).size !== 6) {
  throw new Error('Promotion must contain exactly six unique models')
}

const prompts = []
for (const target of targets) {
  const generation = generationManifest.prompts.find((record) => (
    record.modelId === target.modelId
    && record.finish === 'white'
    && record.candidateVersion === target.candidateVersion
  ))
  if (!generation) throw new Error(`${target.modelId} generation record is missing`)
  if (generation.expectedImageVersion !== target.imageVersion) {
    throw new Error(`${target.modelId} expected image version changed`)
  }
  if (sha256(generation.promptText) !== generation.promptSha256) {
    throw new Error(`${target.modelId} generation prompt SHA-256 changed`)
  }

  const candidates = provenance.candidates.filter((candidate) => (
    candidate.modelId === target.modelId
    && candidate.finish === 'white'
    && candidate.candidateVersion === target.candidateVersion
  ))
  if (candidates.length !== 1) {
    throw new Error(`${target.modelId} has ${candidates.length} matching provenance records`)
  }
  const candidate = candidates[0]
  if (candidate.reviewStatus !== 'accepted-candidate') {
    throw new Error(`${target.modelId} is not an accepted candidate`)
  }
  if (candidate.sha256 !== target.sha256 || candidate.promptSha256 !== generation.promptSha256) {
    throw new Error(`${target.modelId} accepted identity changed`)
  }

  const generationReferences = generation.referenceImages
  const provenanceReferences = (candidate.referenceImages || []).map(fullReferencePath)
  if (JSON.stringify(generationReferences) !== JSON.stringify(provenanceReferences)) {
    throw new Error(`${target.modelId} reference order changed`)
  }

  const fileName = `${target.modelId}-white-${target.candidateVersion}.png`
  const expectedCandidatePath = `candidates/${fileName}`
  if (candidate.imagePath !== expectedCandidatePath) {
    throw new Error(`${target.modelId} candidate path is not ${expectedCandidatePath}`)
  }
  const sourceCandidatePath = path.join(campaignRoot, candidate.imagePath)
  const identity = await imageIdentity(sourceCandidatePath)
  if (
    identity.sha256 !== target.sha256
    || identity.widthPx !== candidate.widthPx
    || identity.heightPx !== candidate.heightPx
  ) {
    throw new Error(`${target.modelId} candidate bytes do not match provenance`)
  }

  const localImagePath = path.join(publicDirectory, fileName)
  if (shouldWrite) await ensurePublicCopy(sourceCandidatePath, localImagePath, target.sha256)
  if (await fileExists(localImagePath)) {
    const publicIdentity = await imageIdentity(localImagePath)
    if (publicIdentity.sha256 !== target.sha256) {
      throw new Error(`${localImagePath} does not match the accepted candidate`)
    }
  }

  prompts.push({
    modelId: target.modelId,
    finish: 'white',
    candidateVersion: target.candidateVersion,
    imageVersion: target.imageVersion,
    publish: true,
    setCurrent: true,
    generator: candidate.generator || generation.generator,
    promptText: generation.promptText,
    promptSha256: generation.promptSha256,
    referenceImages: candidate.referenceImages,
    imagePath: `${publicUrlRoot}/${fileName}`,
    localImagePath,
    sourceCandidatePath,
    sha256: identity.sha256,
    widthPx: identity.widthPx,
    heightPx: identity.heightPx,
    conversationUrl: candidate.conversationUrl || '',
    sourceUrl: candidate.sourceUrl || '',
    reviewStatus: candidate.reviewStatus,
    reviewNotes: candidate.reviewNotes || '',
  })
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-white-pixel-edge-promotion',
  generatedBy: 'scripts/build-iphone-white-pixel-edge-promotion.mjs',
  promotionPolicy: 'Publish only the six requested particle-free White replacements. Black and every unrelated history remain unchanged.',
  sourceManifests: [generationManifestPath, provenancePath],
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(JSON.stringify({
  records: prompts.length,
  current: prompts.filter((prompt) => prompt.setCurrent).length,
  uniqueImages: new Set(prompts.map((prompt) => prompt.sha256)).size,
  uniquePrompts: new Set(prompts.map((prompt) => prompt.promptSha256)).size,
  publicCopiesPresent: await Promise.all(prompts.map((prompt) => fileExists(prompt.localImagePath)))
    .then((present) => present.filter(Boolean).length),
  wrote: shouldWrite ? outputPath : false,
}, null, 2))