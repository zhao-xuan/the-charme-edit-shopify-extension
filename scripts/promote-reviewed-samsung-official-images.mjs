#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const CANONICAL_MANIFEST = 'reference/case-history/generated/official-phone-case-crawl/samsung-candidates.json'
const CANONICAL_ORIGINALS = 'reference/case-history/generated/official-phone-case-crawl/originals'
const EDITOR_ASSETS = 'public/assets/cases/official-phone-case-images'
const OVERRIDES_PATH = 'src/data/official-phone-case-images.json'
const EXPECTED_CANDIDATE_COUNT = 53
const EXPECTED_MODEL_COUNT = 35
const EXPECTED_REVIEWED_SET_DIGEST = 'e2a9032d752a31116940123dffc61f16366fb65197b193f72e0f437460d9ee5f'

const PROTECTED_OVERRIDES = new Map([
  ['galaxy-s22:black', '/assets/cases/case-without-gel/galaxy-s22-black.png'],
  ['galaxy-s22-plus:black', '/assets/cases/case-without-gel/galaxy-s22-plus-black.png'],
  ['galaxy-s22-plus:white', '/assets/cases/case-without-gel/galaxy-s22-plus-white.png'],
  ['galaxy-s24:white', '/assets/cases/case-without-gel/galaxy-s24-white.png'],
  ['galaxy-s24-plus:white', '/assets/cases/case-without-gel/galaxy-s24-plus-white.png'],
])

const PRESERVED_REJECTIONS = new Map([
  ['EF-ES948CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES948CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES947CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES947CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES942CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES942CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['GP-FPS928SBJBW', 'Third-party Shieldon carbon-fibre case is visibly branded and textured'],
  ['GP-FPS921SBJBW', 'Third-party Shieldon carbon-fibre case is visibly branded and textured'],
  ['EF-PS918TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS918LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-PS916TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS916LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-PS911TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS911LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-PG780TVEGEU', 'Front-screen render; rear case and camera hardware are not visible'],
  ['GP-FPA516KDATW', 'Wrong A51 network model and front-screen render'],
  ['EF-QA326TBEGEU', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-QA125TTEGEU', 'Front-screen render; rear case and camera hardware are not visible'],
])

const inputManifestPath = argumentValue('manifest', CANONICAL_MANIFEST)
const apply = process.argv.includes('--apply')

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
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

function candidateIdentity(candidate) {
  return [candidate.modelId, candidate.targetFinish, candidate.sourceSku, candidate.sourceUrl, candidate.sha256]
}

function reviewedSetDigest(candidates) {
  const rows = candidates
    .map(candidateIdentity)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return sha256(JSON.stringify(rows))
}

function rejectionHistory(previousManifest) {
  const attempts = (previousManifest.candidates || []).flatMap((candidate) =>
    (candidate.attempts || []).map((attempt) => ({
      modelId: candidate.modelId,
      sourceSku: attempt.sku,
      sourcePageUrl: attempt.pageUrl,
    })),
  )
  const sources = [
    ...(previousManifest.rejectedSources || []),
    ...(previousManifest.candidates || []),
    ...attempts,
  ]
  const sourceBySku = new Map()
  for (const source of sources) {
    if (source.sourceSku && !sourceBySku.has(source.sourceSku)) {
      sourceBySku.set(source.sourceSku, source)
    }
  }
  return [...PRESERVED_REJECTIONS.entries()].map(([sourceSku, reason]) => {
    const source = sourceBySku.get(sourceSku) || { sourceSku }
    return {
      ...source,
      status: 'rejected',
      publish: false,
      reviewStatus: 'rejected',
      rejectionReason: reason,
    }
  }).sort((left, right) => left.sourceSku.localeCompare(right.sourceSku))
}

async function editorAsset(candidate, bytes) {
  const bounds = candidate.visibleBounds
  assert(bounds && Number.isInteger(bounds.left) && Number.isInteger(bounds.top), `${candidate.modelId}: invalid visible bounds`)
  assert(Number.isInteger(bounds.width) && Number.isInteger(bounds.height), `${candidate.modelId}: invalid crop size`)
  assert(bounds.width >= 400 && bounds.height >= 800, `${candidate.modelId}: crop is below the reviewed resolution floor`)

  const editorBytes = await sharp(bytes)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  const [sourcePixels, editorPixels] = await Promise.all([
    sharp(bytes)
      .ensureAlpha()
      .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
      .raw()
      .toBuffer(),
    sharp(editorBytes).ensureAlpha().raw().toBuffer(),
  ])
  assert(sha256(sourcePixels) === sha256(editorPixels), `${candidate.modelId}: editor crop changed source pixels`)

  const filename = `${candidate.modelId}-${candidate.targetFinish}-${candidate.sha256.slice(0, 12)}.png`
  return {
    bytes: editorBytes,
    filePath: path.join(EDITOR_ASSETS, filename),
    publicPath: `/assets/cases/official-phone-case-images/${filename}`,
    sha256: sha256(editorBytes),
    pixelSha256: sha256(editorPixels),
    widthPx: bounds.width,
    heightPx: bounds.height,
  }
}

async function writeExact(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true })
  try {
    const existing = await readFile(filePath)
    assert(sha256(existing) === sha256(bytes), `${filePath}: existing file has different bytes`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(filePath, bytes, { flag: 'wx' })
  }
}

function sortedOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([modelId, finishes]) => [modelId, Object.fromEntries(
      Object.entries(finishes).sort(([left], [right]) => left.localeCompare(right)),
    )]))
}

