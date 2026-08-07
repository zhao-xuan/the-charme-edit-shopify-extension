/**
 * process-tote.mjs
 * -------------------------------------------------------------------------
 * Produces the canvas-tote product blank from the merchant-supplied Charme
 * reference. macOS Vision separates the tote from its studio background, then
 * the pipeline removes the handle watermark, trims the alpha edge, and saves a
 * transparent photoreal product layer.
 *
 * Physical dimensions use the measured 285mm from the handle apex to the top
 * edge of the tote body. Run `npm run tote`; by default the calibrated 1280x1699
 * source is expected at .tote-src/charme-tote-reference.jpg. An explicit source
 * path may be supplied as the first argument.
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = resolve(process.argv[2] || join(ROOT, '.tote-src', 'charme-tote-reference.jpg'))
const OUT_IMG = join(ROOT, 'public', 'assets', 'totes')
const OUT_DATA = join(ROOT, 'src', 'data', 'totes.json')
const SEGMENTER = join(__dirname, '_segment-tote.swift')

const SOURCE_WIDTH = 1280
const SOURCE_HEIGHT = 1699
const HANDLE_APEX_Y = 233
const BODY_TOP_Y = 833
const REFERENCE_DISTANCE_MM = 285
const MM_PER_PX = REFERENCE_DISTANCE_MM / (BODY_TOP_Y - HANDLE_APEX_Y)

const round = (value, precision = 2) => Number(value.toFixed(precision))

function darkestRun(data, width, y, minX, maxX) {
  const runs = []
  let start = -1
  for (let x = minX; x <= maxX; x += 1) {
    const index = (y * width + x) * 4
    const isWebbing = data[index + 3] > 128 && data[index] + data[index + 1] + data[index + 2] < 430
    if (isWebbing && start < 0) start = x
    if ((!isWebbing || x === maxX) && start >= 0) {
      const end = isWebbing && x === maxX ? x : x - 1
      if (end - start >= 8) runs.push({ start, end })
      start = -1
    }
  }
  return runs.sort((a, b) => b.end - b.start - (a.end - a.start))[0] || null
}

function cloneHandleWatermark(data, width) {
  const sourceOffsetY = 300
  for (let y = 720; y <= 900; y += 1) {
    const sourceY = y - sourceOffsetY
    const fade = Math.max(0, Math.min(1, (y - 720) / 24, (900 - y) / 24))
    for (const [minX, maxX] of [[380, 560], [700, 900]]) {
      const destination = darkestRun(data, width, y, minX, maxX)
      const source = darkestRun(data, width, sourceY, minX, maxX)
      if (!destination || !source) continue
      const margin = 2
      const destinationStart = destination.start - margin
      const destinationEnd = destination.end + margin
      const sourceStart = source.start - margin
      const sourceEnd = source.end + margin
      for (let x = destinationStart; x <= destinationEnd; x += 1) {
        const progress = (x - destinationStart) / Math.max(1, destinationEnd - destinationStart)
        const sourceX = Math.round(sourceStart + progress * (sourceEnd - sourceStart))
        const destinationIndex = (y * width + x) * 4
        const sourceIndex = (sourceY * width + sourceX) * 4
        for (let channel = 0; channel < 3; channel += 1) {
          data[destinationIndex + channel] = Math.round(
            data[destinationIndex + channel] * (1 - fade) + data[sourceIndex + channel] * fade,
          )
        }
      }
    }
  }
}

function erodeAlpha(data, width, height, radius = 2) {
  const alpha = new Uint8Array(width * height)
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = data[pixel * 4 + 3]
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let minimum = 255
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue
          minimum = Math.min(minimum, alpha[(y + dy) * width + x + dx])
        }
      }
      data[(y * width + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round((minimum - 24) * 255 / 231)))
    }
  }
}

function alphaBounds(data, width, height, threshold = 8) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('Foreground mask is empty')
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function main() {
  const metadata = await sharp(SRC).metadata()
  if (metadata.width !== SOURCE_WIDTH || metadata.height !== SOURCE_HEIGHT) {
    throw new Error(`Expected the calibrated ${SOURCE_WIDTH}x${SOURCE_HEIGHT} source, got ${metadata.width}x${metadata.height}`)
  }

  await mkdir(OUT_IMG, { recursive: true })
  const temp = await mkdtemp(join(tmpdir(), 'charme-tote-'))
  const segmentedPath = join(temp, 'segmented.png')
  try {
    const result = spawnSync('swift', [SEGMENTER, SRC, segmentedPath], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || 'Vision foreground segmentation failed')

    const segmented = await sharp(segmentedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    cloneHandleWatermark(segmented.data, segmented.info.width)
    erodeAlpha(segmented.data, segmented.info.width, segmented.info.height)
    const alphaBox = alphaBounds(segmented.data, segmented.info.width, segmented.info.height)
    const cropTop = Math.min(alphaBox.top, HANDLE_APEX_Y)
    const box = {
      ...alphaBox,
      top: cropTop,
      height: alphaBox.top + alphaBox.height - cropTop,
    }
    const outputPath = join(OUT_IMG, 'charme-natural.png')
    await sharp(segmented.data, {
      raw: { width: segmented.info.width, height: segmented.info.height, channels: 4 },
    })
      .extract(box)
      .png({ compressionLevel: 9, palette: false })
      .toFile(outputPath)

    const tote = {
      src: '/assets/totes/charme-natural.png',
      pxW: box.width,
      pxH: box.height,
      aspect: round(box.width / box.height, 4),
      widthMm: round(box.width * MM_PER_PX, 1),
      heightMm: round(box.height * MM_PER_PX, 1),
      calibration: {
        reference: 'handle apex to body top',
        distancePx: BODY_TOP_Y - HANDLE_APEX_Y,
        distanceMm: REFERENCE_DISTANCE_MM,
        mmPerPx: round(MM_PER_PX, 4),
        handleApexY: HANDLE_APEX_Y - box.top,
        bodyTopY: BODY_TOP_Y - box.top,
        bodyTopMm: round((BODY_TOP_Y - box.top) * MM_PER_PX, 1),
      },
    }
    await writeFile(OUT_DATA, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'merchant-supplied Charme tote reference',
      totes: { 'tote-tj': tote },
    }, null, 2)}\n`)
    console.log(`tote blank ${box.width}x${box.height}px = ${tote.widthMm}x${tote.heightMm}mm -> ${outputPath}`)
    console.log(`calibration ${tote.calibration.distancePx}px = ${REFERENCE_DISTANCE_MM}mm; body top ${tote.calibration.bodyTopMm}mm`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
