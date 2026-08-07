import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const provenancePath = path.join(
  repoRoot,
  'reference/case-history/generated/shopify-case-phone-body-regeneration/candidate-provenance.json',
)
const candidateRoot = path.join(
  repoRoot,
  'reference/case-history/generated/shopify-case-phone-body-regeneration/candidates',
)
const assetRoot = path.join(repoRoot, 'public/assets/cases/generated-phone-bodies')
const mapPath = path.join(repoRoot, 'src/data/generated-phone-body-images.json')
const runtimeExclusions = new Set(['iphone-xr:black', 'iphone-xr:white'])

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

async function copyExact(sourcePath, destinationPath, expectedSha256) {
  const bytes = await fs.readFile(sourcePath)
  const actualSha256 = sha256(bytes)
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA-256 mismatch for ${path.relative(repoRoot, sourcePath)}`)
  }
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Not a PNG: ${path.relative(repoRoot, sourcePath)}`)
  }

  try {
    const existing = await fs.readFile(destinationPath)
    if (sha256(existing) !== expectedSha256) {
      throw new Error(`Refusing to overwrite ${path.relative(repoRoot, destinationPath)}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fs.writeFile(destinationPath, bytes, { flag: 'wx' })
  }
}

async function main() {
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8'))
  const candidates = provenance.candidates.filter((candidate) => (
    candidate.candidatePath
    && !candidate.modelId.startsWith('pixel-')
    && !runtimeExclusions.has(`${candidate.modelId}:${candidate.finish}`)
  ))
  const seenTargets = new Set()
  const imageMap = {}

  await fs.mkdir(assetRoot, { recursive: true })

  for (const candidate of candidates) {
    if (!/^[a-z0-9-]+$/.test(candidate.modelId)) {
      throw new Error(`Invalid model ID: ${candidate.modelId}`)
    }
    if (!['black', 'white'].includes(candidate.finish)) {
      throw new Error(`Invalid finish for ${candidate.key}: ${candidate.finish}`)
    }
    if (!/^[a-f0-9]{64}$/.test(candidate.sha256)) {
      throw new Error(`Invalid SHA-256 for ${candidate.key}`)
    }

    const target = `${candidate.modelId}:${candidate.finish}`
    if (seenTargets.has(target)) throw new Error(`Duplicate generated target: ${target}`)
    seenTargets.add(target)

    const sourcePath = path.resolve(repoRoot, candidate.candidatePath)
    if (!sourcePath.startsWith(`${candidateRoot}${path.sep}`)) {
      throw new Error(`Candidate is outside the campaign directory: ${candidate.candidatePath}`)
    }

    const filename = `${candidate.modelId}-${candidate.finish}-${candidate.sha256.slice(0, 12)}.png`
    await copyExact(sourcePath, path.join(assetRoot, filename), candidate.sha256)

    imageMap[candidate.modelId] ||= {}
    imageMap[candidate.modelId][candidate.finish] = `/assets/cases/generated-phone-bodies/${filename}`
  }

  const orderedMap = Object.fromEntries(
    Object.entries(imageMap)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([modelId, finishes]) => [modelId, Object.fromEntries(Object.entries(finishes).sort())]),
  )
  await fs.writeFile(mapPath, `${JSON.stringify(orderedMap, null, 2)}\n`)

  console.log(JSON.stringify({ assets: candidates.length, models: Object.keys(orderedMap).length, mapPath }))
}

await main()