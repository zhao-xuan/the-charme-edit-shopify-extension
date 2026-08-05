#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/tauri-a15-amazon-video-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/tauri-a15-amazon-video-case-asset-provenance.json'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127 Safari/537.36'

function argumentValue(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function normalizeHtml(value) {
  return value
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'user-agent': USER_AGENT,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  assert(response.status === 200, `HTTP ${response.status}: ${url}`)
  return {
    buffer,
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
  }
}

async function verifyAmazonProduct(manifest) {
  const { product } = manifest
  const response = await fetchBytes(product.productPageUrl, 'text/html')
  assert(response.contentType.includes('text/html'), 'Amazon product response was not HTML')
  const html = response.buffer.toString('utf8')
  const text = normalizeHtml(html)
  assert(text.includes(product.asin), `Amazon ASIN is absent: ${product.asin}`)
  assert(text.includes(product.title), 'Amazon product title changed')
  assert(text.includes(product.brand), 'Amazon product brand changed')
  assert(text.includes(product.compatiblePhoneModels), 'Amazon compatible phone model changed')
  assert(text.includes(product.compatibleDevices), 'Amazon compatible device changed')
  assert(text.includes(product.material), 'Amazon material changed')
  assert(!/enter the characters you see below/i.test(text), 'Amazon returned a challenge page')
  return {
    ...product,
    finalUrl: response.finalUrl,
    httpStatus: 200,
    productIdentityVerified: true,
  }
}

async function verifyAmazonVideo(manifest) {
  const { product, video } = manifest
  const response = await fetchBytes(video.pageUrl, 'text/html')
  assert(response.contentType.includes('text/html'), 'Amazon video response was not HTML')
  const html = response.buffer.toString('utf8')
  const text = normalizeHtml(html)
  for (const expected of [
    product.asin,
    video.title,
    video.creator,
    video.uploadDate,
    video.duration,
    video.hlsUrl,
  ]) assert(text.includes(expected), `Amazon video evidence changed: ${expected}`)
  assert(!/enter the characters you see below/i.test(text), 'Amazon video returned a challenge page')
  return {
    pageUrl: video.pageUrl,
    finalUrl: response.finalUrl,
    title: video.title,
    creator: video.creator,
    uploadDate: video.uploadDate,
    duration: video.duration,
    orientation: video.orientation,
    hlsUrl: video.hlsUrl,
    associatedAsin: product.asin,
    httpStatus: 200,
    structuredMetadataVerified: true,
  }
}

async function verifyOfficialCompatibility(manifest) {
  const compatibility = manifest.officialCompatibility
  const response = await fetchBytes(compatibility.sourcePageUrl, 'text/html')
  assert(response.contentType.includes('text/html'), 'Samsung accessory response was not HTML')
  const text = normalizeHtml(response.buffer.toString('utf8'))
  for (const expected of [
    compatibility.accessoryCode,
    compatibility.sourcePageTitle,
    compatibility.reportedLabel,
    compatibility.reportedValue,
  ]) assert(text.includes(expected), `Samsung compatibility evidence changed: ${expected}`)
  return {
    ...compatibility,
    finalUrl: response.finalUrl,
    httpStatus: 200,
    compatibilityVerified: true,
  }
}

async function verifyOfficialDimension(dimension) {
  assert(dimension.apiQuery.modelCode === dimension.modelCode, `${dimension.network}: API model code mismatch`)
  const apiUrl = new URL(dimension.apiEndpoint)
  for (const [key, value] of Object.entries(dimension.apiQuery)) apiUrl.searchParams.set(key, value)
  const [pageResponse, apiResponse] = await Promise.all([
    fetchBytes(dimension.sourcePageUrl, 'text/html'),
    fetchBytes(apiUrl, 'application/json'),
  ])
  assert(pageResponse.contentType.includes('text/html'), `${dimension.network}: Samsung device response was not HTML`)
  const pageText = normalizeHtml(pageResponse.buffer.toString('utf8'))
  for (const expected of [dimension.modelName, dimension.modelCode, dimension.modelFamilyCode]) {
    assert(pageText.includes(expected), `${dimension.network}: Samsung device identity changed: ${expected}`)
  }
  assert(apiResponse.contentType.includes('json'), `${dimension.network}: Samsung model API was not JSON`)
  const payload = JSON.parse(apiResponse.buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, `${dimension.network}: Samsung model API status changed`)
  assert(payload.response?.siteCode === dimension.apiQuery.siteCode, `${dimension.network}: Samsung site code changed`)
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const items = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const matches = items.filter((item) => (
    item.SpecItemNameLevel2 === dimension.reportedLabel
    && item.SpecItemkeyLevel2 === dimension.specItemKey
    && item.SpecItemIdLevel2 === dimension.specItemId
  ))
  assert(matches.length === 1, `${dimension.network}: expected one exact dimension item, found ${matches.length}`)
  assert(matches[0].SpecItemValue === dimension.reportedValue, `${dimension.network}: Samsung dimensions changed`)
  return {
    ...dimension,
    sourcePageFinalUrl: pageResponse.finalUrl,
    sourcePageHttpStatus: 200,
    apiUrl: String(apiUrl),
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    reportedValueFound: true,
  }
}

async function runFfmpeg(argumentsList) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', argumentsList, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`ffmpeg stopped by ${signal}`))
      else if (code) reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))
      else resolve()
    })
  })
}

