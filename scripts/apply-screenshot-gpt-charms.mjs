#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1]
}

const APPLY = args.includes('--apply')
const VERIFY = args.includes('--verify')
if (APPLY === VERIFY) throw new Error('Specify exactly one of --verify or --apply')

const manifestPath = path.resolve(
  ROOT,
  valueAfter('--manifest', 'reference/charm-repairs/screenshot-gpt-manifest.json'),
)
const candidateReportPath = path.resolve(
  ROOT,
  valueAfter('--candidates', 'reference/charm-repairs/screenshot-gpt-candidate-report.json'),
)
const manualReviewPath = path.resolve(
  ROOT,
  valueAfter('--review', 'reference/charm-repairs/screenshot-gpt-manual-review.json'),
)
const normalizedDir = path.resolve(
  ROOT,
  valueAfter('--normalized', 'reference/charm-repairs/screenshot-gpt-generated/normalized'),
)
const publicDir = path.join(ROOT, 'public/assets/charms/ref')
const referenceDir = path.join(ROOT, 'reference/3-charms-each-piece')
const applyReportPath = path.resolve(
  ROOT,
  valueAfter('--report', 'reference/charm-repairs/screenshot-gpt-apply-report.json'),
)
const publicationManifestPath = path.resolve(
  ROOT,
  valueAfter('--publication', 'reference/charm-repairs/screenshot-gpt-publication-manifest.json'),
)

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const relative = (file) => path.relative(ROOT, file)

