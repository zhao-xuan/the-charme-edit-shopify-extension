import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const CAMERA_GAP_FRACTION = 0.05
const MODEL_FILTER = new Set(process.argv.slice(2))
const GUIDE_OVERRIDES = {
  // The iPhone 14 needs a wider, gentler turn on the camera's right side.
  'iphone-14': { rightExtension: 70, radius: 188 },
}
const keepouts = JSON.parse(await readFile('src/data/camera-keepouts.json', 'utf8'))
const guideKeepouts = {
  ...keepouts,
  'iphone-16-plus': { x: 0.03, y: 0.012, w: 0.4, h: 0.3 },
  'iphone-16-pro': { x: 0.03, y: 0.012, w: 0.6, h: 0.31 },
}
const referenceDir = path.join('reference', 'case-history', 'references')
const publicDir = path.join('public', 'assets', 'cases', 'gpt-references')

await Promise.all([
  mkdir(referenceDir, { recursive: true }),
  mkdir(publicDir, { recursive: true }),
])

for (const [modelId, keepout] of Object.entries(guideKeepouts)) {
  if (MODEL_FILTER.size && !MODEL_FILTER.has(modelId)) continue

  const sourcePath = `public/assets/cases/case-without-gel/${modelId}-white.png`
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  let left = width
  let right = 0
  let top = height
  let bottom = 0

  for (let index = 0; index < width * height; index++) {
    if (data[index * 4 + 3] <= 40) continue
    const x = index % width
    const y = Math.floor(index / width)
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }

  const caseWidth = right - left + 1
  const caseHeight = bottom - top + 1
  const gap = Math.round(caseWidth * CAMERA_GAP_FRACTION)
  let hardwareLeft = right
  let hardwareRight = left
  let hardwareTop = bottom
  let hardwareBottom = top
  const scanLeft = left + Math.round(caseWidth * 0.035)
  const expectedBarCamera = keepout.x + keepout.w >= 0.82
  const scanRight = expectedBarCamera
    ? right - Math.round(caseWidth * 0.035)
    : left + Math.round(caseWidth * 0.75)
  const scanTop = top + Math.round(caseHeight * 0.005)
  const scanBottom = top + Math.round(caseHeight * 0.38)
  for (let pixelY = scanTop; pixelY <= scanBottom; pixelY++) {
    for (let pixelX = scanLeft; pixelX <= scanRight; pixelX++) {
      const offset = (pixelY * width + pixelX) * 4
      if (data[offset + 3] <= 40) continue
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (luminance >= 105 && !(chroma > 55 && luminance < 185)) continue
      hardwareLeft = Math.min(hardwareLeft, pixelX)
      hardwareRight = Math.max(hardwareRight, pixelX)
      hardwareTop = Math.min(hardwareTop, pixelY)
      hardwareBottom = Math.max(hardwareBottom, pixelY)
    }
  }
  if (hardwareRight <= hardwareLeft || hardwareBottom <= hardwareTop) {
    throw new Error(`${modelId}: could not detect camera hardware in ${sourcePath}`)
  }
  const guideOverride = GUIDE_OVERRIDES[modelId]
  const x = Math.max(left, Math.round(left + keepout.x * caseWidth) - gap)
  const y = Math.max(top, Math.round(top + keepout.y * caseHeight) - gap)
  const keepoutRight = Math.min(
    right,
    Math.round(left + (keepout.x + keepout.w) * caseWidth) + gap + (guideOverride?.rightExtension ?? 0),
  )
  const keepoutBottom = Math.min(bottom, Math.round(top + (keepout.y + keepout.h) * caseHeight) + gap)
  const guideWidth = keepoutRight - x
  const guideHeight = keepoutBottom - y
  const radius = guideOverride?.radius ?? Math.min(
    Math.round(caseWidth * 0.08),
    Math.round(Math.min(guideWidth, guideHeight) * 0.3),
  )
  const overlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x}" y="${y}" width="${guideWidth}" height="${guideHeight}" rx="${radius}" fill="#ff3f4a" fill-opacity="0.28" stroke="#e60012" stroke-width="10"/>
