#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/supcase-a23-amazon-video-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/supcase-a23-amazon-video-case-asset-provenance.json'
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

function decodeHtmlSerialization(value) {
  return String(value || '')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#034;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function normalizeHtml(value) {
  return decodeHtmlSerialization(value)
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
    signal: AbortSignal.timeout(60_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  assert(response.status === 200, `HTTP ${response.status}: ${url}`)
  return {
    buffer,
    contentType: response.headers.get('content-type') || '',
    finalUrl: response.url,
  }
}

async function fetchAmazonHtml(url) {
  const marker = '__CHARME_CURL_RESPONSE__'
  const { stdout } = await runProcess('curl', [
    '--compressed',
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--user-agent', USER_AGENT,
    '--header', 'Accept-Language: en-US,en;q=0.9',
    '--write-out', `\n${marker}%{http_code}\t%{url_effective}\t%{content_type}`,
    url,
  ])
  const markerIndex = stdout.lastIndexOf(`\n${marker}`)
  assert(markerIndex >= 0, 'curl omitted Amazon response metadata')
  const buffer = Buffer.from(stdout.slice(0, markerIndex), 'utf8')
  const [status, finalUrl, contentType] = stdout.slice(markerIndex + marker.length + 1).split('\t')
  assert(status === '200', `Amazon curl returned HTTP ${status}: ${url}`)
  return { buffer, finalUrl, contentType }
}

function assertAmazonProductPage(response, manifest, fetchNumber) {
  const { product, video } = manifest
  assert(response.contentType.includes('text/html'), `Amazon product fetch ${fetchNumber} was not HTML`)
  const text = normalizeHtml(response.buffer.toString('utf8'))
  assert(!/enter the characters you see below/i.test(text), `Amazon product fetch ${fetchNumber} returned a challenge page`)
  for (const expected of [product.asin, product.title, product.brand, product.compatibilityStatement]) {
    assert(text.includes(expected), `Amazon product fetch ${fetchNumber} evidence changed: ${expected}`)
  }
  const exactFields = {
    title: video.title,
    marketPlaceID: video.marketplaceId,
    aciContentId: video.aciContentId,
    mediaObjectId: video.mediaObjectId,
    mediaAsin: video.mediaAsin,
    parentAsin: video.parentAsin,
    durationSeconds: video.amazonDurationSeconds,
    durationTimestamp: video.durationTimestamp,
    videoWidth: String(video.expectedWidth),
    videoHeight: String(video.expectedHeight),
    url: video.hlsUrl,
  }
  for (const [key, value] of Object.entries(exactFields)) {
    const field = `"${key}":${typeof value === 'number' ? value : `"${value}"`}`
    assert(text.includes(field), `Amazon product fetch ${fetchNumber} video field changed: ${field}`)
  }
  assert(video.mediaAsin === product.asin && video.parentAsin === product.asin, 'Manifest ASIN association is inconsistent')
  assert(video.hlsUrl.includes(`/${video.transcodingArtifactId}/`), 'Manifest HLS artifact identity is inconsistent')
  return {
    finalUrl: response.finalUrl,
    httpStatus: 200,
    encodedSha256: sha256(response.buffer),
    bytes: response.buffer.length,
  }
}

function assertAmazonVideoPage(response, manifest, fetchNumber) {
  const { product, video } = manifest
  assert(response.contentType.includes('text/html'), `Amazon video fetch ${fetchNumber} was not HTML`)
  const html = response.buffer.toString('utf8')
  const text = normalizeHtml(html)
  const serializedHtml = decodeHtmlSerialization(html)
  assert(!/enter the characters you see below/i.test(text), `Amazon video fetch ${fetchNumber} returned a challenge page`)
  const records = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]))
    .flatMap((record) => asArray(record))
  const matches = records.filter((record) => record['@type'] === 'VideoObject' && record.contentUrl === video.hlsUrl)
  assert(matches.length === 1, `Expected one Amazon VideoObject on fetch ${fetchNumber}, found ${matches.length}`)
  const record = matches[0]
  assert(record['@context'] === 'http://schema.org', `Amazon video fetch ${fetchNumber} schema context changed`)
  assert(record.name === video.structuredName, `Amazon video fetch ${fetchNumber} structured name changed`)
  assert(record.uploadDate === video.uploadDate, `Amazon video fetch ${fetchNumber} upload date changed`)
  assert(record.description === video.description, `Amazon video fetch ${fetchNumber} description changed`)
  assert(record.duration === video.duration, `Amazon video fetch ${fetchNumber} duration changed`)
  assert(record.author?.['@type'] === video.creatorType, `Amazon video fetch ${fetchNumber} creator type changed`)
  assert(record.author?.name === video.creator, `Amazon video fetch ${fetchNumber} creator changed`)
  const activeDataFields = {
    broadcastId: video.mediaObjectId,
    source: 'VSE',
    asin: product.asin,
    contentSeedId: video.mediaObjectId,
  }
  for (const [key, value] of Object.entries(activeDataFields)) {
    const field = `"${key}":"${value}"`
    assert(serializedHtml.includes(field), `Amazon video fetch ${fetchNumber} activeData changed: ${field}`)
  }
  assert(response.finalUrl === video.pageUrl, `Amazon video fetch ${fetchNumber} redirected unexpectedly`)
  return {
    finalUrl: response.finalUrl,
    httpStatus: 200,
    encodedSha256: sha256(response.buffer),
    bytes: response.buffer.length,
    structuredVideo: record,
    activeDataVerified: true,
  }
}

