#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { shopifyAdmin, uploadImageFile } from '../functions/api/_lib.js'

const PROVENANCE_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidate-provenance.json'
const REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-upload-report.json'
const CASE_REVIEW_REPORT_PATH = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/shopify-case-review-source-upload-report.json'
const INVENTORY_PATH = 'public/assets/cases/case-inventory.json'
const METAOBJECT_TYPE = 'charme_product'
const FINISH_FIELDS = {
  black: 'body_image_black',
  white: 'body_image_white',
}
const SHOPIFY_PIXEL_TOLERANCE = {
  maximumChannelDelta: 1,
  maximumChangedPixelFraction: 0.00001,
}

const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const fillCaseReviewSources = process.argv.includes('--fill-case-review-sources')
const caseReviewBaseUrl = argumentValue('case-review-base-url', 'https://charme-customizer.pages.dev')
const modelIds = new Set(argumentValues('model'))
const finishes = new Set(argumentValues('finish').map((value) => value.toLowerCase()))
const env = {
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
}

if (apply && verify) throw new Error('Pass either --verify or --apply, not both')
if ([...finishes].some((finish) => !FINISH_FIELDS[finish])) {
  throw new Error('Only --finish black and --finish white are supported')
}

function argumentValues(name) {
  return process.argv.flatMap((argument, index) => (
    argument === `--${name}` && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ))
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function field(node, key) {
  return (node.fields || []).find((item) => item.key === key)
}

function referenceInfo(node, key) {
  const item = field(node, key)
  return {
    id: item?.reference?.id || item?.value || null,
    url: item?.reference?.image?.url || null,
  }
}

async function admin(query, variables) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await shopifyAdmin(env, query, variables)
    } catch (error) {
      lastError = error
      if (!/THROTTLED|429/i.test(error.message || String(error)) || attempt === 5) throw error
      await sleep(attempt * 1000)
    }
  }
  throw lastError
}

const Q_DEFINITION = `
  query {
    metaobjectDefinitionByType(type: "${METAOBJECT_TYPE}") {
      fieldDefinitions { key }
    }
  }`

const Q_PRODUCTS = `
  query($after: String) {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 200, after: $after) {
      edges {
        node {
          id
          handle
          fields {
            key
            value
            reference {
              ... on MediaImage { id fileStatus image { url } }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`

const Q_PRODUCT = `
  query($id: ID!) {
    node(id: $id) {
      ... on Metaobject {
        id
        handle
        fields {
          key
          value
          reference {
            ... on MediaImage { id fileStatus image { url } }
          }
        }
      }
    }
  }`

const Q_FILES = `
  query($search: String!) {
    files(first: 10, query: $search, sortKey: CREATED_AT, reverse: true) {
      nodes {
        ... on MediaImage {
          id
          fileStatus
          image { url width height }
        }
      }
    }
  }`

const M_PRODUCT = `
  mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject { id }
      userErrors { field message code }
    }
  }`

async function candidateEvidence(candidate) {
  const bytes = await readFile(candidate.candidatePath)
  const actualSha256 = sha256(bytes)
  if (actualSha256 !== candidate.sha256) {
    throw new Error(`${candidate.candidatePath} SHA-256 changed`)
  }
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png') throw new Error(`${candidate.candidatePath} is not a PNG`)
  if (metadata.width !== candidate.widthPx || metadata.height !== candidate.heightPx) {
    throw new Error(`${candidate.candidatePath} dimensions changed`)
  }
  return imageEvidence(bytes, candidate.candidatePath)
}

async function imageEvidence(bytes, label) {
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png') throw new Error(`${label} is not a PNG`)
  const pixels = await decodePixels(bytes)
  return {
    bytes,
    widthPx: metadata.width,
    heightPx: metadata.height,
    ...pixelIdentity(pixels),
    pixelData: pixels.data,
  }
}

async function decodePixels(bytes) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

