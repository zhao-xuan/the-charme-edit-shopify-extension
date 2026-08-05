import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceManifestPath = 'reference/case-history/samsung-s24-s26-recolors.json'
const amendmentPath = 'reference/case-history/samsung-s24-s26-recolor-review-amendment.json'
const promotionPath = 'reference/case-history/samsung-s24-s26-recolor-promotion.json'
const imageMapPath = 'src/data/official-phone-case-images.json'
const imageBoundsPath = 'src/data/official-phone-case-image-bounds.json'
const assetDirectory = 'public/assets/cases/official-phone-case-images'
const candidateDirectory = path.resolve(
  repoRoot,
  'reference/case-history/generated/samsung-s24-s26-recolors/candidates',
)
const qaScriptPath = path.resolve(repoRoot, 'scripts/record-samsung-s24-s26-recolor-candidate.mjs')
const apply = process.argv.includes('--apply')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(repoRoot, relativePath), 'utf8'))
}

async function readOptionalJson(relativePath) {
  try {
    return await readJson(relativePath)
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function automatedQa(key) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [qaScriptPath, '--target', key, '--dry-run'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    })
    return JSON.parse(stdout).automatedQa
  } catch (error) {
    if (!error.stdout) throw error
    return JSON.parse(error.stdout).automatedQa
  }
}

async function copyExact(sourcePath, destinationPath, expectedSha256) {
  const bytes = await readFile(sourcePath)
  assert(sha256(bytes) === expectedSha256, `${sourcePath}: source SHA-256 changed`)
  try {
    const existing = await readFile(destinationPath)
    assert(sha256(existing) === expectedSha256, `${destinationPath}: refusing to overwrite different bytes`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(path.dirname(destinationPath), { recursive: true })
    await writeFile(destinationPath, bytes, { flag: 'wx' })
  }
}

function sortedNestedMap(imageMap) {
  return Object.fromEntries(Object.entries(imageMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelId, finishes]) => [modelId, Object.fromEntries(
      Object.entries(finishes).sort(([left], [right]) => left.localeCompare(right)),
    )]))
}

async function writeImmutableJson(relativePath, value) {
  const absolutePath = path.resolve(repoRoot, relativePath)
  const contents = `${JSON.stringify(value, null, 2)}\n`
  try {
    await access(absolutePath)
    assert(await readFile(absolutePath, 'utf8') === contents, `${relativePath}: immutable record changed`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, contents, { flag: 'wx' })
  }
}

const [sourceManifest, amendment, existingImageMap, existingImageBounds] = await Promise.all([
  readJson(sourceManifestPath),
  readJson(amendmentPath),
  readJson(imageMapPath),
  readOptionalJson(imageBoundsPath),
])

assert(sourceManifest.campaign === 'samsung-s24-s26-recolors-v1', 'Unexpected source campaign')
assert(sourceManifest.publish === false, 'Historical source manifest must remain unpublished')
assert(amendment.sourceManifest === sourceManifestPath, 'Amendment source manifest changed')
assert(amendment.publish === true, 'Review amendment is not approved for publication')
assert(amendment.qaCorrection?.visibleAlphaThreshold === 8, 'Visible-alpha threshold changed')
assert(amendment.qaCorrection?.maximumHaloPixels === 100, 'Maximum halo threshold changed')
assert(amendment.qaCorrection?.maximumAspectDriftPercent === 3, 'Aspect threshold changed')
assert(amendment.reviews?.length === 12, 'Review amendment must cover all 12 targets')

const targets = new Map(sourceManifest.targets.map((target) => [target.key, target]))
const reviews = new Map(amendment.reviews.map((review) => [review.key, review]))
assert(targets.size === 12 && reviews.size === 12, 'Samsung review target count changed')
assert([...targets.keys()].every((key) => reviews.has(key)), 'Review amendment target set changed')