async function verifyAmazonProductAndVideo(manifest) {
  const productFirst = await fetchAmazonHtml(manifest.product.productPageUrl)
  const productSecond = await fetchAmazonHtml(manifest.product.productPageUrl)
  const videoFirst = await fetchAmazonHtml(manifest.video.pageUrl)
  const videoSecond = await fetchAmazonHtml(manifest.video.pageUrl)
  return {
    product: manifest.product,
    videoIdentity: {
      pageUrl: manifest.video.pageUrl,
      title: manifest.video.title,
      creator: manifest.video.creator,
      creatorType: manifest.video.creatorType,
      uploadDate: manifest.video.uploadDate,
      marketplaceId: manifest.video.marketplaceId,
      aciContentId: manifest.video.aciContentId,
      mediaObjectId: manifest.video.mediaObjectId,
      mediaAsin: manifest.video.mediaAsin,
      parentAsin: manifest.video.parentAsin,
      hlsUrl: manifest.video.hlsUrl,
    },
    productPageFetchesVerified: [
      assertAmazonProductPage(productFirst, manifest, 1),
      assertAmazonProductPage(productSecond, manifest, 2),
    ],
    videoPageFetchesVerified: [
      assertAmazonVideoPage(videoFirst, manifest, 1),
      assertAmazonVideoPage(videoSecond, manifest, 2),
    ],
  }
}

