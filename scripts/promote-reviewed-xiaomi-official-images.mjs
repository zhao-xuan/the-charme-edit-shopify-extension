#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MANIFEST_PATH = 'reference/case-history/generated/official-phone-case-crawl/xiaomi-candidates.json'
const ORIGINALS_DIR = 'reference/case-history/generated/official-phone-case-crawl/originals'
const EDITOR_ASSETS_DIR = 'public/assets/cases/official-phone-case-images'
const OVERRIDES_PATH = 'src/data/official-phone-case-images.json'
const EXPECTED_SOURCE_SHA256 = 'da976308e59e9feb4c815325a6e4fd3cbbe854853574e5f083643207fa31807b'

const ACCEPTED_SOURCE = {
  modelId: 'xiaomi-14',
  targetFinish: 'white',
  sourceColour: 'other',
  sourcePageUrl: 'https://www.mi.com/shop/buy/detail?product_id=19344',
  sourceProductId: 19344,
  sourceGoodsId: 2230000633,
  sourceProductName: 'Xiaomi 14 菱格素皮保护壳 雪粉色',
  sourceUrl: 'https://cdn.cnbj0.fds.api.mi-img.com/b2c-shopapi-pms/pms_1698304637.59922032.png',
  sourceMirrorUrl: 'https://cdn.cnbj1.fds.api.mi-img.com/nr-pub/202310251041_23b2dd5dc540378743ef9273d265d47b.png',
}

const REJECTED_MODELS = [
  {
    modelId: 'xiaomi-13',
    sourcePageUrl: 'https://www.mi.com/shop/buy/detail?product_id=10050023',
    sourceProductName: 'Xiaomi 13/Xiaomi 13 Pro 硅胶保护壳',
    rejectionReason: 'The official product gallery contains straight rear renders of empty cases with blank camera openings; no complete phone-in-case image is available.',
  },
  {
    modelId: 'xiaomi-13-pro',
    sourcePageUrl: 'https://www.mi.com/shop/buy/detail?product_id=10050023',
    sourceProductName: 'Xiaomi 13/Xiaomi 13 Pro 硅胶保护壳',
    rejectionReason: 'The official product gallery contains straight rear renders of empty cases with blank camera openings; no complete phone-in-case image is available.',
  },
  {
    modelId: 'xiaomi-14-pro',
    sourcePageUrl: 'https://www.mi.com/shop/buy/detail?product_id=19346',
    sourceProductName: 'Xiaomi 14 Pro-AlwaySmart 多彩透亮保护壳',
    rejectionReason: 'All three official-store gallery renders show empty cases with blank camera openings; no complete phone-in-case image is available.',
  },
]

const apply = process.argv.includes('--apply')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fetchSource() {
  const errors = []
  for (const url of [ACCEPTED_SOURCE.sourceUrl, ACCEPTED_SOURCE.sourceMirrorUrl]) {
    try {
      const response = await fetch(url, {
        headers: {
          referer: ACCEPTED_SOURCE.sourcePageUrl,
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
        },
      })
      if (response.ok) return { bytes: Buffer.from(await response.arrayBuffer()), fetchedUrl: url }
      errors.push(`${url}: HTTP ${response.status}`)
    } catch (error) {
      errors.push(`${url}: ${error.cause?.code || error.message}`)
    }
  }
  throw new Error(`Official Xiaomi image requests failed: ${errors.join('; ')}`)
}

async function alphaBounds(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  let visiblePixels = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue
      visiblePixels += 1
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  assert(right >= left && bottom >= top, 'Official Xiaomi image has no visible pixels')
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    visiblePixels,
    canvasWidth: info.width,
    canvasHeight: info.height,
  }
}

