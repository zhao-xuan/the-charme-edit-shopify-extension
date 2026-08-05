#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const modelId = argument('model')
const finish = argument('finish')
const alphaThreshold = Number(argument('alpha-threshold', '128'))
const outputDirectory = argument(
  'output-directory',
  'reference/case-history/generated/samsung-xiaomi-without-gel-completion/references',
)

if (!modelId || !['black', 'white'].includes(finish)) {
  throw new Error('Pass --model and --finish black|white')
}
if (!Number.isInteger(alphaThreshold) || alphaThreshold < 1 || alphaThreshold > 255) {
  throw new Error('--alpha-threshold must be an integer from 1 to 255')
}

const sourcePath = `public/assets/cases/case-with-gel/integrated-${modelId}-${finish}.png`
const outputPath = path.join(outputDirectory, `${modelId}-${finish}-silhouette-guide.png`)
const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const guide = Buffer.alloc(info.width * info.height * 4)
let visiblePixels = 0

for (let index = 0; index < info.width * info.height; index += 1) {
  if (data[index * info.channels + 3] < alphaThreshold) continue
  const offset = index * 4
  guide[offset] = 230
  guide[offset + 1] = 0
  guide[offset + 2] = 18
  guide[offset + 3] = 255
  visiblePixels += 1
}
if (!visiblePixels) throw new Error(`No source silhouette found in ${sourcePath}`)

await mkdir(outputDirectory, { recursive: true })
await sharp(guide, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(outputPath)
console.log(JSON.stringify({ sourcePath, outputPath, widthPx: info.width, heightPx: info.height, visiblePixels }))