async function main() {
  const [inputManifest, previousManifest, existingOverrides] = await Promise.all([
    readJson(inputManifestPath),
    readJson(CANONICAL_MANIFEST),
    readJson(OVERRIDES_PATH),
  ])
  const candidates = inputManifest.candidates.filter((candidate) => candidate.status === 'candidate-found')
  assert(candidates.length === EXPECTED_CANDIDATE_COUNT, `Expected ${EXPECTED_CANDIDATE_COUNT} candidates, found ${candidates.length}`)
  assert(new Set(candidates.map((candidate) => candidate.modelId)).size === EXPECTED_MODEL_COUNT, `Expected ${EXPECTED_MODEL_COUNT} covered models`)
  assert(reviewedSetDigest(candidates) === EXPECTED_REVIEWED_SET_DIGEST, 'Reviewed Samsung candidate set digest changed')

  for (const [key, expectedPath] of PROTECTED_OVERRIDES) {
    const [modelId, finish] = key.split(':')
    assert(existingOverrides[modelId]?.[finish] === expectedPath, `Protected override changed: ${key}`)
  }

  const seenFinishes = new Set()
  const overrides = structuredClone(existingOverrides)
  const reviewedCandidates = []
  const assets = []
  for (const candidate of candidates) {
    const key = `${candidate.modelId}:${candidate.targetFinish}`
    assert(!seenFinishes.has(key), `Duplicate candidate finish ${key}`)
    seenFinishes.add(key)
    assert(candidate.targetFinish === 'black' || candidate.targetFinish === 'white', `${key}: unsupported target finish`)
    assert(candidate.sourcePageUrl.startsWith('https://www.samsung.com/'), `${key}: non-Samsung source page`)
    assert(candidate.sourceUrl.startsWith('https://images.samsung.com/is/image/samsung/'), `${key}: non-Samsung image source`)

    const sourceBytes = await readFile(candidate.sourcePath)
    assert(sha256(sourceBytes) === candidate.sha256, `${key}: source SHA-256 changed`)
    const canonicalSourcePath = path.join(CANONICAL_ORIGINALS, path.basename(candidate.sourcePath))
    const protectedPath = PROTECTED_OVERRIDES.get(key)
    let publication
    if (protectedPath) {
      publication = {
        status: 'accepted-existing-override-preserved',
        editorPath: protectedPath,
        transform: 'No derived asset; the existing reviewed override remains authoritative',
      }
    } else {
      const asset = await editorAsset(candidate, sourceBytes)
      assets.push(asset)
      overrides[candidate.modelId] ||= {}
      const currentPath = overrides[candidate.modelId][candidate.targetFinish]
      assert(!currentPath || currentPath === asset.publicPath, `${key}: refusing to overwrite an unrelated reviewed override`)
      overrides[candidate.modelId][candidate.targetFinish] = asset.publicPath
      publication = {
        status: 'published-editor-asset',
        editorPath: asset.publicPath,
        sha256: asset.sha256,
        pixelSha256: asset.pixelSha256,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        transform: 'Transparent canvas cropped to the recorded alpha bounds; no resize, recolour, composite, or pixel change',
      }
    }
    reviewedCandidates.push({
      ...candidate,
      sourcePath: canonicalSourcePath,
      publish: !protectedPath,
      reviewStatus: 'accepted',
      reviewedBy: 'direct-visual-review',
      reviewNotes: 'Exact-model complete rear-view phone-in-case image; straight-on, unobstructed, and camera hardware visible.',
      publication,
    })
    if (apply) await writeExact(canonicalSourcePath, sourceBytes)
  }

  const missingCandidates = inputManifest.candidates.filter((candidate) => candidate.status !== 'candidate-found')
  const rejectedSources = rejectionHistory(previousManifest)
  const reviewedAt = previousManifest.reviewedSetDigest === EXPECTED_REVIEWED_SET_DIGEST
    ? previousManifest.reviewedAt
    : new Date().toISOString()
  const canonicalManifest = {
    ...inputManifest,
    reviewedAt,
    reviewedSetDigest: EXPECTED_REVIEWED_SET_DIGEST,
    reviewPolicy: 'Direct visual approval is required in addition to source, model, resolution, aspect, alpha-hole, and obstruction gates.',
    summary: {
      targets: inputManifest.summary.targets,
      candidates: reviewedCandidates.length,
      modelsWithCandidates: EXPECTED_MODEL_COUNT,
      missingModels: inputManifest.summary.missingModels,
      approved: reviewedCandidates.length,
      publishedEditorAssets: assets.length,
      preservedExistingOverrides: PROTECTED_OVERRIDES.size,
      rejectedPreservedSources: rejectedSources.length,
    },
    candidates: [...reviewedCandidates, ...missingCandidates],
    rejectedSources,
  }

  if (apply) {
    for (const asset of assets) await writeExact(asset.filePath, asset.bytes)
    await writeFile(OVERRIDES_PATH, `${JSON.stringify(sortedOverrides(overrides), null, 2)}\n`)
    await writeFile(CANONICAL_MANIFEST, `${JSON.stringify(canonicalManifest, null, 2)}\n`)
  }
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    reviewedSetDigest: EXPECTED_REVIEWED_SET_DIGEST,
    approved: reviewedCandidates.length,
    publishedEditorAssets: assets.length,
    preservedExistingOverrides: PROTECTED_OVERRIDES.size,
    missingModels: inputManifest.summary.missingModels,
    rejectedPreservedSources: rejectedSources.length,
  }, null, 2))
}

await main()