function uniqueIds(ids, label) {
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${label} contains duplicate ID ${id}`)
    seen.add(id)
  }
  return seen
}

function readMirrorSnapshot(catalogue) {
  const hashes = new Map()
  for (const charm of catalogue) {
    const publicPath = path.join(publicDir, `${charm.id}.png`)
    const referencePath = path.join(referenceDir, `${charm.id}.png`)
    if (!fs.existsSync(publicPath) || !fs.existsSync(referencePath)) {
      throw new Error(`${charm.id}: one or both canonical mirror PNGs are missing`)
    }
    const publicBytes = fs.readFileSync(publicPath)
    const referenceBytes = fs.readFileSync(referencePath)
    if (!publicBytes.equals(referenceBytes)) throw new Error(`${charm.id}: canonical mirrors differ before apply`)
    hashes.set(charm.id, sha256(publicBytes))
  }
  return hashes
}

async function validateInputs(manifest, candidateReport, manualReview, catalogueById) {
  if (manifest.status !== 'prepared_for_gpt') throw new Error(`Unexpected source manifest status ${manifest.status}`)
  if (candidateReport.mode !== 'apply') throw new Error('Candidate report must come from candidate preparation --apply')
  if (candidateReport.summary?.readyForManualReview !== manifest.targets.length) {
    throw new Error('Candidate report does not contain a structurally valid candidate for every target')
  }
  if (manualReview.status !== 'accepted') throw new Error('Manual review is not accepted')

  const targetIds = manifest.targets.map((target) => target.id)
  uniqueIds(targetIds, 'Source manifest')
  const candidatesById = new Map(candidateReport.results.map((result) => [result.id, result]))
  const reviewsById = new Map((manualReview.targets || []).map((review) => [review.id, review]))
  uniqueIds(candidateReport.results.map((result) => result.id), 'Candidate report')
  uniqueIds((manualReview.targets || []).map((review) => review.id), 'Manual review')
  const acceptedBuffers = new Map()
  const acceptedHashes = {}

  for (const target of manifest.targets) {
    const charm = catalogueById.get(target.id)
    const candidate = candidatesById.get(target.id)
    const review = reviewsById.get(target.id)
    if (!charm) throw new Error(`${target.id}: catalogue record is missing`)
    if (candidate?.status !== 'ready_for_manual_review' || candidate.errors?.length) {
      throw new Error(`${target.id}: candidate did not pass structural validation`)
    }
    if (review?.status !== 'accepted') throw new Error(`${target.id}: manual review is not accepted`)
    if (!review.normalizedSha256 || review.normalizedSha256 !== candidate.normalizedSha256) {
      throw new Error(`${target.id}: manual review SHA-256 does not match the candidate report`)
    }

    const file = path.join(normalizedDir, `${target.id}.png`)
    if (!fs.existsSync(file)) throw new Error(`${target.id}: normalized candidate is missing`)
    const bytes = fs.readFileSync(file)
    const hash = sha256(bytes)
    if (hash !== review.normalizedSha256) throw new Error(`${target.id}: normalized PNG changed after manual review`)
    const metadata = await sharp(bytes).metadata()
    if (metadata.format !== 'png' || !metadata.hasAlpha) throw new Error(`${target.id}: normalized candidate is not an alpha PNG`)
    if (metadata.width !== charm.pxW || metadata.height !== charm.pxH) {
      throw new Error(
        `${target.id}: normalized canvas ${metadata.width}x${metadata.height} differs from catalogue ` +
        `${charm.pxW}x${charm.pxH}`,
      )
    }
    acceptedBuffers.set(target.id, bytes)
    acceptedHashes[target.id] = hash
  }

  if (reviewsById.size !== targetIds.length || candidatesById.size !== targetIds.length) {
    throw new Error('Candidate report or manual review contains IDs outside the exact 11-target scope')
  }
  return { targetIds, acceptedBuffers, acceptedHashes }
}

function verifyPostApply(catalogue, beforeHashes, targetIds, acceptedHashes) {
  const targetSet = new Set(targetIds)
  const changedIds = []
  let mirrorPairs = 0

  for (const charm of catalogue) {
    const publicBytes = fs.readFileSync(path.join(publicDir, `${charm.id}.png`))
    const referenceBytes = fs.readFileSync(path.join(referenceDir, `${charm.id}.png`))
    if (!publicBytes.equals(referenceBytes)) throw new Error(`${charm.id}: canonical mirrors differ after apply`)
    mirrorPairs++
    const afterHash = sha256(publicBytes)
    if (afterHash !== beforeHashes.get(charm.id)) changedIds.push(charm.id)
    if (!targetSet.has(charm.id) && afterHash !== beforeHashes.get(charm.id)) {
      throw new Error(`${charm.id}: unrelated canonical artwork changed`)
    }
    if (targetSet.has(charm.id) && afterHash !== acceptedHashes[charm.id]) {
      throw new Error(`${charm.id}: canonical artwork does not match the accepted candidate`)
    }
  }

  return { mirrorPairs, changedIds }
}

async function main() {
  const manifest = readJson(manifestPath)
  const candidateReport = readJson(candidateReportPath)
  const manualReview = readJson(manualReviewPath)
  const catalogue = readJson(path.join(ROOT, 'src/data/catalog.json')).charms
  const catalogueById = new Map(catalogue.map((charm) => [charm.id, charm]))
  const beforeHashes = readMirrorSnapshot(catalogue)
  const { targetIds, acceptedBuffers, acceptedHashes } = await validateInputs(
    manifest,
    candidateReport,
    manualReview,
    catalogueById,
  )

  console.log(`${APPLY ? 'APPLY' : 'VERIFY'}: ${targetIds.length} exact manually accepted GPT charm PNGs`)
  if (!APPLY) {
    console.log(`Verified ${catalogue.length} mirror pairs and ${targetIds.length} hash-locked candidates; no files changed.`)
    return
  }

  for (const id of targetIds) {
    fs.writeFileSync(path.join(publicDir, `${id}.png`), acceptedBuffers.get(id))
    fs.writeFileSync(path.join(referenceDir, `${id}.png`), acceptedBuffers.get(id))
  }
  const postApply = verifyPostApply(catalogue, beforeHashes, targetIds, acceptedHashes)
  const previousAcceptance = readJson(path.join(ROOT, 'reference/charm-repairs/final-acceptance-report.json'))
  const liveSnapshotRecords = previousAcceptance.shopifyPublication?.liveSnapshotRecords
  if (!Number.isInteger(liveSnapshotRecords)) throw new Error('Prior live Shopify record count is unavailable')

  const generatedAt = new Date().toISOString()
  const publicationManifest = {
    generatedAt,
    status: 'accepted_for_shopify',
    sourceManifest: relative(manifestPath),
    candidateReport: relative(candidateReportPath),
    manualReview: relative(manualReviewPath),
    liveSnapshotRecords,
    artworkUpdateIds: targetIds,
    acceptedArtworkSha256: acceptedHashes,
    metadataUpdates: [],
    newRecordIds: [],
    publicationRule: 'Update artwork for exactly the 11 accepted screenshot targets; do not change records or metadata.',
  }
  const applyReport = {
    generatedAt,
    result: 'applied_to_canonical_mirrors',
    targetIds,
    acceptedArtworkSha256: acceptedHashes,
    verification: {
      catalogueRecords: catalogue.length,
      mirrorPairsChecked: postApply.mirrorPairs,
      changedIds: postApply.changedIds,
      unrelatedChanges: [],
    },
    shopifyPublicationManifest: relative(publicationManifestPath),
  }
  fs.mkdirSync(path.dirname(publicationManifestPath), { recursive: true })
  fs.mkdirSync(path.dirname(applyReportPath), { recursive: true })
  fs.writeFileSync(publicationManifestPath, `${JSON.stringify(publicationManifest, null, 2)}\n`)
  fs.writeFileSync(applyReportPath, `${JSON.stringify(applyReport, null, 2)}\n`)
  console.log(
    `Applied ${targetIds.length} candidates; verified ${postApply.mirrorPairs} mirror pairs and ` +
    `wrote ${relative(publicationManifestPath)}.`,
  )
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exit(1)
})