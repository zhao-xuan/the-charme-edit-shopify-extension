#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_INPUT = 'reference/case-history/generated/all-phone-real-image-completion/nillkin-a22-youtube-video-case-sources.json'
const DEFAULT_OUTPUT_DIR = 'reference/case-history/generated/all-phone-real-image-completion/references'
const DEFAULT_REPORT = 'reference/case-history/generated/all-phone-real-image-completion/nillkin-a22-youtube-video-case-asset-provenance.json'

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

function normalizeText(value) {
  return String(value || '')
    .replace(/&lrm;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchBytes(url, accept) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/127 Safari/537.36',
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

async function run(command, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (signal) reject(new Error(`${command} stopped by ${signal}`))
      else if (code) reject(new Error(`${command} exited with ${code}: ${errorText}`))
      else resolve({ stdout: Buffer.concat(stdout), stderr: errorText })
    })
  })
}

async function resolveYtDlp(explicitPath) {
  const candidates = [explicitPath, process.env.YT_DLP_PATH, path.join(os.tmpdir(), 'yt-dlp-latest'), 'yt-dlp']
    .filter(Boolean)
  for (const candidate of candidates) {
    if (candidate === 'yt-dlp') return candidate
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  return 'yt-dlp'
}

async function verifyOnlineVideo(manifest, ytDlpPath) {
  const { video } = manifest
  const [oembedResponse, metadataResult, versionResult] = await Promise.all([
    fetchBytes(video.oembedUrl, 'application/json'),
    run(ytDlpPath, ['--dump-single-json', '--skip-download', '--no-warnings', video.pageUrl]),
    run(ytDlpPath, ['--version']),
  ])
  assert(oembedResponse.contentType.includes('json'), 'YouTube oEmbed response was not JSON')
  const oembed = JSON.parse(oembedResponse.buffer.toString('utf8'))
  const metadata = JSON.parse(metadataResult.stdout.toString('utf8'))
  assert(oembed.title === video.title, 'YouTube oEmbed title changed')
  assert(oembed.author_name === video.channel, 'YouTube oEmbed channel changed')
  assert(oembed.author_url === video.channelUrl, 'YouTube oEmbed channel URL changed')
  assert(oembed.provider_name === video.provider, 'YouTube oEmbed provider changed')
  assert(oembed.thumbnail_url === `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, 'YouTube thumbnail identity changed')
  assert(metadata.id === video.videoId, 'yt-dlp video ID changed')
  assert(metadata.title === video.title, 'yt-dlp title changed')
  assert(metadata.channel === video.channel, 'yt-dlp channel changed')
  assert(metadata.channel_id === video.channelId, 'yt-dlp channel ID changed')
  assert(metadata.upload_date === video.uploadDate.replaceAll('-', ''), 'yt-dlp upload date changed')
  assert(metadata.duration === video.durationSeconds, 'yt-dlp duration changed')
  for (const expected of video.descriptionAssertions) {
    assert(metadata.description.includes(expected), `YouTube description evidence changed: ${expected}`)
  }
  return {
    oembedUrl: video.oembedUrl,
    oembedFinalUrl: oembedResponse.finalUrl,
    oembedHttpStatus: 200,
    title: metadata.title,
    channel: metadata.channel,
    channelId: metadata.channel_id,
    uploadDate: metadata.upload_date,
    durationSeconds: metadata.duration,
    descriptionAssertionsVerified: video.descriptionAssertions,
    ytDlpVersion: versionResult.stdout.toString('utf8').trim(),
    structuredMetadataVerified: true,
  }
}

async function verifyOfficialDimension(manifest) {
  const dimension = manifest.officialDimension
  assert(dimension.apiQuery.modelCode === dimension.modelCode, 'Samsung API model code mismatch')
  const apiUrl = new URL(dimension.apiEndpoint)
  for (const [key, value] of Object.entries(dimension.apiQuery)) apiUrl.searchParams.set(key, value)
  const [pageResponse, apiResponse] = await Promise.all([
    fetchBytes(dimension.sourcePageUrl, 'text/html'),
    fetchBytes(apiUrl, 'application/json'),
  ])
  assert(pageResponse.contentType.includes('text/html'), 'Samsung product response was not HTML')
  const pageText = normalizeText(pageResponse.buffer.toString('utf8'))
  for (const expected of [dimension.modelName, dimension.modelCode, dimension.modelFamilyCode]) {
    assert(pageText.includes(expected), `Samsung product identity changed: ${expected}`)
  }
  assert(apiResponse.contentType.includes('json'), 'Samsung model API response was not JSON')
  const payload = JSON.parse(apiResponse.buffer.toString('utf8'))
  assert(payload.response?.statusCode === 200, 'Samsung model API status changed')
  assert(payload.response?.siteCode === dimension.apiQuery.siteCode, 'Samsung model API site changed')
  const specGroups = asArray(payload.response?.resultData?.Products?.Product?.Spec)
  const items = specGroups.flatMap((group) => asArray(group.SpecItems?.SpecItem))
  const matches = items.filter((item) => (
    item.SpecItemNameLevel2 === dimension.reportedLabel
    && item.SpecItemkeyLevel2 === dimension.specItemKey
    && item.SpecItemIdLevel2 === dimension.specItemId
  ))
  assert(matches.length === 1, `Expected one exact Samsung dimension item, found ${matches.length}`)
  assert(matches[0].SpecItemValue === dimension.reportedValue, 'Samsung dimensions changed')
  const plmGroups = asArray(payload.response?.resultData?.Products?.Product?.PlmSpec)
  const plmItems = plmGroups.flatMap((group) => asArray(group.PlmSpecItems?.PlmSpecItem))
  for (const expected of dimension.plmItems) {
    const match = plmItems.find((item) => item.UserKey === expected.userKey)
    assert(match, `Samsung PLM dimension is missing: ${expected.userKey}`)
    assert(match.ItemPath === expected.itemPath, `Samsung PLM path changed: ${expected.userKey}`)
    assert(match.SpecValue === expected.value, `Samsung PLM value changed: ${expected.userKey}`)
  }
  return {
    ...dimension,
    sourcePageFinalUrl: pageResponse.finalUrl,
    sourcePageHttpStatus: 200,
    apiUrl: String(apiUrl),
    apiHttpStatus: 200,
    apiStatusCode: payload.response.statusCode,
    reportedValueFound: true,
    plmDimensionsVerified: true,
  }
}

async function acquireVideo(manifest, ytDlpPath, suppliedPath, temporaryDir) {
  if (suppliedPath) return { path: suppliedPath, acquisition: 'supplied-local-file' }
  const outputTemplate = path.join(temporaryDir, 'a22-source.%(ext)s')
  await run(ytDlpPath, [
    '--no-playlist',
    '--no-warnings',
    '--merge-output-format', manifest.video.download.container,
    '-f', manifest.video.download.formatSelector,
    '-o', outputTemplate,
    manifest.video.pageUrl,
  ])
  return {
    path: path.join(temporaryDir, `a22-source.${manifest.video.download.container}`),
    acquisition: 'downloaded-with-locked-format-selector',
  }
}

async function inspectVideo(videoPath) {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate',
    '-of', 'json',
    videoPath,
  ])
  return JSON.parse(result.stdout.toString('utf8'))
}

async function extractCanonicalFrames(manifest, videoPath, temporaryDir) {
  const results = []
  for (const frame of manifest.video.frames) {
    const extractedPath = path.join(temporaryDir, `${frame.id}.png`)
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(frame.timestampSeconds),
      '-i', videoPath,
      '-frames:v', '1',
      extractedPath,
    ])
    const extracted = await readFile(extractedPath)
    const decoded = await sharp(extracted).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    assert(decoded.info.width === manifest.video.download.width, `${frame.id}: frame width changed`)
    assert(decoded.info.height === manifest.video.download.height, `${frame.id}: frame height changed`)
    assert(decoded.info.channels === 3, `${frame.id}: frame channels changed`)
    assert(sha256(decoded.data) === frame.expectedPixelSha256, `${frame.id}: decoded pixels changed`)
    const canonical = await sharp(decoded.data, { raw: decoded.info }).png().toBuffer()
    assert(sha256(canonical) === frame.expectedEncodedSha256, `${frame.id}: canonical encoding changed`)
    results.push({
      ...frame,
      canonical,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      encodedSha256: sha256(canonical),
      decodedPixelSha256: sha256(decoded.data),
    })
  }
  return results
}

async function writeVerifiedAsset(filePath, bytes) {
  try {
    const existing = await readFile(filePath)
    assert(existing.equals(bytes), `Existing verified asset differs: ${filePath}`)
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
  const suppliedVideoPath = argumentValue('--video', '')
  const manifest = JSON.parse(await readFile(inputPath, 'utf8'))
  assert(manifest.schemaVersion === 1, 'Unsupported A22 source manifest schema')
  assert(manifest.targetModelId === 'galaxy-a22-5g', 'Unexpected A22 target model')
  assert(manifest.sourceModelId === 'galaxy-a22-5g', 'Unexpected A22 source model')
  assert(manifest.video.frames.length === 6, 'Expected four identity-chain frames and two adjacent geometry stability frames')

  const ytDlpPath = await resolveYtDlp(argumentValue('--yt-dlp', ''))
  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'nillkin-a22-youtube-'))
  try {
    const [videoEvidence, officialDimensionEvidence] = await Promise.all([
      verifyOnlineVideo(manifest, ytDlpPath),
      verifyOfficialDimension(manifest),
    ])
    const acquired = await acquireVideo(manifest, ytDlpPath, suppliedVideoPath, temporaryDir)
    const videoBytes = await readFile(acquired.path)
    assert(videoBytes.length === manifest.video.download.expectedBytes, 'A22 source video byte count changed')
    assert(sha256(videoBytes) === manifest.video.download.expectedSha256, 'A22 source video hash changed')
    const probe = await inspectVideo(acquired.path)
    const videoStream = probe.streams.find((stream) => stream.codec_type === 'video')
    const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio')
    assert(videoStream?.width === manifest.video.download.width, 'A22 source video width changed')
    assert(videoStream?.height === manifest.video.download.height, 'A22 source video height changed')
    assert(videoStream?.avg_frame_rate === `${manifest.video.download.fps}/1`, 'A22 source frame rate changed')
    assert(videoStream?.codec_name === 'h264', 'A22 source video codec changed')
    assert(audioStream?.codec_name === manifest.video.download.audioCodec, 'A22 source audio codec changed')
    assert(Math.abs(Number(probe.format.duration) - manifest.video.durationSeconds) <= 1, 'A22 source duration changed')
    const frames = await extractCanonicalFrames(manifest, acquired.path, temporaryDir)

    await mkdir(outputDir, { recursive: true })
    const writtenFrames = []
    for (const frame of frames) {
      const outputPath = path.join(outputDir, frame.outputFile)
      const writeStatus = await writeVerifiedAsset(outputPath, frame.canonical)
      const { canonical, ...record } = frame
      writtenFrames.push({ ...record, path: outputPath, writeStatus })
    }
    const geometryFrame = writtenFrames.find((frame) => frame.id === 'empty-shell-geometry')
    assert(geometryFrame, 'A22 geometry frame is missing')
    const asset = {
      targetModelId: manifest.targetModelId,
      targetModelName: 'Galaxy A22 5G',
      sourceModelId: manifest.sourceModelId,
      sourceKind: 'verified-youtube-real-product-video-frame',
      derivedSourceKind: 'derived-verified-retail-source',
      publicationEligible: true,
      eligibilityReason: 'The continuous YouTube video explicitly identifies Galaxy A22 5G in its title and description, shows a Nillkin Super Frosted Shield package labeled for Samsung Galaxy A22 5G White 4336, unboxes the branded shell, installs it on the demonstrated phone, and shows the same empty shell unobstructed; Samsung independently identifies SM-A226BZAUMEA and reports 167.2 x 76.4 x 9.0 mm.',
      geometryReview: geometryFrame.selectionReview,
      geometrySource: 'The pixel-locked 472-second frame directly supplies the complete physical outer silhouette and sole complete physical camera opening of the empty Nillkin shell.',
      sourceUrl: manifest.video.pageUrl,
      path: geometryFrame.path,
      encodedSha256: geometryFrame.encodedSha256,
      decodedPixelSha256: geometryFrame.decodedPixelSha256,
      width: geometryFrame.width,
      height: geometryFrame.height,
      channels: geometryFrame.channels,
      format: 'png',
      frames: writtenFrames,
      identityChain: manifest.video.identityChain,
      videoEvidence,
      videoFileEvidence: {
        acquisition: acquired.acquisition,
        bytes: videoBytes.length,
        sha256: sha256(videoBytes),
        probe,
        formatSelector: manifest.video.download.formatSelector,
        videoFormatId: manifest.video.download.videoFormatId,
        audioFormatId: manifest.video.download.audioFormatId,
      },
      officialDimensionEvidence,
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      inputPath,
      source: 'Pixel-locked real Nillkin Galaxy A22 5G YouTube product video with a continuous package-to-shell-to-installation identity chain and first-party Samsung model API dimensions',
      summary: {
        assets: 1,
        onlineVideoRecordsVerified: 1,
        sourceVideosByteVerified: 1,
        realFramesPixelVerified: frames.length,
        identityChainFramesVerified: frames.filter((frame) => !frame.id.startsWith('empty-shell-geometry')).length,
        geometryFramesVerified: frames.filter((frame) => frame.id.startsWith('empty-shell-geometry')).length,
        officialDimensionsVerified: 1,
        written: writtenFrames.filter((frame) => frame.writeStatus === 'written').length,
        alreadyCurrent: writtenFrames.filter((frame) => frame.writeStatus === 'already-current').length,
      },
      assets: [asset],
    }
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2))
  } finally {
    await rm(temporaryDir, { recursive: true, force: true })
  }
}

await main()