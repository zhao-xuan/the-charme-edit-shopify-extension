#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { rekey } from './rekey-broken-charms.mjs'

const ROOT = process.cwd()
const PIECE_DIR = path.join(ROOT, 'reference/3-charms-each-piece')
const PUBLIC_DIR = path.join(ROOT, 'public/assets/charms/ref')
const SOURCE_STAGE_DIR = path.join(ROOT, 'reference/charm-repairs/generated')
const SOURCE_CROP_DIR = path.join(ROOT, 'reference/charm-repairs/source-crops')
const OUTPUT_DIR = path.join(ROOT, 'reference/charm-repairs/structural-generated')
const REPORT_PATH = path.join(ROOT, 'reference/charm-repairs/structural-repair-report.json')
const APPLY = process.argv.includes('--apply')

const TARGETS = [
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-15',
    documentImage: 'image19.png',
    name: 'Gold Gemstone',
    method: 'Remove the attachment ring above source row 38.',
    repair: () => removeTopRing('ddcc0c89-ac31-4abb-b784-1406f89c9bbb-15', 38),
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-01',
    documentImage: 'image24.png',
    name: 'Silver Sun',
    method: 'Open the source-backed center at (105, 110) with a 31 px feathered radius.',
    repair: () => openCenter('52e483c2-c80e-4920-998c-c7bf5aa59b8a-01', 105, 110, 31),
  },
  {
    id: 'silver-03',
    documentImage: 'image7.png',
    name: 'Silver Heart',
    method: 'Re-key the authentic source and replace the attachment-ring band with mirrored left-lobe pixels.',
    repair: repairSilverHeart,
  },
  {
    id: 'image2-02',
    documentImage: 'image9.png',
    name: 'Red Mini Heart',
    method: 'Re-key the authentic source, preserve the attachment-ring opening, and convert only the surrounding metal from gold to cool silver.',
    repair: repairRedHeart,
  },
  {
    id: 'image2-24',
    documentImage: 'image20.png',
    name: 'Black Gold Flower Medallion',
    method: 'Remove the attachment ring above source row 33.',
    repair: () => removeTopRing('image2-24', 33),
  },
]

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)))

