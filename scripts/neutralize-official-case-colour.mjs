#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

async function decode(filePath) {
  const bytes = await readFile(filePath)
  const image = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { bytes, ...image }
}

const sourcePath = argument('source')
const comparisonPath = argument('comparison')
const outputPath = argument('output')
const minimumDifference = Number(argument('min-difference', '30'))
const minimumWarmth = Number(argument('min-warmth', '6'))
const lightnessScale = Number(argument('lightness-scale', '1.03'))

if (!sourcePath || !comparisonPath || !outputPath) {
  throw new Error('Pass --source, --comparison and --output')
}
if (![minimumDifference, minimumWarmth, lightnessScale].every(Number.isFinite)) {
  throw new Error('Colour thresholds must be finite numbers')
}

const [source, comparison] = await Promise.all([
  decode(sourcePath),
  decode(comparisonPath),
])
if (source.info.width !== comparison.info.width || source.info.height !== comparison.info.height) {
  throw new Error('Source and comparison dimensions differ')
}

const output = Buffer.from(source.data)
let changedPixels = 0
let hardwarePixelsPreserved = 0
for (let offset = 0; offset < output.length; offset += 4) {
  const alpha = source.data[offset + 3]
  if (!alpha) continue
  const red = source.data[offset]
  const green = source.data[offset + 1]
  const blue = source.data[offset + 2]
  const difference = Math.abs(red - comparison.data[offset])
    + Math.abs(green - comparison.data[offset + 1])
    + Math.abs(blue - comparison.data[offset + 2])
  const warmth = red - blue
  if (difference < minimumDifference || warmth < minimumWarmth) {
    hardwarePixelsPreserved += 1
    continue
  }
  const lightness = clamp((red * 0.2126 + green * 0.7152 + blue * 0.0722) * lightnessScale)
  output[offset] = lightness
  output[offset + 1] = lightness
  output[offset + 2] = lightness
  changedPixels += 1
}

const outputBytes = await sharp(output, {
  raw: source.info,
}).png().toBuffer()
await writeFile(outputPath, outputBytes, { flag: 'wx' })

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
console.log(JSON.stringify({
  sourcePath,
  sourceSha256: sha256(source.bytes),
  comparisonPath,
  comparisonSha256: sha256(comparison.bytes),
  outputPath,
  outputSha256: sha256(outputBytes),
  widthPx: source.info.width,
  heightPx: source.info.height,
  changedPixels,
  hardwarePixelsPreserved,
  parameters: { minimumDifference, minimumWarmth, lightnessScale },
}, null, 2))