async function runProcess(command, argumentsList) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} stopped by ${signal}`))
      else if (code) reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`))
      else resolve({ stdout, stderr })
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
  assert(masterText.includes(`RESOLUTION=${video.expectedWidth}x${video.expectedHeight}`), 'Amazon HLS lost the vertical 1080p variant')
  assert(masterText.includes(path.basename(new URL(video.variantUrl).pathname)), 'Amazon HLS 1080p URL changed')
  const expectedSegmentNames = video.segments.map((segment) => path.basename(new URL(segment.url).pathname))
  const actualSegmentNames = variantFirst.buffer.toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  assert(JSON.stringify(actualSegmentNames) === JSON.stringify(expectedSegmentNames), 'Amazon HLS segment list changed')

  const segmentResults = await Promise.all(video.segments.map(async (segment) => {
    const [first, second] = await Promise.all([
      fetchBytes(segment.url, 'video/mp2t'),
      fetchBytes(segment.url, 'video/mp2t'),
    ])
    assert(first.buffer.equals(second.buffer), `Amazon segment changed between repeated fetches: ${segment.url}`)
    assert(first.buffer.length === segment.expectedBytes, `Amazon segment size changed: ${segment.url}`)
    assert(sha256(first.buffer) === segment.expectedSha256, `Amazon segment hash changed: ${segment.url}`)
    return { ...segment, buffer: first.buffer, repeatedFetchByteIdentical: true }
  }))

  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'supcase-a23-hls-'))
  try {
    const playlistPath = path.join(temporaryDir, 'playlist.m3u8')
    const framePath = path.join(temporaryDir, 'frame.png')
    await Promise.all([
      writeFile(playlistPath, variantFirst.buffer),
      ...segmentResults.map((segment) => writeFile(
        path.join(temporaryDir, path.basename(new URL(segment.url).pathname)),
        segment.buffer,
      )),
    ])
    const probe = JSON.parse((await runProcess('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      playlistPath,
    ])).stdout)
    const stream = probe.streams?.[0]
    assert(stream?.width === video.expectedWidth, 'Amazon video width changed')
    assert(stream?.height === video.expectedHeight, 'Amazon video height changed')
    assert(stream?.avg_frame_rate === video.expectedFrameRate, 'Amazon video frame rate changed')
    assert(stream?.r_frame_rate === video.expectedFrameRate, 'Amazon video nominal frame rate changed')
    assert(Number(probe.format?.duration) === video.expectedPlaylistDurationSeconds, 'Amazon HLS playlist duration changed')
    await runProcess('ffmpeg', [
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
    assert(decoded.info.width === video.expectedFrameWidth, 'Extracted A23 frame width changed')
    assert(decoded.info.height === video.expectedFrameHeight, 'Extracted A23 frame height changed')
    assert(decoded.info.channels === video.expectedFrameChannels, 'Extracted A23 frame channel count changed')
    assert(sha256(decoded.data) === video.expectedFramePixelSha256, 'Extracted A23 frame pixel hash changed')
    const canonicalFrame = await sharp(decoded.data, { raw: decoded.info }).png().toBuffer()
    assert(canonicalFrame.length === video.expectedFrameEncodedBytes, 'Canonical A23 frame byte size changed')
    assert(sha256(canonicalFrame) === video.expectedFrameEncodedSha256, 'Canonical A23 frame hash changed')
    return {
      canonicalFrame,
      master: {
        url: video.hlsUrl,
        bytes: masterFirst.buffer.length,
        encodedSha256: sha256(masterFirst.buffer),
        repeatedFetchByteIdentical: true,
      },
      variant: {
        url: video.variantUrl,
        bytes: variantFirst.buffer.length,
        encodedSha256: sha256(variantFirst.buffer),
        repeatedFetchByteIdentical: true,
      },
      segments: segmentResults.map(({ buffer, ...segment }) => segment),
      stream: {
        width: stream.width,
        height: stream.height,
        averageFrameRate: stream.avg_frame_rate,
        nominalFrameRate: stream.r_frame_rate,
        playlistDurationSeconds: Number(probe.format.duration),
      },
      frame: {
        timestampSeconds: video.frameTimestampSeconds,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        encodedBytes: canonicalFrame.length,
        encodedSha256: sha256(canonicalFrame),
        decodedPixelSha256: sha256(decoded.data),
      },
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }
}

async function verifyOfficialModel(model) {
  assert(model.apiQuery.modelCode === model.productCode, `Samsung ${model.network} API model code mismatch`)
  const apiUrl = new URL(model.apiEndpoint)
  for (const [key, value] of Object.entries(model.apiQuery)) apiUrl.searchParams.set(key, value)
  const [pageResponse, apiResponse] = await Promise.all([
    fetchBytes(model.sourcePageUrl, 'text/html'),
    fetchBytes(apiUrl, 'application/json'),
  ])
  assert(pageResponse.contentType.includes('text/html'), `Samsung ${model.network} support response was not HTML`)
  const pageText = normalizeHtml(pageResponse.buffer.toString('utf8'))
  assert(pageText.includes(model.modelName), `Samsung ${model.network} name changed`)
  assert(pageText.includes(model.supportModel), `Samsung ${model.network} support model changed`)
  assert(pageText.toLowerCase().includes(model.productCode.toLowerCase()), `Samsung ${model.network} product code changed`)
  assert(apiResponse.contentType.includes('json'), `Samsung ${model.network} model API response was not JSON`)
  const payload = JSON.parse(apiResponse.buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, `Samsung ${model.network} model API status changed`)
  assert(payload.response?.siteCode === model.apiQuery.siteCode, `Samsung ${model.network} model API site changed`)
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const items = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const dimensions = items.filter((item) => (
    item.SpecItemNameLevel2 === model.reportedLabel
    && item.SpecItemkeyLevel2 === model.specItemKey
    && item.SpecItemIdLevel2 === model.specItemId
  ))
  assert(dimensions.length === 1, `Expected one Samsung ${model.network} dimension item, found ${dimensions.length}`)
  assert(normalizeHtml(dimensions[0].SpecItemValue) === model.reportedValue, `Samsung ${model.network} dimensions changed`)
  const infra = items.filter((item) => item.SpecItemNameLevel2 === 'Infra')
  assert(infra.length === 1, `Expected one Samsung ${model.network} Infra item, found ${infra.length}`)
  assert(normalizeHtml(infra[0].SpecItemValue) === model.expectedInfra, `Samsung ${model.network} network identity changed`)
  if (model.expectedInfraExcludes) {
    assert(!infra[0].SpecItemValue.includes(model.expectedInfraExcludes), `Samsung ${model.network} unexpectedly includes ${model.expectedInfraExcludes}`)
  }
  return {
    ...model,
    sourcePageFinalUrl: pageResponse.finalUrl,
    sourcePageHttpStatus: 200,
    sourcePageEncodedSha256: sha256(pageResponse.buffer),
    apiUrl: String(apiUrl),
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    dimensionVerified: true,
    networkIdentityVerified: true,
  }
}

async function writeVerifiedAsset(filePath, bytes) {
  try {
    const existing = await readFile(filePath)
    assert(existing.equals(bytes), `Existing A23 source differs from verified frame: ${filePath}`)
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
  assert(manifest.schemaVersion === 1, 'Unsupported A23 source manifest schema')
  assert(manifest.targetModelId === 'galaxy-a23-4g-5g', 'Unexpected A23 target model')
  assert(manifest.targetModelName === 'Galaxy A23 4G / 5G', 'Unexpected A23 target name')
  assert(manifest.sourceModelId === manifest.targetModelId, 'Unexpected A23 source model')
  assert(manifest.officialModels?.length === 2, 'Expected Samsung A23 4G and 5G records')
  assert(manifest.publicationPolicy?.sourceVerificationPublishesNothing === true, 'A23 source verifier must publish nothing')
  assert(manifest.publicationPolicy?.productMediaAllowed === false, 'A23 Product Media must remain forbidden')
  assert(manifest.publicationPolicy?.variantMediaAssociationsAllowed === false, 'A23 variant media associations must remain forbidden')

  const [amazonEvidence, hlsEvidence, officialModels] = await Promise.all([
    verifyAmazonProductAndVideo(manifest),
    verifyHlsAndExtractFrame(manifest),
    Promise.all(manifest.officialModels.map(verifyOfficialModel)),
  ])
  assert(new Set(officialModels.map((model) => model.network)).size === 2, 'Samsung A23 network identities are not distinct')
  assert(new Set(officialModels.map((model) => model.reportedValue)).size === 1, 'Samsung A23 4G and 5G dimensions differ')
  assert(officialModels.find((model) => model.network === '4G LTE')?.expectedInfraExcludes === '5G', 'Samsung A23 4G exclusion is missing')
  assert(officialModels.find((model) => model.network === '5G')?.expectedInfra.includes('5G Sub6'), 'Samsung A23 5G identity is missing')

  await mkdir(outputDir, { recursive: true })
  const sourcePath = path.join(outputDir, 'galaxy-a23-4g-5g-verified-amazon-B0BMFRJYLG-real-video-frame-52s.png')
  const writeStatus = await writeVerifiedAsset(sourcePath, hlsEvidence.canonicalFrame)
  const asset = {
    targetModelId: manifest.targetModelId,
    targetModelName: manifest.targetModelName,
    sourceModelId: manifest.sourceModelId,
    sourceKind: 'verified-amazon-exact-asin-real-product-video-frame',
    derivedSourceKind: 'not-yet-derived',
    derivationEligible: true,
    publicationEligible: false,
    publicationBlock: 'Source bytes are qualified, but projective rectification, independent geometry review, and storage-only publication audit have not yet passed.',
    compatibilityReason: manifest.compatibilityPolicy.controllingEvidence,
    geometrySource: 'The complete real SUPCASE rear shell separately visible at 52 seconds; the front frame and belt holster are excluded.',
    geometryReview: manifest.video.frameSelectionReview,
    sourceUrl: manifest.product.productPageUrl,
    path: sourcePath,
    encodedSha256: hlsEvidence.frame.encodedSha256,
    decodedPixelSha256: hlsEvidence.frame.decodedPixelSha256,
    width: hlsEvidence.frame.width,
    height: hlsEvidence.frame.height,
    channels: hlsEvidence.frame.channels,
    format: 'png',
    writeStatus,
    amazonEvidence,
    hlsEvidence: {
      master: hlsEvidence.master,
      variant: hlsEvidence.variant,
      segments: hlsEvidence.segments,
      stream: hlsEvidence.stream,
      frame: hlsEvidence.frame,
    },
    officialModelEvidence: officialModels,
    segmentation: manifest.segmentation,
    compatibilityPolicy: manifest.compatibilityPolicy,
    publicationPolicy: manifest.publicationPolicy,
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath,
    source: 'Hash-locked exact-ASIN SUPCASE real product video plus separate official Samsung A23 4G and 5G identity records',
    summary: {
      assets: 1,
      amazonProductHtmlFetchesVerified: amazonEvidence.productPageFetchesVerified.length,
      amazonVideoHtmlFetchesVerified: amazonEvidence.videoPageFetchesVerified.length,
      hlsManifestsRepeatedFetchByteIdentical: 2,
      hlsSegmentsRepeatedFetchByteIdentical: hlsEvidence.segments.length,
      realFramesPixelVerified: 1,
      officialModelsVerified: officialModels.length,
      sourceQualified: 1,
      publicationEligible: 0,
      shopifyWrites: 0,
      productMediaWrites: 0,
      variantMediaAssociations: 0,
      written: writeStatus === 'written' ? 1 : 0,
      alreadyCurrent: writeStatus === 'already-current' ? 1 : 0,
    },
    assets: [asset],
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ reportPath, sourcePath, summary: report.summary }, null, 2))
}

await main()