async function sourceStage(id) {
  return sharp(path.join(SOURCE_STAGE_DIR, `${id}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
}

async function sourceRekey(id, options) {
  const source = path.relative(ROOT, path.join(SOURCE_CROP_DIR, `${id}.png`))
  const current = await sharp(path.join(PIECE_DIR, `${id}.png`)).metadata()
  const repaired = await rekey(id, source, false, options)
  return sharp(repaired.buf)
    .resize(current.width, current.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
}

async function encode(data, info) {
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

async function removeTopRing(id, cutY) {
  const { data, info } = await sourceStage(id)
  const output = Buffer.from(data)
  for (let y = 0; y < cutY; y++) {
    for (let x = 0; x < info.width; x++) output[(y * info.width + x) * 4 + 3] = 0
  }
  return encode(output, info)
}

async function openCenter(id, centerX, centerY, radius) {
  const { data, info } = await sourceStage(id)
  const output = Buffer.from(data)
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const distance = Math.hypot(x - centerX, y - centerY)
      const alphaOffset = (y * info.width + x) * 4 + 3
      if (distance <= radius - 1) output[alphaOffset] = 0
      else if (distance < radius + 1) {
        output[alphaOffset] = Math.round(output[alphaOffset] * ((distance - radius + 1) / 2))
      }
    }
  }
  return encode(output, info)
}

async function repairSilverHeart() {
  const { data, info } = await sourceRekey('silver-03', {
    softLo: 30,
    softHi: 72,
    binT: 48,
  })
  const output = Buffer.from(data)
  const mirrorAxis = 89
  const bandLeft = 84
  const bandRight = 156
  const solidRows = 36
  const featherRows = 10

  for (let y = 0; y < solidRows + featherRows; y++) {
    for (let x = bandLeft; x <= bandRight; x++) {
      const horizontal = Math.min(1, (x - bandLeft) / 8, (bandRight - x) / 8)
      const vertical = y < solidRows ? 1 : Math.max(0, 1 - (y - solidRows) / featherRows)
      const weight = Math.max(0, Math.min(horizontal, vertical))
      if (!weight) continue
      const sourceX = Math.max(0, Math.min(info.width - 1, mirrorAxis * 2 - x))
      const sourceOffset = (y * info.width + sourceX) * 4
      const targetOffset = (y * info.width + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        output[targetOffset + channel] = Math.round(
          output[targetOffset + channel] * (1 - weight) + data[sourceOffset + channel] * weight,
        )
      }
    }
  }
  return encode(output, info)
}

function morph(mask, width, height, dilate) {
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = dilate ? 0 : 1
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nextX = x + dx
          const nextY = y + dy
          const on =
            nextX >= 0 &&
            nextY >= 0 &&
            nextX < width &&
            nextY < height &&
            mask[nextY * width + nextX]
          if (dilate && on) value = 1
          if (!dilate && !on) value = 0
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

function fillEnamel(seed, width, height) {
  let enamel = seed
  for (let pass = 0; pass < 2; pass++) enamel = morph(enamel, width, height, true)
  for (let pass = 0; pass < 2; pass++) enamel = morph(enamel, width, height, false)

  const reachable = new Uint8Array(width * height)
  const stack = []
  const push = (point) => {
    if (point < 0 || point >= reachable.length || enamel[point] || reachable[point]) return
    reachable[point] = 1
    stack.push(point)
  }
  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (stack.length) {
    const point = stack.pop()
    const x = point % width
    const y = Math.floor(point / width)
    if (x > 0) push(point - 1)
    if (x < width - 1) push(point + 1)
    if (y > 0) push(point - width)
    if (y < height - 1) push(point + width)
  }
  for (let point = 0; point < enamel.length; point++) {
    const y = Math.floor(point / width)
    if (y >= 34 && !enamel[point] && !reachable[point]) enamel[point] = 1
    if (y < 34) enamel[point] = 0
  }
  return enamel
}

async function repairRedHeart() {
  const { data, info } = await sourceRekey('image2-02', {
    softLo: 42,
    softHi: 82,
    binT: 54,
  })
  const pixelCount = info.width * info.height
  const seed = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    const offset = point * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const y = Math.floor(point / info.width)
    if (
      y >= 34 &&
      data[offset + 3] > 24 &&
      red > 65 &&
      green < red * 0.52 &&
      blue < red * 0.72
    ) {
      seed[point] = 1
    }
  }

  const enamel = fillEnamel(seed, info.width, info.height)
  const output = Buffer.from(data)
  for (let point = 0; point < pixelCount; point++) {
    const offset = point * 4
    if (data[offset + 3] < 8 || enamel[point]) continue
    const luminance =
      (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * 1.04 + 2
    output[offset] = clampByte(luminance * 0.97)
    output[offset + 1] = clampByte(luminance)
    output[offset + 2] = clampByte(luminance * 1.04)
  }

  const holeCenterX = 55
  const holeCenterY = 26.5
  const holeRadiusX = 9.5
  const holeRadiusY = 10.5
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const distance = Math.hypot(
        (x - holeCenterX) / holeRadiusX,
        (y - holeCenterY) / holeRadiusY,
      )
      const alphaOffset = (y * info.width + x) * 4 + 3
      if (distance <= 0.9) output[alphaOffset] = 0
      else if (distance < 1) output[alphaOffset] = Math.round(output[alphaOffset] * ((distance - 0.9) / 0.1))
    }
  }
  return encode(output, info)
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const report = []
  for (const target of TARGETS) {
    const output = await target.repair()
    const outputPath = path.join(OUTPUT_DIR, `${target.id}.png`)
    fs.writeFileSync(outputPath, output)
    if (APPLY) {
      fs.writeFileSync(path.join(PIECE_DIR, `${target.id}.png`), output)
      fs.writeFileSync(path.join(PUBLIC_DIR, `${target.id}.png`), output)
    }
    const metadata = await sharp(output).metadata()
    report.push({
      id: target.id,
      documentImage: target.documentImage,
      name: target.name,
      method: target.method,
      output: path.relative(ROOT, outputPath),
      sha256: crypto.createHash('sha256').update(output).digest('hex'),
      width: metadata.width,
      height: metadata.height,
      applied: APPLY,
    })
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!APPLY) console.log('\nGenerated staging artwork only. Re-run with --apply after visual QA.')
}

main()