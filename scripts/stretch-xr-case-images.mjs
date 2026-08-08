#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outputDirectory = process.argv[2]
const verticalScale = 0.75
if (!outputDirectory) {
  throw new Error('Usage: node scripts/stretch-xr-case-images.mjs <output-directory>')
}

const sources = [
  { finish: 'black', fileName: 'iphone-xr-black-764373cffd08.png' },
  { finish: 'white', fileName: 'iphone-xr-white-bb3c1071109a.png' },
]

async function opaqueBounds(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] !== 255) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) throw new Error('No opaque case pixels found')
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

await mkdir(outputDirectory, { recursive: true })
let blackBounds = null
for (const { finish, fileName } of sources) {
  const inputPath = `public/assets/cases/generated-phone-bodies/${fileName}`
  const input = await readFile(inputPath)
  const metadata = await sharp(input).metadata()
  const scaledHeight = Math.round(metadata.height * verticalScale)
  const top = Math.floor((metadata.height - scaledHeight) / 2)
  const stretched = await sharp(input)
    .ensureAlpha()
    .resize({ width: metadata.width, height: scaledHeight, fit: 'fill' })
    .png()
    .toBuffer()
  let aligned = stretched
  let left = 0
  let compositeTop = top
  if (finish === 'black') {
    blackBounds = await opaqueBounds(stretched)
    blackBounds.top += top
  } else {
    const whiteBounds = await opaqueBounds(stretched)
    const scaleX = blackBounds.width / whiteBounds.width
    const scaleY = blackBounds.height / whiteBounds.height
    aligned = await sharp(stretched)
      .resize({ width: Math.ceil(metadata.width * scaleX), height: Math.round(scaledHeight * scaleY), fit: 'fill' })
      .png()
      .toBuffer()
    const scaledBounds = await opaqueBounds(aligned)
    const cropLeft = scaledBounds.left - blackBounds.left
    aligned = await sharp(aligned)
      .extract({ left: cropLeft, top: 0, width: metadata.width, height: Math.round(scaledHeight * scaleY) })
      .png()
      .toBuffer()
    const alignedBounds = await opaqueBounds(aligned)
    left = blackBounds.left - alignedBounds.left
    compositeTop = blackBounds.top - alignedBounds.top
  }
  const outputPath = path.join(outputDirectory, `iphone-xr-${finish}-without-gel-horizontal-stretch.png`)
  await writeFile(outputPath, await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: aligned, top: compositeTop, left }]).png().toBuffer())
  console.log(`iphone-xr / ${finish}: ${outputPath}`)
}