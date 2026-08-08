#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outputDirectory = process.argv[2]
const insetIndex = process.argv.indexOf('--inset')
const inset = insetIndex >= 0 ? Number(process.argv[insetIndex + 1]) : 0
if (!outputDirectory || !Number.isInteger(inset) || inset < 0 || inset > 40) {
  throw new Error('Usage: node scripts/matte-white-case-frames.mjs <output-directory> [--inset 0-40]')
}

// Measured against each source's visible outer shell. The soft boundary removes
// the residual rectangular white haze without changing case RGB pixels.
const targets = [
  { modelId: 'iphone-14', x: 61, y: 20, width: 819, height: 1638, radius: 108 },
  { modelId: 'iphone-16-pro', x: 42, y: 8, width: 822, height: 1722, radius: 116 },
]

function roundedRectAlpha(x, y, target) {
  const right = target.x + target.width - 1
  const bottom = target.y + target.height - 1
  const radius = target.radius
  const centerX = Math.max(target.x + radius, Math.min(right - radius, x))
  const centerY = Math.max(target.y + radius, Math.min(bottom - radius, y))
  const distance = Math.hypot(x - centerX, y - centerY) - radius
  return Math.max(0, Math.min(255, Math.round((1 - distance) * 255)))
}

await mkdir(outputDirectory, { recursive: true })
for (const target of targets) {
  const matte = {
    ...target,
    x: target.x + inset,
    y: target.y + inset,
    width: target.width - inset * 2,
    height: target.height - inset * 2,
    radius: target.radius - inset,
  }
  const inputPath = `public/assets/cases/case-without-gel/${target.modelId}-white.png`
  const bytes = await readFile(inputPath)
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 4
      data[offset + 3] = Math.min(data[offset + 3], roundedRectAlpha(x, y, matte))
    }
  }
  const outputPath = path.join(outputDirectory, `${target.modelId}-white-without-gel-matted.png`)
  await writeFile(outputPath, await sharp(data, { raw: info }).png().toBuffer())
  console.log(`${target.modelId}: ${outputPath}`)
}