function pixelIdentity({ data, info }) {
  return {
    pixelSha256: sha256(data),
    pixelWidth: info.width,
    pixelHeight: info.height,
    pixelChannels: info.channels,
  }
}

function pixelDifference(localData, remoteData) {
  if (localData.length !== remoteData.length) return null
  let changedPixels = 0
  let changedChannels = 0
  let alphaChanges = 0
  let maximumChannelDelta = 0
  let totalChannelDelta = 0
  for (let offset = 0; offset < localData.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(localData[offset + channel] - remoteData[offset + channel])
      if (!delta) continue
      pixelChanged = true
      changedChannels += 1
      totalChannelDelta += delta
      maximumChannelDelta = Math.max(maximumChannelDelta, delta)
      if (channel === 3) alphaChanges += 1
    }
    if (pixelChanged) changedPixels += 1
  }
  const totalPixels = localData.length / 4
  return {
    totalPixels,
    changedPixels,
    changedPixelFraction: changedPixels / totalPixels,
    changedChannels,
    alphaChanges,
    maximumChannelDelta,
    meanChangedChannelDelta: changedChannels ? totalChannelDelta / changedChannels : 0,
  }
}

async function acceptedCandidates() {
  const provenance = JSON.parse(await readFile(PROVENANCE_PATH, 'utf8'))
  const accepted = provenance.candidates.filter((candidate) => (
    candidate.reviewStatus === 'accepted'
    && (!modelIds.size || modelIds.has(candidate.modelId))
    && (!finishes.size || finishes.has(candidate.finish))
  ))
  if (!accepted.length) throw new Error('No accepted candidates match the requested filters')

  const keys = new Set()
  const entries = []
  for (const candidate of accepted) {
    const key = `${candidate.modelId}\u0000${candidate.finish}`
    if (keys.has(key)) throw new Error(`Multiple accepted candidates found for ${candidate.modelId}/${candidate.finish}`)
    keys.add(key)
    if (!FINISH_FIELDS[candidate.finish]) throw new Error(`Unsupported finish: ${candidate.finish}`)
    if (candidate.publish !== false) throw new Error(`${candidate.modelId}/${candidate.finish} must remain publish:false`)
    if (!candidate.automatedQa?.passed || candidate.automatedQa.bodyAspectDriftPercent > 1) {
      throw new Error(`${candidate.modelId}/${candidate.finish} does not pass the 1% body gate`)
    }
    if (candidate.visualCameraQa !== 'passed-by-review') {
      throw new Error(`${candidate.modelId}/${candidate.finish} has no passed camera review`)
    }
    entries.push({
      candidate,
      fieldKey: FINISH_FIELDS[candidate.finish],
      evidence: await candidateEvidence(candidate),
    })
  }
  return { campaign: provenance.campaign, entries }
}

async function optionalLocalSource(modelId, finish) {
  const paths = [
    `public/assets/cases/case-without-gel/${modelId}-${finish}.png`,
    `reference/case-history/generated/black-white-glitter-shape-trials/references/trial-${modelId}-${finish}-source.png`,
  ]
  for (const filePath of paths) {
    try {
      return { filePath, bytes: await readFile(filePath) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

async function caseReviewBytes(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'image/png', 'cache-control': 'no-cache' },
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok || !contentType.toLowerCase().startsWith('image/png')) {
        throw new Error(`${response.status} ${contentType || 'missing content type'}`)
      }
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 500)
    }
  }
  throw new Error(`Could not load case-review source ${url}: ${lastError?.message || lastError}`)
}