async function editorAsset(sourceBytes, sourceSha256, bounds) {
  const bytes = await sharp(sourceBytes)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  const [sourcePixels, editorPixels] = await Promise.all([
    sharp(sourceBytes)
      .ensureAlpha()
      .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
      .raw()
      .toBuffer(),
    sharp(bytes).ensureAlpha().raw().toBuffer(),
  ])
  assert(sha256(sourcePixels) === sha256(editorPixels), 'Editor crop changed source pixels')
  const filename = `${ACCEPTED_SOURCE.modelId}-${ACCEPTED_SOURCE.targetFinish}-${sourceSha256.slice(0, 12)}.png`
  return {
    bytes,
    filePath: path.join(EDITOR_ASSETS_DIR, filename),
    publicPath: `/assets/cases/official-phone-case-images/${filename}`,
    sha256: sha256(bytes),
    pixelSha256: sha256(editorPixels),
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
  const { bytes: sourceBytes, fetchedUrl } = await fetchSource()
  const sourceSha256 = sha256(sourceBytes)
  const metadata = await sharp(sourceBytes).metadata()
  const bounds = await alphaBounds(sourceBytes)
  assert(metadata.format === 'png', `Expected PNG source, found ${metadata.format}`)
  assert(metadata.width === 800 && metadata.height === 800, `Unexpected source dimensions ${metadata.width}x${metadata.height}`)
  assert(bounds.width >= 300 && bounds.height >= 600, 'Reviewed phone crop is below the resolution floor')
  if (EXPECTED_SOURCE_SHA256) {
    assert(sourceSha256 === EXPECTED_SOURCE_SHA256, 'Official Xiaomi source SHA-256 changed')
  }

  const asset = await editorAsset(sourceBytes, sourceSha256, bounds)
  const sourceFilename = `${ACCEPTED_SOURCE.modelId}-${ACCEPTED_SOURCE.sourceColour}-${sourceSha256.slice(0, 12)}.png`
  const sourcePath = path.join(ORIGINALS_DIR, sourceFilename)
  const candidate = {
    ...ACCEPTED_SOURCE,
    status: 'candidate-found',
    publish: true,
    reviewStatus: 'accepted',
    reviewRequirements: [
      'exact-model',
      'complete-phone-in-case',
      'rear-view',
      'straight-on',
      'camera-hardware-visible',
    ],
    finishFallback: true,
    sourcePath,
    sha256: sourceSha256,
    format: metadata.format,
    widthPx: metadata.width,
    heightPx: metadata.height,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    visibleBounds: bounds,
    reviewedBy: 'direct-visual-review',
    reviewNotes: 'Exact-model complete straight-on rear phone-in-case render; the camera hardware is visible. Pink is used as the permitted non-black/non-white fallback for the White editor finish.',
    publication: {
      status: 'published-editor-asset',
      editorPath: asset.publicPath,
      sha256: asset.sha256,
      pixelSha256: asset.pixelSha256,
      widthPx: bounds.width,
      heightPx: bounds.height,
      transform: 'Transparent canvas cropped to the recorded alpha bounds; no resize, recolour, composite, or pixel change',
    },
  }
  const rejectedCandidates = REJECTED_MODELS.map((record) => ({
    ...record,
    status: 'rejected',
    publish: false,
    reviewStatus: 'official-gallery-ineligible',
  }))
  const manifest = {
    schemaVersion: 1,
    campaign: 'official-phone-case-crawl',
    brand: 'xiaomi',
    reviewedAt: '2026-08-03',
    sourcePolicy: 'Xiaomi-owned store pages and Xiaomi-owned image CDN only. Publication requires an exact-model, complete, straight-on rear phone-in-case image with visible camera hardware.',
    summary: {
      targets: 4,
      approved: 1,
      publishedEditorAssets: 1,
      rejectedOfficialGallery: 3,
    },
    candidates: [candidate, ...rejectedCandidates],
    rejectedSources: [
      {
        modelId: 'xiaomi-14',
        status: 'rejected',
        publish: false,
        reviewStatus: 'official-gallery-ineligible',
        sourcePageUrl: 'https://www.mi.com/shop/buy/detail?product_id=19343',
        sourceProductName: 'Xiaomi 14 透明保护壳',
        sourceImageUrl: 'https://cdn.cnbj0.fds.api.mi-img.com/b2c-shopapi-pms/pms_1698304670.02843942.png',
        rejectionReason: 'The official render contains a complete phone in the case but is an angled three-quarter view rather than a straight-on rear view.',
      },
    ],
  }

  if (apply) {
    assert(EXPECTED_SOURCE_SHA256, 'Refusing to apply without a locked source SHA-256')
    const overrides = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'))
    overrides[ACCEPTED_SOURCE.modelId] ||= {}
    const currentPath = overrides[ACCEPTED_SOURCE.modelId][ACCEPTED_SOURCE.targetFinish]
    assert(!currentPath || currentPath === asset.publicPath, 'Refusing to overwrite an unrelated Xiaomi 14 override')
    overrides[ACCEPTED_SOURCE.modelId][ACCEPTED_SOURCE.targetFinish] = asset.publicPath
    await writeExact(sourcePath, sourceBytes)
    await writeExact(asset.filePath, asset.bytes)
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(OVERRIDES_PATH, `${JSON.stringify(sortedOverrides(overrides), null, 2)}\n`)
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    sourceSha256,
    fetchedUrl,
    sourceDimensions: `${metadata.width}x${metadata.height}`,
    visibleBounds: bounds,
    editorPath: asset.publicPath,
    editorSha256: asset.sha256,
    approved: 1,
    rejectedModels: 3,
  }, null, 2))
}

await main()