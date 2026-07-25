#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const APPLY = process.argv.includes('--apply')
const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}
const OUTPUT_DIR = valueAfter(
  '--output',
  APPLY
    ? path.join(ROOT, 'reference/charm-repairs/authentic-generated')
    : path.join(os.tmpdir(), 'charme-authentic-rebuild'),
)
const SOURCE_CROP_DIR = APPLY
  ? path.join(ROOT, 'reference/charm-repairs/authentic-source-crops')
  : path.join(OUTPUT_DIR, 'sources')
const PIECE_DIR = path.join(ROOT, 'reference/3-charms-each-piece')
const PUBLIC_DIR = path.join(ROOT, 'public/assets/charms/ref')
const CATALOG_PATH = path.join(ROOT, 'src/data/catalog.json')
const CATEGORY_PATH = path.join(ROOT, 'reference/charm-categories.json')
const REPORT_PATH = path.join(ROOT, 'reference/charm-repairs/authentic-rebuild-report.json')

const WORKING_HEIGHT = 1800
const CROP_MARGIN = 60
const TARGETS = [
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-01',
    name: 'Gold Cross',
    pieceId: 'P019',
    photo: 'Image_20260618161924_516_813.jpg',
    box: { x: 712, y: 334, w: 137, h: 284 },
    anchor: { x: 0.55, y: 0.9 },
    widthMm: 17.5,
    heightMm: 36.2,
  },
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-28',
    name: 'Gold Leaf',
    pieceId: 'P043',
    photo: 'Image_20260618161925_517_813.jpg',
    box: { x: 237, y: 1129, w: 246, h: 362 },
    anchor: { x: 0.55, y: 0.88 },
    widthMm: 27.5,
    heightMm: 40.5,
  },
]

const luminance = (red, green, blue) => 0.299 * red + 0.587 * green + 0.114 * blue
const saturation = (red, green, blue) => {
  const maximum = Math.max(red, green, blue)
  return maximum ? (maximum - Math.min(red, green, blue)) / maximum : 0
}
const median = (values) => {
  values.sort((left, right) => left - right)
  return values[values.length >> 1]
}
const quantile = (values, fraction) => {
  values.sort((left, right) => left - right)
  return values[Math.min(values.length - 1, Math.round((values.length - 1) * fraction))]
}
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

function floodFromBorder(passable, width, height) {
  const filled = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  let stackSize = 0
  const seed = (point) => {
    if (point < 0 || point >= passable.length || filled[point] || !passable[point]) return
    filled[point] = 1
    stack[stackSize++] = point
  }

  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }

  while (stackSize) {
    const point = stack[--stackSize]
    const x = point % width
    const y = Math.floor(point / width)
    if (x > 0) seed(point - 1)
    if (x < width - 1) seed(point + 1)
    if (y > 0) seed(point - width)
    if (y < height - 1) seed(point + width)
  }
  return filled
}

function fillHoles(mask, width, height) {
  const inverse = new Uint8Array(mask.length)
  for (let point = 0; point < mask.length; point++) inverse[point] = mask[point] ? 0 : 1
  const outside = floodFromBorder(inverse, width, height)
  const filled = new Uint8Array(mask.length)
  for (let point = 0; point < mask.length; point++) filled[point] = mask[point] || !outside[point] ? 1 : 0
  return filled
}

function dilate(mask, width, height) {
  const output = new Uint8Array(mask.length)
  for (let point = 0; point < mask.length; point++) {
    if (!mask[point]) continue
    const x = point % width
    const y = Math.floor(point / width)
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const nextX = x + offsetX
        const nextY = y + offsetY
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
        output[nextY * width + nextX] = 1
      }
    }
  }
  return output
}

function erode(mask, width, height) {
  const output = new Uint8Array(mask.length)
  for (let point = 0; point < mask.length; point++) {
    if (!mask[point]) continue
    const x = point % width
    const y = Math.floor(point / width)
    let keep = true
    for (let offsetY = -1; offsetY <= 1 && keep; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const nextX = x + offsetX
        const nextY = y + offsetY
        if (
          nextX < 0 || nextY < 0 || nextX >= width || nextY >= height ||
          !mask[nextY * width + nextX]
        ) {
          keep = false
          break
        }
      }
    }
    if (keep) output[point] = 1
  }
  return output
}

