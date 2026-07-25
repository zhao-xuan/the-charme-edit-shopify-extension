import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const finalReviewPath = 'reference/case-history/iphone-14-16-final-review.json'
const outputPath = 'reference/case-history/iphone-14-17-latest-promotion.json'
const publicAttemptDirectory = 'public/assets/cases/case-history/gpt-conversation-attempts'
const publicAttemptUrlRoot = '/assets/cases/case-history/gpt-conversation-attempts'
const shouldWrite = process.argv.includes('--write')

const expectedCandidates = new Map([
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

const productionBefore = new Map([
  ['iphone-14-plus:black', { imageVersion: 'v2', sha256: 'be4480e9e7c25881e39e82b504a10317b4743502859335f905286dca695c7201' }],
  ['iphone-14-plus:white', { imageVersion: 'v2', sha256: 'de3d1a2c8dc2334ac1737cdaaf120c21de2740cd138c8ca9491051e3efa80b71' }],
  ['iphone-14-pro:black', { imageVersion: 'v2', sha256: '9bf59496d4ce0692a9351e180eb557a26af0555dd066ce8bae2e198f2ad5f16d' }],
  ['iphone-14-pro:white', { imageVersion: 'v2', sha256: '44ca4d051a9717d3f0a3351d7561fc310d39c1a27d6312600e354028b15dd242' }],
  ['iphone-14-pro-max:black', { imageVersion: 'v2', sha256: 'afb1f90bd258ab7a9be950908abdfaa0eb494aa09c69cbb673280415ced4bce0' }],
  ['iphone-14-pro-max:white', { imageVersion: 'v2', sha256: 'c220f424f37679f5b80b478c458f9a4d844da6ed70bc9a5c3db122db0b44ad62' }],
  ['iphone-15:black', { imageVersion: 'v2', sha256: '0a7357868e3f294bbeded59b8dc7d61dae97ab594195490269a467e2becb0e3e' }],
  ['iphone-15:white', { imageVersion: 'v2', sha256: '77357a8fc4746473f5ea8e53dd184e7aff37cb696d1d88f4688d8e43764e2608' }],
  ['iphone-15-plus:black', { imageVersion: 'v2', sha256: '3aeb2b70d4978b88ad907f92c946c5db9ee3a4fef75e55e1c6e0eb552690f08d' }],
  ['iphone-15-plus:white', { imageVersion: 'v2', sha256: 'a0ab7f74c8b3ff08158cb97ed053b765d6e27ac9701c868456ab693493617777' }],
  ['iphone-15-pro:black', { imageVersion: 'v2', sha256: 'cfe588f2e7fb688643c2aa5bb29e5c8b4f1d3a918a44d5b7471e1311f090a78c' }],
  ['iphone-15-pro:white', { imageVersion: 'v2', sha256: 'edd9c0d7564d0d07887b93a79ab3facd3fc37f49aa28d5975ad966a9988642ed' }],
  ['iphone-16:black', { imageVersion: 'v1', sha256: null }],
  ['iphone-16:white', { imageVersion: 'v1', sha256: null }],
  ['iphone-16:glitter', { imageVersion: 'v3', sha256: 'f0fec25979b999b31c9626f58efca2805c12fb1fb762c2143e2ed53e3f797c50' }],
  ['iphone-16-plus:black', { imageVersion: 'v1', sha256: null }],
  ['iphone-16-plus:white', { imageVersion: 'v1', sha256: null }],
  ['iphone-16-pro:black', { imageVersion: 'v1', sha256: null }],
  ['iphone-16-pro:white', { imageVersion: 'v1', sha256: null }],
  ['iphone-16-pro-max:black', { imageVersion: 'v1', sha256: null }],
  ['iphone-16-pro-max:white', { imageVersion: 'v1', sha256: null }],
  ['iphone-17-pro:black', { imageVersion: 'v2', sha256: 'e7cccd1223a58265069e09c819f4376bc75cd22c8e2964f1483b04a7e8f9fbad' }],
  ['iphone-17-pro:white', { imageVersion: 'v2', sha256: '96980bb56db562d6c423a8e12174c872f4ac7cb9bc6aaa44930d5a17d446b3d6' }],
  ['iphone-17-pro-max:black', { imageVersion: 'v2', sha256: 'adf74dfd08438ddb9276ea82eb0f7a1f2a5bb83cbd0750fc05000b5bdf3c2a86' }],
  ['iphone-17-pro-max:white', { imageVersion: 'v2', sha256: 'c5b5a32979db173ded9528d4185f9fe8781ba995e97c8eb5eb638aa14efd1dd6' }],
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function keyOf(record) {
  return `${record.modelId}:${record.finish}`
}

async function imageIdentity(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error(`${filePath} is not a valid PNG`)
  }
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
  const copied = await imageIdentity(destinationPath)
  if (copied.sha256 !== expectedSha256) {
    throw new Error(`${destinationPath} exists with an unexpected SHA-256`)
  }
}

function restorationPrompt(restoration) {
  return `RESTORATION RECORD - THIS IS NOT A NEW IMAGE-GENERATION REQUEST.

Restore the exact accepted ${restoration.modelName} ${restoration.finish === 'black' ? 'Black' : 'White'} Gel asset from Git commit ${restoration.source.commit}, path ${restoration.source.path}. The restored working-tree file must be byte-for-byte identical to that Git blob, with SHA-256 ${restoration.sha256} and dimensions ${restoration.widthPx}x${restoration.heightPx}px.

Reason: a later local image overwrote the previously correct asset. Preserve the recovered original exactly. Do not regenerate, edit, crop, resize, recolour, re-encode, composite, post-process or substitute any pixels.`
}

if (expectedCandidates.size !== 21 || productionBefore.size !== 25) {
  throw new Error('Promotion target counts changed')
}

const review = JSON.parse(await readFile(finalReviewPath, 'utf8'))
if (
  review.publish !== false
  || review.setCurrent !== false
  || review.selections?.length !== 21
  || review.iphone17Restorations?.length !== 4
) {
  throw new Error(`${finalReviewPath} does not contain the approved 21 + 4 review set`)
}

const provenancePaths = [...new Set(review.selections.map((selection) => selection.provenance.provenancePath))]
const provenanceCandidates = []
for (const provenancePath of provenancePaths) {
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
  for (const candidate of provenance.candidates || []) {
    provenanceCandidates.push({ provenancePath, candidate })
  }
}

const prompts = []
for (const selection of review.selections) {
  const target = keyOf(selection)
  const expectedCandidateVersion = expectedCandidates.get(target)
  const before = productionBefore.get(target)
  if (!expectedCandidateVersion || !before || selection.candidateVersion !== expectedCandidateVersion) {
    throw new Error(`${target} is not an expected promotion candidate`)
  }
  if (
    !selection.qa.byteIntegrity.pass
    || !selection.qa.sourceCanvasRatio.pass
    || !selection.qa.redGuideResidue.pass
    || !(selection.qa.productFill?.pass ?? true)
  ) {
    throw new Error(`${selection.selectionKey} did not pass final numeric QA`)
  }

  const matches = provenanceCandidates.filter(({ provenancePath, candidate }) => (
    provenancePath === selection.provenance.provenancePath
    && candidate.modelId === selection.modelId
    && candidate.finish === selection.finish
    && candidate.candidateVersion === selection.candidateVersion
  ))
  if (matches.length !== 1) throw new Error(`${selection.selectionKey} has ${matches.length} provenance matches`)
  const candidate = matches[0].candidate
  if (
    candidate.sha256 !== selection.sha256
    || candidate.promptSha256 !== selection.provenance.promptSha256
    || sha256(candidate.promptText) !== candidate.promptSha256
    || candidate.candidatePath !== selection.candidatePath
  ) {
    throw new Error(`${selection.selectionKey} provenance changed`)
  }

  const identity = await imageIdentity(selection.candidatePath)
  if (
    identity.sha256 !== selection.sha256
    || identity.widthPx !== selection.widthPx
    || identity.heightPx !== selection.heightPx
  ) {
    throw new Error(`${selection.selectionKey} candidate bytes changed`)
  }

  const fileName = `${selection.modelId}-${selection.finish}-${selection.candidateVersion}.png`
  const localImagePath = path.join(publicAttemptDirectory, fileName)
  if (shouldWrite) await ensurePublicCopy(selection.candidatePath, localImagePath, selection.sha256)
  if (await fileExists(localImagePath)) {
    const publicIdentity = await imageIdentity(localImagePath)
    if (publicIdentity.sha256 !== selection.sha256) throw new Error(`${localImagePath} changed`)
  }

  prompts.push({
    modelId: selection.modelId,
    finish: selection.finish,
    candidateVersion: selection.candidateVersion,
    imageVersion: before.imageVersion,
    publish: true,
    setCurrent: true,
    resetReview: true,
    generator: candidate.generator || 'ChatGPT image generation',
    promptText: candidate.promptText,
    promptSha256: candidate.promptSha256,
    referenceImages: candidate.referenceImages || [],
    imagePath: `${publicAttemptUrlRoot}/${fileName}`,
    localImagePath,
    sourceCandidatePath: selection.candidatePath,
    sha256: identity.sha256,
    widthPx: identity.widthPx,
    heightPx: identity.heightPx,
    conversationUrl: candidate.conversationUrl || '',
    sourceUrl: candidate.sourceUrl || '',
    expectedCurrentBeforePublication: before.sha256,
  })
}

for (const restoration of review.iphone17Restorations) {
  const target = keyOf(restoration)
  const before = productionBefore.get(target)
  if (!before || restoration.restorationStatus !== 'exact-git-blob-match') {
    throw new Error(`${target} is not an expected exact restoration`)
  }
  const identity = await imageIdentity(restoration.destinationPath)
  if (
    identity.sha256 !== restoration.sha256
    || identity.widthPx !== restoration.widthPx
    || identity.heightPx !== restoration.heightPx
    || restoration.source.sha256 !== restoration.sha256
  ) {
    throw new Error(`${target} restoration bytes changed`)
  }

  const localImagePath = `public/assets/cases/case-history/${restoration.modelId}/${restoration.finish}/${before.imageVersion}.png`
  const imagePath = localImagePath.replace(/^public/, '')
  if (shouldWrite) await ensurePublicCopy(restoration.destinationPath, localImagePath, restoration.sha256)
  if (await fileExists(localImagePath)) {
    const publicIdentity = await imageIdentity(localImagePath)
    if (publicIdentity.sha256 !== restoration.sha256) throw new Error(`${localImagePath} changed`)
  }

  const promptText = restorationPrompt(restoration)
  prompts.push({
    modelId: restoration.modelId,
    finish: restoration.finish,
    restorationVersion: 'git-original-v1',
    imageVersion: before.imageVersion,
    publish: true,
    setCurrent: true,
    resetReview: true,
    generator: 'Git exact-byte restoration',
    promptText,
    promptSha256: sha256(promptText),
    referenceImages: [`git:${restoration.source.commit}:${restoration.source.path}`],
    imagePath,
    localImagePath,
    sourceCandidatePath: restoration.destinationPath,
    sha256: identity.sha256,
    widthPx: identity.widthPx,
    heightPx: identity.heightPx,
    conversationUrl: '',
    sourceUrl: '',
    expectedCurrentBeforePublication: before.sha256,
    restorationSource: restoration.source,
  })
}

if (prompts.length !== 25 || new Set(prompts.map(keyOf)).size !== 25) {
  throw new Error('Promotion must contain exactly 25 unique model/finish targets')
}
if (prompts.some((prompt) => !prompt.publish || !prompt.setCurrent || !prompt.resetReview)) {
  throw new Error('Every promotion record must publish, become current and reset review state')
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-14-17-latest-promotion',
  generatedBy: 'scripts/build-iphone-14-17-latest-promotion.mjs',
  approvedAt: '2026-07-24',
  promotionPolicy: 'Publish the 21 explicitly approved iPhone 14-16 candidates and four exact iPhone 17 Git restorations as immutable case-review image versions. Reset only these 25 review rows to checking.',
  sourceManifests: [finalReviewPath, ...provenancePaths],
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  records: prompts.length,
  generatedCandidates: prompts.filter((prompt) => prompt.candidateVersion).length,
  gitRestorations: prompts.filter((prompt) => prompt.restorationVersion).length,
  current: prompts.filter((prompt) => prompt.setCurrent).length,
  resetReview: prompts.filter((prompt) => prompt.resetReview).length,
  uniqueImages: new Set(prompts.map((prompt) => prompt.sha256)).size,
  publicCopiesPresent: (await Promise.all(prompts.map((prompt) => fileExists(prompt.localImagePath))))
    .filter(Boolean).length,
  wrote: shouldWrite,
  outputPath,
}, null, 2))