async function caseReviewSourceImages() {
  const [inventory, provenance] = await Promise.all([
    readFile(INVENTORY_PATH, 'utf8').then(JSON.parse),
    readFile(PROVENANCE_PATH, 'utf8').then(JSON.parse),
  ])
  const acceptedKeys = new Set(provenance.candidates
    .filter((candidate) => candidate.reviewStatus === 'accepted')
    .map((candidate) => `${candidate.modelId}\u0000${candidate.finish}`))
  const models = inventory.models.filter((model) => model.brand === 'Apple' && model.liveInCatalog)
  if (models.length !== 34) throw new Error(`Expected 34 live iPhone models in ${INVENTORY_PATH}, found ${models.length}`)

  const entries = []
  for (const model of models) {
    for (const finish of Object.keys(FINISH_FIELDS)) {
      if (acceptedKeys.has(`${model.id}\u0000${finish}`)) continue
      if (modelIds.size && !modelIds.has(model.id)) continue
      if (finishes.size && !finishes.has(finish)) continue
      if (!model.withoutGel?.[finish]) throw new Error(`${model.id}/${finish} is missing from the case-review Without gel inventory`)

      const sourceUrl = new URL(`/assets/cases/case-without-gel/${model.id}-${finish}.png`, caseReviewBaseUrl).toString()
      const bytes = await caseReviewBytes(sourceUrl)
      const sourceSha256 = sha256(bytes)
      const local = await optionalLocalSource(model.id, finish)
      if (local && sha256(local.bytes) !== sourceSha256) {
        throw new Error(`${model.id}/${finish} local source differs from the live case-review source`)
      }
      const evidence = await imageEvidence(bytes, sourceUrl)
      const candidate = {
        modelId: model.id,
        modelName: model.name,
        finish,
        candidateVersion: 'case-review-source',
        sha256: sourceSha256,
        widthPx: evidence.widthPx,
        heightPx: evidence.heightPx,
        sourceKind: 'case-review-without-gel',
        sourcePath: local?.filePath || null,
        sourceUrl,
      }
      entries.push({ candidate, fieldKey: FINISH_FIELDS[finish], evidence })
    }
  }
  if (!entries.length) throw new Error('No remaining case-review Without gel sources match the requested filters')
  return { campaign: 'case-review-without-gel-source-publication', entries }
}

function requireCredentials() {
  const hasClientCredentials = env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
  if (!env.SHOPIFY_STORE || (!hasClientCredentials && !env.SHOPIFY_ADMIN_TOKEN)) {
    throw new Error('Missing SHOPIFY_STORE and Shopify client credentials or SHOPIFY_ADMIN_TOKEN')
  }
}

async function productMetaobjects() {
  const results = new Map()
  let after = null
  do {
    const data = await admin(Q_PRODUCTS, { after })
    for (const { node } of data.metaobjects.edges) {
      const legacyId = field(node, 'legacy_id')?.value
      if (legacyId) results.set(legacyId, node)
    }
    after = data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null
  } while (after)
  return results
}

function matchesCandidate(identity, candidate, evidence) {
  return identity?.sha256 === candidate.sha256 || (
    identity?.pixelSha256 === evidence.pixelSha256
    && identity.pixelWidth === evidence.pixelWidth
    && identity.pixelHeight === evidence.pixelHeight
    && identity.pixelChannels === evidence.pixelChannels
  ) || (
    identity?.pixelWidth === evidence.pixelWidth
    && identity.pixelHeight === evidence.pixelHeight
    && identity.pixelChannels === evidence.pixelChannels
    && identity.pixelDifference?.alphaChanges === 0
    && identity.pixelDifference.maximumChannelDelta <= SHOPIFY_PIXEL_TOLERANCE.maximumChannelDelta
    && identity.pixelDifference.changedPixelFraction <= SHOPIFY_PIXEL_TOLERANCE.maximumChangedPixelFraction
  )
}

async function remoteIdentity(url, candidate, evidence, attempts = 1) {
  let lastResult = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { accept: 'image/png', 'cache-control': 'no-cache' },
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const pixels = await decodePixels(bytes)
      lastResult = {
        status: response.status,
        contentType: response.headers.get('content-type'),
        size: bytes.length,
        sha256: sha256(bytes),
        ...pixelIdentity(pixels),
        pixelDifference: pixelDifference(evidence.pixelData, pixels.data),
      }
      if (response.ok && matchesCandidate(lastResult, candidate, evidence)) return lastResult
    } catch (error) {
      lastResult = { error: error.message || String(error) }
    }
    if (attempt < attempts) await sleep(700)
  }
  return lastResult
}