function labelComponents(mask, width, height, minimumArea = 8) {
  const labels = new Int32Array(mask.length)
  const stack = new Int32Array(mask.length)
  const components = []
  let nextLabel = 0

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    const label = ++nextLabel
    let stackSize = 0
    let area = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    stack[stackSize++] = start
    labels[start] = label

    while (stackSize) {
      const point = stack[--stackSize]
      const x = point % width
      const y = Math.floor(point / width)
      area++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
          const next = nextY * width + nextX
          if (!mask[next] || labels[next]) continue
          labels[next] = label
          stack[stackSize++] = next
        }
      }
    }

    if (area >= minimumArea) {
      components.push({ label, area, minX, minY, maxX, maxY, anchorDistance: Infinity })
    }
  }
  return { labels, components }
}

function chooseAnchoredComponent(labels, components, width, anchorX, anchorY) {
  const byLabel = new Map(components.map((component) => [component.label, component]))
  for (let point = 0; point < labels.length; point++) {
    const component = byLabel.get(labels[point])
    if (!component) continue
    const x = point % width
    const y = Math.floor(point / width)
    const distance = (x - anchorX) ** 2 + (y - anchorY) ** 2
    if (distance < component.anchorDistance) component.anchorDistance = distance
  }
  return components.sort(
    (left, right) => left.anchorDistance - right.anchorDistance || right.area - left.area,
  )[0]
}