async function verifyHlsAndExtractFrame(manifest) {
  const { video } = manifest
  const [masterFirst, masterSecond, variantFirst, variantSecond] = await Promise.all([
    fetchBytes(video.hlsUrl, 'application/vnd.apple.mpegurl'),
    fetchBytes(video.hlsUrl, 'application/vnd.apple.mpegurl'),
    fetchBytes(video.variantUrl, 'application/vnd.apple.mpegurl'),
    fetchBytes(video.variantUrl, 'application/vnd.apple.mpegurl'),
  ])
  assert(masterFirst.buffer.equals(masterSecond.buffer), 'Amazon HLS master changed between repeated fetches')
  assert(variantFirst.buffer.equals(variantSecond.buffer), 'Amazon HLS 1080p playlist changed between repeated fetches')
  assert(sha256(masterFirst.buffer) === video.expectedHlsSha256, 'Amazon HLS master hash changed')
  assert(sha256(variantFirst.buffer) === video.expectedVariantSha256, 'Amazon HLS 1080p playlist hash changed')
  const masterText = masterFirst.buffer.toString('utf8')
  assert(masterText.includes('RESOLUTION=1920x1080'), 'Amazon HLS lost the 1080p variant')
  assert(masterText.includes(path.basename(new URL(video.variantUrl).pathname)), 'Amazon HLS 1080p URL changed')

  const segmentResults = await Promise.all(video.segments.map(async (segment) => {
    const [first, second] = await Promise.all([
      fetchBytes(segment.url, 'video/mp2t'),
      fetchBytes(segment.url, 'video/mp2t'),
    ])
    assert(first.buffer.equals(second.buffer), `Amazon video segment changed between fetches: ${segment.url}`)
    assert(first.buffer.length === segment.expectedBytes, `Amazon video segment size changed: ${segment.url}`)
    assert(sha256(first.buffer) === segment.expectedSha256, `Amazon video segment hash changed: ${segment.url}`)
    assert(variantFirst.buffer.includes(path.basename(new URL(segment.url).pathname)), `Amazon playlist lost segment: ${segment.url}`)
    return { ...segment, buffer: first.buffer, repeatedFetchByteIdentical: true }
  }))

  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'tauri-a15-hls-'))
  try {
    const playlistPath = path.join(temporaryDir, 'playlist.m3u8')
    const framePath = path.join(temporaryDir, 'frame.png')
    const openingFramePath = path.join(temporaryDir, 'opening-frame.png')
    await Promise.all([
      writeFile(playlistPath, variantFirst.buffer),
      ...segmentResults.map((segment) => writeFile(
        path.join(temporaryDir, path.basename(new URL(segment.url).pathname)),
        segment.buffer,
      )),
    ])
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(video.frameTimestampSeconds),
      '-i', playlistPath,
      '-frames:v', '1',
      framePath,
    ])
    const extracted = await readFile(framePath)
    const decoded = await sharp(extracted).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    assert(decoded.info.width === video.expectedFrameWidth, 'Extracted frame width changed')
    assert(decoded.info.height === video.expectedFrameHeight, 'Extracted frame height changed')
    assert(decoded.info.channels === 3, 'Extracted frame channel count changed')
    assert(sha256(decoded.data) === video.expectedFramePixelSha256, 'Extracted frame pixel hash changed')
    const canonicalFrame = await sharp(decoded.data, { raw: decoded.info }).png().toBuffer()
    assert(sha256(canonicalFrame) === video.expectedFrameEncodedSha256, 'Canonical frame hash changed')
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(video.openingFrame.timestampSeconds),
      '-i', playlistPath,
      '-frames:v', '1',
      openingFramePath,
    ])
    const extractedOpeningFrame = await readFile(openingFramePath)
    const decodedOpeningFrame = await sharp(extractedOpeningFrame).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    assert(decodedOpeningFrame.info.width === video.openingFrame.expectedWidth, 'Extracted opening frame width changed')
    assert(decodedOpeningFrame.info.height === video.openingFrame.expectedHeight, 'Extracted opening frame height changed')
    assert(decodedOpeningFrame.info.channels === 3, 'Extracted opening frame channel count changed')
    assert(sha256(decodedOpeningFrame.data) === video.openingFrame.expectedPixelSha256, 'Extracted opening frame pixel hash changed')
    const canonicalOpeningFrame = await sharp(decodedOpeningFrame.data, { raw: decodedOpeningFrame.info }).png().toBuffer()
    assert(sha256(canonicalOpeningFrame) === video.openingFrame.expectedEncodedSha256, 'Canonical opening frame hash changed')
    return {
      canonicalFrame,
      canonicalOpeningFrame,
      master: {
        url: video.hlsUrl,
        encodedSha256: sha256(masterFirst.buffer),
        bytes: masterFirst.buffer.length,
        repeatedFetchByteIdentical: true,
      },
      variant: {
        url: video.variantUrl,
        encodedSha256: sha256(variantFirst.buffer),
        bytes: variantFirst.buffer.length,
        repeatedFetchByteIdentical: true,
      },
      segments: segmentResults.map(({ buffer, ...segment }) => segment),
      frame: {
        timestampSeconds: video.frameTimestampSeconds,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        encodedSha256: sha256(canonicalFrame),
        pixelSha256: sha256(decoded.data),
      },
      openingFrame: {
        timestampSeconds: video.openingFrame.timestampSeconds,
        width: decodedOpeningFrame.info.width,
        height: decodedOpeningFrame.info.height,
        channels: decodedOpeningFrame.info.channels,
        encodedSha256: sha256(canonicalOpeningFrame),
        pixelSha256: sha256(decodedOpeningFrame.data),
      },
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }
}

