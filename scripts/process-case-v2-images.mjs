import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'reference', 'case-history', 'generated', 'v2', 'raw')
const GENERATED_DIR = path.join(ROOT, 'reference', 'case-history', 'generated', 'v2')
const SHELL_DIR = path.join(ROOT, 'public', 'assets', 'cases', 'case-without-gel')
const HISTORY_DIR = path.join(ROOT, 'public', 'assets', 'cases', 'case-history')

const MODELS = ['iphone-13', 'iphone-14-pro', 'iphone-16-pro-max', 'galaxy-s24-ultra']
const FINISHES = ['black', 'white', 'glitter']
const FG_DIFF = { black: 30, white: 8, glitter: 8 }
const PROFILE_FRACTION = 0.1

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function cornerBackground(data, width, height, channels) {
  const size = 12
  const rgb = [0, 0, 0]
  let count = 0
  for (const [offsetX, offsetY] of [[0, 0], [width - size, 0], [0, height - size], [width - size, height - size]]) {
    for (let y = offsetY; y < offsetY + size; y++) {
      for (let x = offsetX; x < offsetX + size; x++) {
        const index = (y * width + x) * channels
        rgb[0] += data[index]
        rgb[1] += data[index + 1]
        rgb[2] += data[index + 2]
        count++
      }
    }
  }
  return rgb.map((value) => value / count)
}

async function measureForeground(filePath, difference) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const background = await cornerBackground(data, width, height, channels)
  const rowCounts = new Int32Array(height)
  const columnCounts = new Int32Array(width)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels
      const distance = Math.hypot(
        data[index] - background[0],
        data[index + 1] - background[1],
        data[index + 2] - background[2],
      )
      if (distance > difference) {
        rowCounts[y]++
        columnCounts[x]++
      }
    }
  }

  const minimumRowPixels = width * PROFILE_FRACTION
  const minimumColumnPixels = height * PROFILE_FRACTION
  let top = 0
  let bottom = height - 1
  let left = 0
  let right = width - 1
  while (top < height && rowCounts[top] < minimumRowPixels) top++
  while (bottom >= 0 && rowCounts[bottom] < minimumRowPixels) bottom--
  while (left < width && columnCounts[left] < minimumColumnPixels) left++
  while (right >= 0 && columnCounts[right] < minimumColumnPixels) right--

  if (right <= left || bottom <= top) {
    throw new Error(`Could not measure foreground in ${filePath}`)
  }
  return {
    canvasWidth: width,
    canvasHeight: height,
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  }
}

async function processImage(modelId, finish) {
  const rawPath = path.join(RAW_DIR, `${modelId}-${finish}.png`)
  const shellPath = path.join(SHELL_DIR, `${modelId}-black.png`)
  if (!fs.existsSync(rawPath)) throw new Error(`Missing raw image: ${rawPath}`)
  if (!fs.existsSync(shellPath)) throw new Error(`Missing shell mask: ${shellPath}`)

  const bounds = await measureForeground(rawPath, FG_DIFF[finish])
  const shellMetadata = await sharp(shellPath).metadata()
  const targetWidth = shellMetadata.width
  const targetHeight = shellMetadata.height
  const rgba = await sharp(rawPath)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const alpha = await sharp(shellPath).ensureAlpha().extractChannel(3).raw().toBuffer()
  for (let pixel = 0; pixel < targetWidth * targetHeight; pixel++) {
    rgba[pixel * 4 + 3] = alpha[pixel]
  }

  const output = await sharp(rgba, {
    raw: { width: targetWidth, height: targetHeight, channels: 4 },
  }).png().toBuffer()
  const outputPath = path.join(HISTORY_DIR, modelId, finish, 'v2.png')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, output)

  return {
    modelId,
    finish,
    rawPath: path.relative(ROOT, rawPath),
    imagePath: path.relative(ROOT, outputPath),
    rawBounds: bounds,
    target: { width: targetWidth, height: targetHeight },
    rawAspect: bounds.width / bounds.height,
    targetAspect: targetWidth / targetHeight,
    horizontalCorrectionPercent: ((targetWidth / targetHeight) / (bounds.width / bounds.height) - 1) * 100,
    sha256: sha256(output),
  }
}

async function montageTile(result) {
  const tileWidth = 340
  const tileHeight = 680
  const image = await sharp(path.join(ROOT, result.imagePath))
    .resize(300, 590, { fit: 'contain' })
    .toBuffer()
  const label = `${result.modelId} / ${result.finish}`
  const text = Buffer.from(`<svg width="${tileWidth}" height="48">
    <rect width="100%" height="100%" fill="#f3f3f1"/>
    <text x="170" y="30" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#171717">${label}</text>
  </svg>`)
  return sharp({
    create: { width: tileWidth, height: tileHeight, channels: 4, background: '#e7e7e4' },
  }).composite([
    { input: text, left: 0, top: 0 },
    { input: image, left: 20, top: 65 },
  ]).png().toBuffer()
}

async function writeMontage(results) {
  const columns = 3
  const tileWidth = 340
  const tileHeight = 680
  const rows = Math.ceil(results.length / columns)
  const tiles = await Promise.all(results.map(montageTile))
  const montage = sharp({
    create: { width: columns * tileWidth, height: rows * tileHeight, channels: 4, background: '#d8d8d4' },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % columns) * tileWidth,
    top: Math.floor(index / columns) * tileHeight,
  })))
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  await montage.png().toFile(path.join(GENERATED_DIR, 'montage.png'))
}

const requestedModel = argument('model')
const models = requestedModel ? MODELS.filter((modelId) => modelId === requestedModel) : MODELS
if (!models.length) throw new Error(`Unknown --model ${requestedModel}`)

const results = []
for (const modelId of models) {
  for (const finish of FINISHES) results.push(await processImage(modelId, finish))
}
await writeMontage(results)
fs.mkdirSync(GENERATED_DIR, { recursive: true })
fs.writeFileSync(path.join(GENERATED_DIR, 'qa.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`)
for (const result of results) {
  console.log(
    `${result.modelId}:${result.finish}`,
    `${result.target.width}x${result.target.height}`,
    `horizontal correction ${result.horizontalCorrectionPercent.toFixed(2)}%`,
    result.sha256,
  )
}