async function existingUpload(filename, candidate, evidence) {
  const data = await admin(Q_FILES, { search: `filename:${filename}` })
  for (const file of data.files.nodes) {
    if (file.fileStatus !== 'READY' || !file.image?.url) continue
    const identity = await remoteIdentity(file.image.url, candidate, evidence)
    if (matchesCandidate(identity, candidate, evidence)) return { id: file.id, url: file.image.url, identity }
  }
  return null
}

async function upload(entry) {
  const { candidate, evidence, fieldKey, metaobject, current } = entry
  const currentIdentity = current.url ? await remoteIdentity(current.url, candidate, evidence) : null
  if (matchesCandidate(currentIdentity, candidate, evidence)) {
    return {
      status: 'already-current',
      modelId: candidate.modelId,
      finish: candidate.finish,
      candidateVersion: candidate.candidateVersion,
      sha256: candidate.sha256,
      pixelSha256: evidence.pixelSha256,
      fieldKey,
      metaobjectId: metaobject.id,
      fileId: current.id,
      url: current.url,
      sourceKind: candidate.sourceKind || 'accepted-generated-candidate',
      sourcePath: candidate.sourcePath || candidate.candidatePath,
      sourceUrl: candidate.sourceKind ? candidate.sourceUrl : null,
      cdn: currentIdentity,
    }
  }

  const filename = [
    candidate.modelId,
    candidate.finish,
    'without-gel',
    candidate.candidateVersion,
    candidate.sha256.slice(0, 12),
  ].join('-') + '.png'
  let file = await existingUpload(filename, candidate, evidence)
  const reusedUpload = Boolean(file)
  if (!file) {
    file = await uploadImageFile(env, evidence.bytes, {
      contentType: 'image/png',
      filename,
      alt: `${candidate.modelName} ${candidate.finish} without Gel`,
    })
  }
  if (!file.id || !file.url) throw new Error(`Shopify file was not ready for ${candidate.modelId}/${candidate.finish}`)
  const uploadedIdentity = file.identity || await remoteIdentity(file.url, candidate, evidence, 10)
  if (!matchesCandidate(uploadedIdentity, candidate, evidence)) {
    throw new Error(`Shopify CDN image does not match ${candidate.modelId}/${candidate.finish}`)
  }

  const updated = await admin(M_PRODUCT, {
    id: metaobject.id,
    metaobject: { fields: [{ key: fieldKey, value: file.id }] },
  })
  const errors = updated.metaobjectUpdate.userErrors || []
  if (errors.length) throw new Error(JSON.stringify(errors))

  const reread = (await admin(Q_PRODUCT, { id: metaobject.id })).node
  const finalReference = referenceInfo(reread, fieldKey)
  if (finalReference.id !== file.id || !finalReference.url) {
    throw new Error(`Shopify did not retain the new ${fieldKey} reference for ${candidate.modelId}`)
  }
  const finalIdentity = await remoteIdentity(finalReference.url, candidate, evidence, 5)
  if (!matchesCandidate(finalIdentity, candidate, evidence)) {
    throw new Error(`Final Shopify body image does not match ${candidate.modelId}/${candidate.finish}`)
  }

  return {
    status: 'updated',
    modelId: candidate.modelId,
    finish: candidate.finish,
    candidateVersion: candidate.candidateVersion,
    sha256: candidate.sha256,
    pixelSha256: evidence.pixelSha256,
    fieldKey,
    metaobjectId: metaobject.id,
    previousFileId: current.id,
    previousUrl: current.url,
    fileId: file.id,
    url: finalReference.url,
    sourceKind: candidate.sourceKind || 'accepted-generated-candidate',
    sourcePath: candidate.sourcePath || candidate.candidatePath,
    sourceUrl: candidate.sourceKind ? candidate.sourceUrl : null,
    reusedUpload,
    cdn: finalIdentity,
  }
}