async function writeVerifiedAsset(filePath, bytes) {
  try {
    const existing = await readFile(filePath)
    assert(existing.equals(bytes), `Existing source differs from verified frame: ${filePath}`)
    return 'already-current'
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(filePath, bytes)
    return 'written'
  }
}

async function main() {
  const inputPath = argumentValue('--input', DEFAULT_INPUT)
  const outputDir = argumentValue('--output-dir', DEFAULT_OUTPUT_DIR)
  const reportPath = argumentValue('--report', DEFAULT_REPORT)
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(manifest.schemaVersion === 1, 'Unsupported A15 source manifest schema')
  assert(manifest.targetModelId === 'galaxy-a15-4g-5g', 'Unexpected A15 target model')
  assert(manifest.sourceModelId === 'galaxy-a15-5g', 'Unexpected A15 source model')
  assert(manifest.officialDimensions?.length === 2, 'Expected LTE and 5G Samsung dimensions')

  const [productRecord, videoRecord, compatibilityEvidence, dimensionEvidence, hlsEvidence] = await Promise.all([
    verifyAmazonProduct(manifest),
    verifyAmazonVideo(manifest),
    verifyOfficialCompatibility(manifest),
    Promise.all(manifest.officialDimensions.map(verifyOfficialDimension)),
    verifyHlsAndExtractFrame(manifest),
  ])
  assert(new Set(dimensionEvidence.map((item) => item.reportedValue)).size === 1, 'LTE and 5G dimensions differ')
  assert(new Set(dimensionEvidence.map((item) => item.specItemKey)).size === 1, 'LTE and 5G dimension keys differ')
  assert(new Set(dimensionEvidence.map((item) => item.specItemId)).size === 1, 'LTE and 5G dimension IDs differ')

  await mkdir(outputDir, { recursive: true })
  const sourcePath = path.join(outputDir, 'galaxy-a15-5g-verified-amazon-B0CRDYG64S-real-video-frame-17.8s.png')
  const openingFramePath = path.join(outputDir, 'galaxy-a15-5g-verified-amazon-B0CRDYG64S-real-video-opening-frame-6.5s.png')
  const writeStatus = await writeVerifiedAsset(sourcePath, hlsEvidence.canonicalFrame)
  const openingFrameWriteStatus = await writeVerifiedAsset(openingFramePath, hlsEvidence.canonicalOpeningFrame)
  const asset = {
    targetModelId: manifest.targetModelId,
    targetModelName: 'Galaxy A15 4G / 5G',
    sourceModelId: manifest.sourceModelId,
    sourceKind: 'verified-amazon-real-product-video-frame',
    derivedSourceKind: 'derived-verified-retail-source',
    publicationEligible: true,
    eligibilityReason: 'Amazon ASIN B0CRDYG64S identifies the real TAURI Galaxy A15 5G case video, while Samsung accessory EF-QA156CTEGWW explicitly confirms Galaxy A15 5G/LTE shared-case compatibility and both official device records report identical dimensions.',
    geometryReview: manifest.video.frameSelectionReview,
    geometrySource: 'Verified Amazon exact-ASIN real unboxing video: the 17.8-second flat unobstructed frame supplies the complete physical silhouette and the 6.5-second frame supplies only the four complete brightly backed physical openings',
    productRecordUrl: manifest.product.productPageUrl,
    sourceUrl: manifest.video.pageUrl,
    path: sourcePath,
    encodedSha256: hlsEvidence.frame.encodedSha256,
    decodedPixelSha256: hlsEvidence.frame.pixelSha256,
    width: hlsEvidence.frame.width,
    height: hlsEvidence.frame.height,
    channels: hlsEvidence.frame.channels,
    format: 'png',
    writeStatus,
    openingFrame: {
      path: openingFramePath,
      encodedSha256: hlsEvidence.openingFrame.encodedSha256,
      decodedPixelSha256: hlsEvidence.openingFrame.pixelSha256,
      width: hlsEvidence.openingFrame.width,
      height: hlsEvidence.openingFrame.height,
      channels: hlsEvidence.openingFrame.channels,
      format: 'png',
      writeStatus: openingFrameWriteStatus,
      geometryReview: manifest.video.openingFrame.selectionReview,
      geometryUse: 'four physical opening masks only; no outer silhouette pixels are used',
    },
    productRecord,
    videoRecord,
    hlsEvidence: {
      master: hlsEvidence.master,
      variant: hlsEvidence.variant,
      segments: hlsEvidence.segments,
      frame: hlsEvidence.frame,
      openingFrame: hlsEvidence.openingFrame,
    },
    officialCompatibilityEvidence: compatibilityEvidence,
    officialDimensionEvidence: dimensionEvidence,
    segmentation: manifest.segmentation,
    openingFrameSegmentation: manifest.openingFrameSegmentation,
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Verified Amazon exact-ASIN real A15 5G unboxing video with separately locked silhouette and opening frames plus first-party Samsung LTE/5G shared-case and dimension evidence',
    summary: {
      assets: 1,
      productRecordsVerified: 1,
      videoRecordsVerified: 1,
      hlsManifestsRepeatedFetchByteIdentical: 2,
      hlsSegmentsRepeatedFetchByteIdentical: hlsEvidence.segments.length,
      realFramesPixelVerified: 2,
      officialCompatibilityVerified: 1,
      officialDimensionsVerified: dimensionEvidence.length,
      written: [writeStatus, openingFrameWriteStatus].filter((status) => status === 'written').length,
      alreadyCurrent: [writeStatus, openingFrameWriteStatus].filter((status) => status === 'already-current').length,
    },
    assets: [asset],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
}

await main()