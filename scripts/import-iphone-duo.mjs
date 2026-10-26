#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const sourceDirectory = process.argv[2] || path.join(os.homedir(), 'Downloads')
const outputDirectory = 'public/assets/cases/case-without-gel'
const reportDirectory = 'reference/case-history/generated/iphone-duo'
const sources = {
  white: 'iphone-duo-witb-star-white-202609.jpg',
  black: 'iphone-duo-witb-night-sky-202609.jpg',
}
const results = []
await mkdir(outputDirectory, { recursive: true })
await mkdir(reportDirectory, { recursive: true })

for (const [finish, filename] of Object.entries(sources)) {
  const source = await readFile(path.join(sourceDirectory, filename))
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const background = [...data.subarray(0, 3)]
  const outside = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const visit = (pixel) => {
    if (outside[pixel]) return
    const offset = pixel * 4
    if (background.some((channel, index) => Math.abs(data[offset + index] - channel) > 12)) return
    outside[pixel] = 1
    queue[tail++] = pixel
  }
  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  while (head < tail) {
    const pixel = queue[head++]
    const x = pixel % width
    if (x > 0) visit(pixel - 1)
    if (x + 1 < width) visit(pixel + 1)
    if (pixel >= width) visit(pixel - width)
    if (pixel + width < outside.length) visit(pixel + width)
  }
  const fraction = tail / outside.length
  if (fraction < 0.1 || fraction > 0.5) throw new Error(`${finish}: unexpected exterior area ${fraction}`)
  for (let pixel = 0; pixel < outside.length; pixel++) {
    if (outside[pixel]) data[pixel * 4 + 3] = 0
  }
  const output = `${outputDirectory}/iphone-duo-${finish}.png`
  await sharp(data, { raw: { width, height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(output)
  const bytes = await readFile(output)
  const metadata = await sharp(bytes).metadata()
  results.push({
    finish, source: filename, output,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha,
    exteriorFraction: fraction,
  })
}

await writeFile(`${reportDirectory}/source-provenance.json`, `${JSON.stringify({
  modelId: 'iphone-duo',
  modelName: 'iPhone Duo',
  dimensionsSource: 'https://www.apple.com/iphone-duo/specs/',
  configuration: 'folded',
  widthMm: 84.1,
  heightMm: 117.8,
  depthMm: 11.3,
  method: 'Border-connected background removal; enclosed phone pixels preserved without recolouring.',
  results,
}, null, 2)}\n`)
console.log(JSON.stringify(results, null, 2))