</svg>`)
  const output = await sharp(data, { raw: { width, height, channels: 4 } })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer()
  const fileName = `gpt-${modelId}-wide-camera-clearance.png`

  const innerInset = Math.round(caseWidth * 0.055)
  const innerLeft = left + innerInset
  const innerTop = top + innerInset
  const innerRight = right - innerInset
  const innerBottom = bottom - Math.round(caseWidth * 0.04)
  const corner = Math.round(caseWidth * 0.1)
  const barCamera = expectedBarCamera
  const pathCameraRight = Math.min(
    innerRight - Math.round(caseWidth * 0.28),
    hardwareRight + Math.round(caseWidth * 0.11),
  )
  const pathCameraBottom = Math.min(
    innerBottom - corner * 2,
    hardwareBottom + Math.round(caseWidth * 0.07),
  )
  const shoulderX = Math.max(
    innerLeft + corner,
    pathCameraRight - Math.round(caseWidth * 0.155),
  )
  const crownX = Math.min(innerRight - corner, pathCameraRight + Math.round(caseWidth * 0.2))
  const closedPath = barCamera
    ? [
        `M ${innerLeft + corner} ${pathCameraBottom}`,
        `L ${innerRight - corner} ${pathCameraBottom}`,
        `C ${innerRight - Math.round(corner * 0.35)} ${pathCameraBottom} ${innerRight} ${pathCameraBottom + Math.round(corner * 0.35)} ${innerRight} ${pathCameraBottom + corner}`,
        `L ${innerRight} ${innerBottom - corner}`,
        `C ${innerRight} ${innerBottom - Math.round(corner * 0.35)} ${innerRight - Math.round(corner * 0.35)} ${innerBottom} ${innerRight - corner} ${innerBottom}`,
        `L ${innerLeft + corner} ${innerBottom}`,
        `C ${innerLeft + Math.round(corner * 0.35)} ${innerBottom} ${innerLeft} ${innerBottom - Math.round(corner * 0.35)} ${innerLeft} ${innerBottom - corner}`,
        `L ${innerLeft} ${pathCameraBottom + corner}`,
        `C ${innerLeft} ${pathCameraBottom + Math.round(corner * 0.35)} ${innerLeft + Math.round(corner * 0.35)} ${pathCameraBottom} ${innerLeft + corner} ${pathCameraBottom}`,
        'Z',
      ].join(' ')
    : [
        `M ${innerLeft + corner} ${pathCameraBottom}`,
        `L ${shoulderX} ${pathCameraBottom}`,
        `C ${pathCameraRight - Math.round(caseWidth * 0.09)} ${pathCameraBottom} ${pathCameraRight - Math.round(caseWidth * 0.015)} ${pathCameraBottom - Math.round(caseWidth * 0.055)} ${pathCameraRight + Math.round(caseWidth * 0.02)} ${pathCameraBottom - Math.round(caseWidth * 0.16)}`,
        `C ${pathCameraRight + Math.round(caseWidth * 0.025)} ${pathCameraBottom - Math.round(caseWidth * 0.33)} ${pathCameraRight + Math.round(caseWidth * 0.09)} ${innerTop + Math.round(caseWidth * 0.02)} ${crownX} ${innerTop + Math.round(caseWidth * 0.02)}`,
        `C ${crownX + Math.round(caseWidth * 0.1)} ${innerTop + Math.round(caseWidth * 0.02)} ${innerRight} ${innerTop + Math.round(caseWidth * 0.065)} ${innerRight} ${innerTop + Math.round(caseWidth * 0.15)}`,
        `L ${innerRight} ${innerBottom - corner}`,
        `C ${innerRight} ${innerBottom - Math.round(corner * 0.35)} ${innerRight - Math.round(corner * 0.35)} ${innerBottom} ${innerRight - corner} ${innerBottom}`,
        `L ${innerLeft + corner} ${innerBottom}`,
        `C ${innerLeft + Math.round(corner * 0.35)} ${innerBottom} ${innerLeft} ${innerBottom - Math.round(corner * 0.35)} ${innerLeft} ${innerBottom - corner}`,
        `L ${innerLeft} ${pathCameraBottom + corner}`,
        `C ${innerLeft} ${pathCameraBottom + Math.round(corner * 0.35)} ${innerLeft + Math.round(corner * 0.35)} ${pathCameraBottom} ${innerLeft + corner} ${pathCameraBottom}`,
        'Z',
      ].join(' ')
  const closedOverlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${closedPath}" fill="#ff5058" fill-opacity="0.08" stroke="#ff3f4a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`)
  const closedOutput = await sharp(data, { raw: { width, height, channels: 4 } })
    .composite([{ input: closedOverlay, left: 0, top: 0 }])
    .png()
    .toBuffer()
  const closedFileName = `gpt-${modelId}-closed-gel-path.png`

  const cropPadX = Math.round(caseWidth * 0.08)
  const cropPadY = Math.round(caseWidth * 0.06)
  const cropLeft = Math.max(0, hardwareLeft - cropPadX)
  const cropTop = Math.max(0, hardwareTop - cropPadY)
  const cropRight = Math.min(width, hardwareRight + cropPadX)
  const cropBottom = Math.min(height, hardwareBottom + cropPadY)
  const cameraOutput = await sharp(sourcePath)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: cropRight - cropLeft,
      height: cropBottom - cropTop,
    })
    .png()
    .toBuffer()
  const cameraFileName = `gpt-${modelId}-camera-lock.png`

  await Promise.all([
    writeFile(path.join(referenceDir, fileName), output),
    writeFile(path.join(publicDir, fileName), output),
    writeFile(path.join(referenceDir, closedFileName), closedOutput),
    writeFile(path.join(publicDir, closedFileName), closedOutput),
    writeFile(path.join(referenceDir, cameraFileName), cameraOutput),
    writeFile(path.join(publicDir, cameraFileName), cameraOutput),
  ])
  console.log(`${modelId}: ${gap}px camera clearance, hardware ${hardwareLeft},${hardwareTop}-${hardwareRight},${hardwareBottom}, ${barCamera ? 'bar' : 'L'} footprint`)
}