async function main() {
  const { campaign, entries } = fillCaseReviewSources
    ? await caseReviewSourceImages()
    : await acceptedCandidates()
  const selectionLabel = fillCaseReviewSources
    ? 'remaining case-review Without gel product images'
    : 'accepted no-Gel product images'
  console.log(`${apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY RUN'}: ${entries.length} ${selectionLabel}`)
  for (const { candidate, fieldKey } of entries) {
    console.log(`- ${candidate.modelId} / ${candidate.finish} / ${candidate.candidateVersion} -> ${fieldKey} (${candidate.sha256})${candidate.sourceUrl ? ` <- ${candidate.sourceUrl}` : ''}`)
  }
  if (!apply && !verify) return

  requireCredentials()
  const definition = await admin(Q_DEFINITION)
  const definitionKeys = new Set((definition.metaobjectDefinitionByType?.fieldDefinitions || []).map((item) => item.key))
  for (const key of ['legacy_id', ...Object.values(FINISH_FIELDS)]) {
    if (!definitionKeys.has(key)) throw new Error(`${METAOBJECT_TYPE} definition is missing ${key}`)
  }

  const metaobjects = await productMetaobjects()
  const targets = entries.map((entry) => {
    const metaobject = metaobjects.get(entry.candidate.modelId)
    if (!metaobject) throw new Error(`Shopify has no ${METAOBJECT_TYPE} target for ${entry.candidate.modelId}`)
    return {
      ...entry,
      metaobject,
      current: referenceInfo(metaobject, entry.fieldKey),
    }
  })
  console.log(`Verified Shopify target coverage: ${targets.length}/${entries.length}`)
  if (verify) return

  const results = []
  for (const entry of targets) {
    const result = await upload(entry)
    results.push(result)
    console.log(`${result.status === 'updated' ? 'Updated' : 'Already current'}: ${result.modelId} / ${result.finish} -> ${result.fileId}`)
    await sleep(250)
  }

  const report = {
    schemaVersion: 1,
    campaign,
    appliedAt: new Date().toISOString(),
    provenancePath: PROVENANCE_PATH,
    sourceMode: fillCaseReviewSources ? 'case-review-without-gel' : 'accepted-generated-candidates',
    sourceBaseUrl: fillCaseReviewSources ? caseReviewBaseUrl : null,
    scope: fillCaseReviewSources
      ? 'Existing case-review Without gel sources for fields not covered by accepted generated candidates; Shopify Files plus charme_product body image fields; no variant media updates.'
      : 'Accepted no-Gel candidates only; Shopify Files plus charme_product body image fields; no variant media updates.',
    summary: {
      selected: results.length,
      updated: results.filter((result) => result.status === 'updated').length,
      alreadyCurrent: results.filter((result) => result.status === 'already-current').length,
      exactByteMatches: results.filter((result) => result.cdn?.sha256 === result.sha256).length,
      exactPixelMatches: results.filter((result) => result.cdn?.pixelSha256 === result.pixelSha256).length,
      boundedShopifyRoundingMatches: results.filter((result) => (
        result.cdn?.pixelSha256 !== result.pixelSha256
        && result.cdn?.pixelDifference?.alphaChanges === 0
        && result.cdn.pixelDifference.maximumChannelDelta <= SHOPIFY_PIXEL_TOLERANCE.maximumChannelDelta
        && result.cdn.pixelDifference.changedPixelFraction <= SHOPIFY_PIXEL_TOLERANCE.maximumChangedPixelFraction
      )).length,
    },
    results,
  }
  const reportPath = fillCaseReviewSources ? CASE_REVIEW_REPORT_PATH : REPORT_PATH
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Completed: ${report.summary.updated} updated, ${report.summary.alreadyCurrent} already current, ${report.summary.exactPixelMatches} exact pixel matches, ${report.summary.boundedShopifyRoundingMatches} bounded Shopify rounding matches.`)
  console.log(`Report: ${reportPath}`)
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exitCode = 1
})