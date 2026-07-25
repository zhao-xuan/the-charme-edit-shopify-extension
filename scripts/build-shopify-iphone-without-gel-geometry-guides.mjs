#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const AUDIT_PATH = 'reference/shopify-iphone-case-size-audit.json'
const CAMERA_KEEPOUTS_PATH = 'src/data/camera-keepouts.json'
const OUTPUT_DIR = 'reference/case-history/generated/shopify-iphone-without-gel-regeneration/references'
const OUTPUT_MANIFEST = path.join(OUTPUT_DIR, 'geometry-guides.json')
const EXPECTED_MODEL_COUNT = 20
const CANVAS = { width: 1024, height: 2048 }
const BODY_HEIGHT = 1984
const CAMERA_FALLBACKS = {
  'iphone-16': { x: 0.03, y: 0.013, w: 0.48, h: 0.282 },
  'iphone-16-plus': { x: 0.03, y: 0.015, w: 0.47, h: 0.27 },
  'iphone-16-pro': { x: 0.02, y: 0.018, w: 0.62, h: 0.3 },
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function roundedRect({ left, top, width, height }, radius) {
  return `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" />`
}

const [audit, cameraKeepouts] = await Promise.all([
  readFile(AUDIT_PATH, 'utf8').then(JSON.parse),
  readFile(CAMERA_KEEPOUTS_PATH, 'utf8').then(JSON.parse),
])
const targets = audit.products.filter((product) => product.dimensionStatus === 'issue')
if (targets.length !== EXPECTED_MODEL_COUNT) {
  throw new Error(`Expected ${EXPECTED_MODEL_COUNT} dimension-issue models, found ${targets.length}`)
}

await mkdir(OUTPUT_DIR, { recursive: true })
const guides = []
for (const product of targets) {
  const camera = cameraKeepouts[product.id] || CAMERA_FALLBACKS[product.id]
  if (!camera) throw new Error(`Missing camera keepout for ${product.id}`)
  const targetAspect = product.appleDeviceMm.width / product.appleDeviceMm.height
  const body = {
    width: Math.round(BODY_HEIGHT * targetAspect),
    height: BODY_HEIGHT,
  }
  body.left = Math.round((CANVAS.width - body.width) / 2)
  body.top = Math.round((CANVAS.height - body.height) / 2)
  body.right = body.left + body.width - 1
  body.bottom = body.top + body.height - 1

  const cameraBounds = {
    left: body.left + Math.round(camera.x * body.width),
    top: body.top + Math.round(camera.y * body.height),
    width: Math.round(camera.w * body.width),
    height: Math.round(camera.h * body.height),
  }
  cameraBounds.right = cameraBounds.left + cameraBounds.width - 1
  cameraBounds.bottom = cameraBounds.top + cameraBounds.height - 1

  const bodyRadius = Math.round(body.width * 0.115)
  const cameraRadius = Math.round(Math.min(cameraBounds.width, cameraBounds.height) * 0.16)
  const svg = Buffer.from(`<svg width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff" />
  <g fill="#eef1f4" stroke="#e23d4d" stroke-width="10">
    ${roundedRect(body, bodyRadius)}
  </g>
  <g fill="#8bd8f7" fill-opacity="0.68" stroke="#087ea4" stroke-width="10">
    ${roundedRect(cameraBounds, cameraRadius)}
  </g>
</svg>`)
  const bytes = await sharp(svg).png().toBuffer()
  const filePath = path.join(OUTPUT_DIR, `${product.id}-size-camera-guide.png`)
  await writeFile(filePath, bytes)
  guides.push({
    modelId: product.id,
    modelName: product.name,
    filePath,
    sha256: sha256(bytes),
    targetMm: product.appleDeviceMm,
    targetAspect: round(targetAspect),
    canvasPx: CANVAS,
    bodyBoundsPx: body,
    renderedBodyAspect: round(body.width / body.height),
    renderedBodyAspectDriftPercent: round(Math.abs((body.width / body.height) / targetAspect - 1) * 100, 3),
    cameraNormalized: camera,
    cameraGeometrySource: cameraKeepouts[product.id]
      ? CAMERA_KEEPOUTS_PATH
      : 'measured from the same-model Black source image',
    cameraBoundsPx: cameraBounds,
    authority: {
      redOutline: 'device-body width-to-height proportion only',
      blueRegion: 'camera position and occupied region only',
    },
  })
}

const manifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/build-shopify-iphone-without-gel-geometry-guides.mjs',
  sourceAuditPath: AUDIT_PATH,
  sourceCameraKeepoutsPath: CAMERA_KEEPOUTS_PATH,
  policy: 'Standalone schematic references only. No source or candidate product pixels.',
  guides,
}
await writeFile(OUTPUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(JSON.stringify({
  outputManifest: OUTPUT_MANIFEST,
  guides: guides.length,
  maximumBodyAspectDriftPercent: Math.max(...guides.map((guide) => guide.renderedBodyAspectDriftPercent)),
}, null, 2))