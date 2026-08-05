#!/usr/bin/env node
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function positiveInteger(name, fallback) {
  const value = Number(argument(name, fallback))
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`)
  return value
}

function parseBounds(value) {
  const bounds = value.split(',').map(Number)
  if (bounds.length !== 4 || bounds.some((number) => !Number.isInteger(number))) {
    throw new Error('--bounds must be left,top,right,bottom using inclusive integer coordinates')
  }
  const [left, top, right, bottom] = bounds
  if (left < 0 || top < 0 || right < left || bottom < top) {
    throw new Error('--bounds coordinates are invalid')
  }
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 }
}

const sourcePath = argument('source')
const outputPath = argument('output')
const bounds = parseBounds(argument('bounds'))
const canvasWidth = positiveInteger('canvas-width', '1024')
const canvasHeight = positiveInteger('canvas-height', '1024')
const targetHeight = positiveInteger('target-height', '1012')

if (!sourcePath || !outputPath || path.extname(outputPath).toLowerCase() !== '.png') {
  throw new Error('Pass --source and a PNG --output')
}
if (targetHeight > canvasHeight) throw new Error('--target-height cannot exceed --canvas-height')

const sourceMetadata = await sharp(sourcePath).metadata()
if (!sourceMetadata.width || !sourceMetadata.height) throw new Error(`Cannot read ${sourcePath}`)
if (bounds.right >= sourceMetadata.width || bounds.bottom >= sourceMetadata.height) {
  throw new Error('--bounds extend beyond the source image')
}
await access(outputPath).then(
  () => { throw new Error(`${outputPath} already exists`) },
  (error) => { if (error.code !== 'ENOENT') throw error },
)

const { data: product, info: productInfo } = await sharp(sourcePath)
  .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
  .resize({ height: targetHeight })
  .png()
  .toBuffer({ resolveWithObject: true })
if (productInfo.width > canvasWidth) throw new Error('The resized product is wider than the output canvas')

const left = Math.floor((canvasWidth - productInfo.width) / 2)
const top = Math.floor((canvasHeight - productInfo.height) / 2)
await mkdir(path.dirname(outputPath), { recursive: true })
await sharp({
  create: {
    width: canvasWidth,
    height: canvasHeight,
    channels: 3,
    background: '#ffffff',
  },
})
  .composite([{ input: product, left, top }])
  .png()
  .toFile(outputPath)

console.log(JSON.stringify({
  sourcePath,
  outputPath,
  sourceBoundsPx: bounds,
  sourceAspect: bounds.width / bounds.height,
  canvasWidth,
  canvasHeight,
  productBoundsPx: {
    left,
    top,
    right: left + productInfo.width - 1,
    bottom: top + productInfo.height - 1,
    width: productInfo.width,
    height: productInfo.height,
  },
  productAspect: productInfo.width / productInfo.height,
}))