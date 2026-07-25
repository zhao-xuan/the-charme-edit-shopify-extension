import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sourceManifestPath = 'reference/case-history/iphone-14-16-user-corrections.json'
const outputPath = 'reference/case-history/iphone-16-logo-safe-shape-corrections.json'
const shouldWrite = process.argv.includes('--write')

const candidateVersions = new Map([
  ['iphone-16:black', 'v5-gpt'],
  ['iphone-16:white', 'v2-gpt'],
  ['iphone-16:glitter', 'v1-gpt'],
  ['iphone-16-plus:black', 'v1-gpt'],
  ['iphone-16-plus:white', 'v1-gpt'],
])

const retryKeys = new Set(['iphone-16:black', 'iphone-16:white'])
const guideReplacements = new Map([
  [
    'trial-iphone-16-black-plus-glitter-shape-guide.png',
    'trial-iphone-16-black-plus-glitter-logo-safe-shape-guide.png',
  ],
  [
    'trial-iphone-16-white-plus-glitter-shape-guide.png',
    'trial-iphone-16-white-plus-glitter-logo-safe-shape-guide.png',
  ],
  [
    'trial-iphone-16-glitter-plus-glitter-shape-guide.png',
    'trial-iphone-16-glitter-plus-glitter-logo-safe-shape-guide.png',
  ],
  [
    'trial-iphone-16-plus-black-glitter-shape-guide.png',
    'trial-iphone-16-plus-black-logo-safe-shape-guide.png',
  ],
  [
    'trial-iphone-16-plus-white-glitter-shape-guide.png',
    'trial-iphone-16-plus-white-logo-safe-shape-guide.png',
  ],
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function assertMissing(filePath) {
  try {
    await access(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`${filePath} already exists; increment candidateVersion`)
}

function logoSafePrefix(isRetry) {
  const attempt = isRetry
    ? 'LOGO-SAFE RETRY - the prior generated candidate failed because it exposed a central Apple logo. Discard that result completely and start again from the authoritative attachments.'
    : 'LOGO-SAFE GEOMETRY PRECAUTION - use the authoritative attachments to create this new candidate.'
  return `${attempt}

The opaque solid-red geometry attachment intentionally replaces the earlier translucent guide. It has SHAPE AND POSITION authority only. Its solid interior deliberately hides all source branding so no logo can leak through the Gel. Replace every red pixel with the requested unchanged Gel material and leave the entire broad Gel centre blank and unbranded: no Apple logo, silhouette, ghost, embossing, debossing, tonal mark, icon, text or symbol. Never infer hidden content beneath the opaque red region. All original attachment-authority rules still apply, and only the Gel footprint may change.`
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const sourcePrompts = sourceManifest.prompts.filter((entry) => (
  entry.correctionType === 'iphone-16-plus-glitter-v2-geometry-only'
))

const prompts = []
for (const source of sourcePrompts) {
  const key = `${source.modelId}:${source.finish}`
  const candidateVersion = candidateVersions.get(key)
  if (!candidateVersion) throw new Error(`Missing logo-safe version for ${key}`)

  const referenceImages = source.referenceImages.map((filePath) => {
    const replacement = guideReplacements.get(path.basename(filePath))
    return replacement ? path.join(path.dirname(filePath), replacement) : filePath
  })
  if (!referenceImages.some((filePath) => filePath.includes('logo-safe-shape-guide.png'))) {
    throw new Error(`Missing logo-safe guide replacement for ${key}`)
  }
  await Promise.all(referenceImages.map((filePath) => access(filePath)))

  const isRetry = retryKeys.has(key)
  const promptText = `${logoSafePrefix(isRetry)}

${source.promptText}`
  const fileName = `${source.modelId}-${source.finish}-${candidateVersion}.png`
  const candidatePath = path.join(path.dirname(source.candidatePath), fileName)
  const localImagePath = path.join(path.dirname(source.localImagePath), fileName)
  await Promise.all([assertMissing(candidatePath), assertMissing(localImagePath)])

  let retryOf
  if (isRetry) {
    const rejectedBytes = await readFile(source.candidatePath)
    retryOf = {
      candidateVersion: source.candidateVersion,
      candidatePath: source.candidatePath,
      sha256: sha256(rejectedBytes),
      reason: 'Central Apple logo exposed through Gel despite the no-logo requirement',
    }
  }

  prompts.push({
    ...source,
    candidateVersion,
    promptText,
    promptSha256: sha256(promptText),
    referenceImages,
    candidatePath,
    localImagePath,
    imagePath: `${path.posix.dirname(source.imagePath)}/${fileName}`,
    reviewStatus: 'pending-generation',
    generationAttempt: isRetry ? 'logo-safe-retry' : 'logo-safe-first-attempt',
    ...(retryOf ? { retryOf } : {}),
  })
}

if (prompts.length !== 5) throw new Error(`Expected 5 logo-safe prompts, found ${prompts.length}`)
if (prompts.some((entry) => entry.publish || entry.setCurrent)) {
  throw new Error('Logo-safe candidates must remain unpublished')
}
if (prompts.some((entry) => entry.modelId === 'iphone-16-plus' && entry.finish === 'glitter')) {
  throw new Error('iPhone 16 Plus Glitter v2 is the benchmark and must not be regenerated')
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-16-logo-safe-shape-corrections',
  generatedBy: 'scripts/build-iphone-16-logo-safe-shape-corrections.mjs',
  sourceManifestPath,
  publish: false,
  candidateOnly: true,
  generationPolicy: 'Preserve the five iPhone 16/16 Plus shape-only targets while replacing translucent geometry guides with coordinate-identical opaque logo-safe guides. Never publish before user review.',
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

console.log(JSON.stringify({
  records: prompts.length,
  retries: prompts.filter((entry) => entry.generationAttempt === 'logo-safe-retry').length,
  firstAttempts: prompts.filter((entry) => entry.generationAttempt === 'logo-safe-first-attempt').length,
  referencesVerified: prompts.reduce((total, entry) => total + entry.referenceImages.length, 0),
  uniquePrompts: new Set(prompts.map((entry) => entry.promptSha256)).size,
  wrote: shouldWrite,
  outputPath,
}, null, 2))