const acceptedReviews = amendment.reviews.filter((review) => review.reviewStatus === 'accepted' && review.publish)
const rejectedReviews = amendment.reviews.filter((review) => review.reviewStatus === 'rejected' && !review.publish)
assert(acceptedReviews.length === 11, 'Exactly 11 Samsung candidates must be accepted')
assert(rejectedReviews.length === 1 && rejectedReviews[0].key === 'galaxy-s26-ultra:black', 'Unexpected rejected target')

const imageMap = structuredClone(existingImageMap)
const imageBounds = structuredClone(existingImageBounds)
const assets = []

for (const review of amendment.reviews) {
  const target = targets.get(review.key)
  assert(target?.outcome?.sha256 === review.sha256, `${review.key}: source review identity changed`)
  const qa = await automatedQa(review.key)
  if (review.reviewStatus === 'accepted') {
    assert(qa.passed, `${review.key}: corrected automated QA failed: ${qa.failures.join(', ')}`)
  } else {
    assert(!qa.passed, `${review.key}: rejected target unexpectedly passed automated QA`)
    continue
  }

  const sourcePath = path.resolve(repoRoot, target.candidatePath)
  assert(sourcePath.startsWith(`${candidateDirectory}${path.sep}`), `${review.key}: candidate path escaped campaign`)
  const bytes = await readFile(sourcePath)
  assert(sha256(bytes) === review.sha256, `${review.key}: candidate bytes changed`)
  assert(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${review.key}: candidate is not a PNG`)

  const filename = `${target.modelId}-${target.finish}-${review.sha256.slice(0, 12)}.png`
  const destinationPath = path.join(assetDirectory, filename)
  const publicPath = `/${destinationPath.replace(/^public\//, '')}`
  const currentPath = imageMap[target.modelId]?.[target.finish]
  assert(!currentPath || currentPath === publicPath, `${review.key}: refusing to replace an unrelated reviewed image`)

  const bounds = qa.candidate.visibleBoundsPx
  assert(bounds?.width > 0 && bounds?.height > 0, `${review.key}: visible bounds missing`)
  imageMap[target.modelId] ||= {}
  imageMap[target.modelId][target.finish] = publicPath
  imageBounds[target.modelId] ||= {}
  imageBounds[target.modelId][target.finish] = {
    sourceWidth: qa.candidate.widthPx,
    sourceHeight: qa.candidate.heightPx,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  }
  assets.push({
    key: review.key,
    sourceCandidatePath: target.candidatePath,
    destinationPath,
    publicPath,
    sha256: review.sha256,
    widthPx: qa.candidate.widthPx,
    heightPx: qa.candidate.heightPx,
    visibleBoundsPx: bounds,
    transform: 'None; exact original PNG bytes. Alpha bounds are applied only as a non-destructive browser display crop.',
  })
}

const promotion = {
  schemaVersion: 1,
  campaign: 'samsung-s24-s26-recolor-promotion-v1',
  generatedBy: 'scripts/promote-samsung-s24-s26-recolors.mjs',
  approvedReview: amendmentPath,
  publishedAt: amendment.approvedAt,
  publish: true,
  policy: 'Publish exactly 11 user-approved GPT PNGs byte-for-byte. Keep Galaxy S26 Ultra Black unpublished.',
  assets,
}

if (apply) {
  for (const asset of assets) {
    await copyExact(
      path.resolve(repoRoot, asset.sourceCandidatePath),
      path.resolve(repoRoot, asset.destinationPath),
      asset.sha256,
    )
  }
  await writeFile(path.resolve(repoRoot, imageMapPath), `${JSON.stringify(sortedNestedMap(imageMap), null, 2)}\n`)
  await writeFile(path.resolve(repoRoot, imageBoundsPath), `${JSON.stringify(sortedNestedMap(imageBounds), null, 2)}\n`)
  await writeImmutableJson(promotionPath, promotion)
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  accepted: assets.length,
  rejected: rejectedReviews.map((review) => review.key),
  assets: assets.map(({ key, publicPath, sha256, visibleBoundsPx }) => ({ key, publicPath, sha256, visibleBoundsPx })),
}, null, 2))