function buildPieceMask(data, width, height, targetBox, anchor) {
  const redSamples = []
  const greenSamples = []
  const blueSamples = []
  for (let point = 0; point < width * height; point += 2) {
    const offset = point * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    if (saturation(red, green, blue) > 0.12) continue
    redSamples.push(red)
    greenSamples.push(green)
    blueSamples.push(blue)
  }
  const background = {
    red: quantile(redSamples, 0.72),
    green: quantile(greenSamples, 0.72),
    blue: quantile(blueSamples, 0.72),
  }
  const backgroundLuminance = luminance(background.red, background.green, background.blue)
  const pixelCount = width * height
  const pixelLuminance = new Float32Array(pixelCount)
  const colourDistance = new Float32Array(pixelCount)
  const pixelSaturation = new Float32Array(pixelCount)
  const gradient = new Float32Array(pixelCount)

  for (let point = 0; point < pixelCount; point++) {
    const offset = point * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    pixelLuminance[point] = luminance(red, green, blue)
    pixelSaturation[point] = saturation(red, green, blue)
    colourDistance[point] = Math.hypot(
      red - background.red,
      green - background.green,
      blue - background.blue,
    )
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const point = y * width + x
      const gradientX =
        -pixelLuminance[point - width - 1] - 2 * pixelLuminance[point - 1] - pixelLuminance[point + width - 1] +
        pixelLuminance[point - width + 1] + 2 * pixelLuminance[point + 1] + pixelLuminance[point + width + 1]
      const gradientY =
        -pixelLuminance[point - width - 1] - 2 * pixelLuminance[point - width] - pixelLuminance[point - width + 1] +
        pixelLuminance[point + width - 1] + 2 * pixelLuminance[point + width] + pixelLuminance[point + width + 1]
      gradient[point] = Math.hypot(gradientX, gradientY) / 4
    }
  }

  const pureBackground = new Uint8Array(pixelCount)
  const shadowLike = new Uint8Array(pixelCount)
  const passable = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (colourDistance[point] <= 22) pureBackground[point] = 1
    if (
      pixelSaturation[point] <= 0.32 &&
      gradient[point] <= 26 &&
      backgroundLuminance - pixelLuminance[point] >= 2 &&
      pixelLuminance[point] >= 80
    ) {
      shadowLike[point] = 1
    }
    passable[point] = pureBackground[point] || shadowLike[point] ? 1 : 0
  }
  const pureReach = floodFromBorder(pureBackground, width, height)
  const shadowReach = floodFromBorder(passable, width, height)
  const trueBackground = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    trueBackground[point] = pureReach[point] || (shadowReach[point] && shadowLike[point]) ? 1 : 0
  }

  let frontier = []
  for (let point = 0; point < pixelCount; point++) if (trueBackground[point]) frontier.push(point)
  for (let pass = 0; pass < 24; pass++) {
    const nextFrontier = []
    for (const point of frontier) {
      const x = point % width
      const y = Math.floor(point / width)
      const neighbours = [
        x > 0 ? point - 1 : -1,
        x < width - 1 ? point + 1 : -1,
        y > 0 ? point - width : -1,
        y < height - 1 ? point + width : -1,
      ]
      for (const neighbour of neighbours) {
        if (neighbour < 0 || trueBackground[neighbour]) continue
        if (
          gradient[neighbour] <= 20 &&
          pixelSaturation[neighbour] <= 0.32 &&
          backgroundLuminance - pixelLuminance[neighbour] >= 2 &&
          pixelLuminance[neighbour] >= 80
        ) {
          trueBackground[neighbour] = 1
          nextFrontier.push(neighbour)
        }
      }
    }
    if (!nextFrontier.length) break
    frontier = nextFrontier
  }

  const flatBackground = new Uint8Array(pixelCount)
  const foreground = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (
      colourDistance[point] <= 28 &&
      pixelSaturation[point] <= 0.15 &&
      gradient[point] <= 8
    ) {
      flatBackground[point] = 1
    }
    foreground[point] = !trueBackground[point] && !flatBackground[point] ? 1 : 0
  }

  const filledForeground = fillHoles(foreground, width, height)
  const labelled = labelComponents(filledForeground, width, height, 20)
  const anchorX = targetBox.x + targetBox.w * anchor.x
  const anchorY = targetBox.y + targetBox.h * anchor.y
  const selected = chooseAnchoredComponent(
    labelled.labels,
    labelled.components,
    width,
    anchorX,
    anchorY,
  )
  if (!selected) throw new Error('No foreground component found at target anchor')

  const selectedMask = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (labelled.labels[point] === selected.label) selectedMask[point] = 1
  }

  const holeCandidates = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (selectedMask[point] && !foreground[point]) holeCandidates[point] = 1
  }
  const holes = labelComponents(holeCandidates, width, height, 1)
  const minimumHoleArea = Math.max(8, Math.round(selected.area * 0.0015))
  for (const hole of holes.components) {
    if (hole.area < minimumHoleArea) continue
    let distanceTotal = 0
    let gradientTotal = 0
    let confirmedBackground = 0
    for (let point = 0; point < pixelCount; point++) {
      if (holes.labels[point] !== hole.label) continue
      distanceTotal += colourDistance[point]
      gradientTotal += gradient[point]
      if (trueBackground[point]) confirmedBackground++
    }
    const backgroundShare = confirmedBackground / hole.area
    if (
      backgroundShare < 0.5 &&
      (distanceTotal / hole.area > 30 || gradientTotal / hole.area > 10)
    ) continue
    for (let point = 0; point < pixelCount; point++) {
      if (holes.labels[point] === hole.label) selectedMask[point] = 0
    }
  }

  const metalEvidence = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (!selectedMask[point]) continue
    const offset = point * 4
    const red = data[offset]
    const blue = data[offset + 2]
    const warmMetal = pixelSaturation[point] > 0.15 && red - blue > 10
    const brightReflection = pixelLuminance[point] > backgroundLuminance + 12 && gradient[point] > 5
    const darkReflection = pixelLuminance[point] < backgroundLuminance - 35 && gradient[point] > 12
    const detailedMetal = gradient[point] > 24 && colourDistance[point] > 28
    if (warmMetal || brightReflection || darkReflection || detailedMetal) metalEvidence[point] = 1
  }
  let metalSupport = metalEvidence
  for (let pass = 0; pass < 4; pass++) metalSupport = dilate(metalSupport, width, height)
  const supportedMask = new Uint8Array(pixelCount)
  for (let point = 0; point < pixelCount; point++) {
    if (selectedMask[point] && metalSupport[point]) supportedMask[point] = 1
  }
  const closedSupported = erode(dilate(supportedMask, width, height), width, height)
  const supportedComponents = labelComponents(closedSupported, width, height, 8)
  const finalComponent = chooseAnchoredComponent(
    supportedComponents.labels,
    supportedComponents.components,
    width,
    anchorX,
    anchorY,
  )
  if (!finalComponent) throw new Error('No metal-supported component found at target anchor')
  selectedMask.fill(0)
  for (let point = 0; point < pixelCount; point++) {
    if (supportedComponents.labels[point] === finalComponent.label) selectedMask[point] = 1
  }

  return { mask: selectedMask, background, selected: finalComponent }
}

async function rebuild(target) {
  const sourcePath = path.join(ROOT, 'reference/1-charms-real-image', target.photo)
  const rotated = sharp(sourcePath).rotate()
  const metadata = await rotated.metadata()
  const workingWidth = Math.round(metadata.width * WORKING_HEIGHT / metadata.height)
  const crop = {
    left: Math.max(0, target.box.x - CROP_MARGIN),
    top: Math.max(0, target.box.y - CROP_MARGIN),
  }
  crop.width = Math.min(workingWidth - crop.left, target.box.w + CROP_MARGIN * 2)
  crop.height = Math.min(WORKING_HEIGHT - crop.top, target.box.h + CROP_MARGIN * 2)
  const sourceCrop = await rotated.resize(workingWidth, WORKING_HEIGHT).extract(crop).png().toBuffer()
  const { data, info } = await sharp(sourceCrop).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const targetInCrop = {
    x: target.box.x - crop.left,
    y: target.box.y - crop.top,
    w: target.box.w,
    h: target.box.h,
  }
  const segmented = buildPieceMask(data, info.width, info.height, targetInCrop, target.anchor)

  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let point = 0; point < segmented.mask.length; point++) {
    if (!segmented.mask[point]) continue
    const x = point % info.width
    const y = Math.floor(point / info.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error(`Empty mask for ${target.id}`)

  const padding = 4
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(info.width - 1, maxX + padding)
  maxY = Math.min(info.height - 1, maxY + padding)
  const trimWidth = maxX - minX + 1
  const trimHeight = maxY - minY + 1
  const rgba = Buffer.alloc(info.width * info.height * 4)
  for (let point = 0; point < segmented.mask.length; point++) {
    if (!segmented.mask[point]) continue
    const offset = point * 4
    rgba[offset] = data[offset]
    rgba[offset + 1] = data[offset + 1]
    rgba[offset + 2] = data[offset + 2]
    rgba[offset + 3] = 255
  }

  const currentMetadata = await sharp(path.join(PIECE_DIR, `${target.id}.png`)).metadata()
  const longestSide = Math.max(currentMetadata.width, currentMetadata.height)
  const scale = longestSide / Math.max(trimWidth, trimHeight)
  const outputWidth = Math.max(1, Math.round(trimWidth * scale))
  const outputHeight = Math.max(1, Math.round(trimHeight * scale))
  const output = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: minX, top: minY, width: trimWidth, height: trimHeight })
    .resize(outputWidth, outputHeight, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer()

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.mkdirSync(SOURCE_CROP_DIR, { recursive: true })
  fs.writeFileSync(path.join(SOURCE_CROP_DIR, `${target.pieceId}.png`), sourceCrop)
  fs.writeFileSync(path.join(OUTPUT_DIR, `${target.id}.png`), output)

  return {
    id: target.id,
    name: target.name,
    pieceId: target.pieceId,
    sourcePhoto: target.photo,
    sourceBox: target.box,
    sourceCrop: path.relative(ROOT, path.join(SOURCE_CROP_DIR, `${target.pieceId}.png`)),
    sourceSha256: sha256(sourceCrop),
    output: path.relative(ROOT, path.join(OUTPUT_DIR, `${target.id}.png`)),
    outputSha256: sha256(output),
    width: outputWidth,
    height: outputHeight,
    widthMm: target.widthMm,
    heightMm: target.heightMm,
    selectedArea: segmented.selected.area,
    background: segmented.background,
  }
}

function updateRecordFile(filePath, reports) {
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const byId = new Map(reports.map((report) => [report.id, report]))
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (value.id && byId.has(value.id)) {
      const report = byId.get(value.id)
      value.pxW = report.width
      value.pxH = report.height
      if ('widthMm' in value) value.widthMm = report.widthMm
      if ('heightMm' in value) value.heightMm = report.heightMm
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(document)
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`)
}

const reports = []
for (const target of TARGETS) reports.push(await rebuild(target))

if (APPLY) {
  for (const report of reports) {
    const output = fs.readFileSync(path.join(OUTPUT_DIR, `${report.id}.png`))
    fs.writeFileSync(path.join(PIECE_DIR, `${report.id}.png`), output)
    fs.writeFileSync(path.join(PUBLIC_DIR, `${report.id}.png`), output)
  }
  updateRecordFile(CATALOG_PATH, reports)
  updateRecordFile(CATEGORY_PATH, reports)
  fs.writeFileSync(
    REPORT_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'authentic real photographs', reports }, null, 2)}\n`,
  )
}

console.log(JSON.stringify({ applied: APPLY, outputDir: OUTPUT_DIR, reports }, null, 2))