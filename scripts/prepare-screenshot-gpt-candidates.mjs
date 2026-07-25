#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1]
}

const APPLY = args.includes('--apply')
const VERIFY = args.includes('--verify')
const SELF_TEST = args.includes('--self-test')
const manifestPath = path.resolve(
  ROOT,
  valueAfter('--manifest', 'reference/charm-repairs/screenshot-gpt-manifest.json'),
)
const inputDir = path.resolve(
  ROOT,
  valueAfter('--input', 'reference/charm-repairs/screenshot-gpt-generated/original'),
)
const outputDir = path.resolve(
  ROOT,
  valueAfter('--output', 'reference/charm-repairs/screenshot-gpt-generated/normalized'),
)
const reportPath = path.resolve(
  ROOT,
  valueAfter('--report', 'reference/charm-repairs/screenshot-gpt-candidate-report.json'),
)

if (!SELF_TEST && APPLY === VERIFY) throw new Error('Specify exactly one of --verify or --apply')

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const round = (value, digits = 4) => Number(value.toFixed(digits))

function components(mask, width, height, target) {
  const seen = new Uint8Array(mask.length)
  const found = []
  const stack = []

  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== target) continue
    seen[start] = 1
    stack.push(start)
    let area = 0
    let touchesEdge = false

    while (stack.length) {
      const point = stack.pop()
      const x = point % width
      const y = Math.floor(point / width)
      area++
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true

      const neighbours = [point - 1, point + 1, point - width, point + width]
      for (const next of neighbours) {
        if (next < 0 || next >= mask.length || seen[next] || mask[next] !== target) continue
        if (Math.abs((next % width) - x) > 1) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    found.push({ area, touchesEdge })
  }

  return found.sort((left, right) => right.area - left.area)
}

function alphaMetrics(data, info, threshold = 32) {
  const { width, height, channels } = info
  const mask = new Uint8Array(width * height)
  let transparentPixels = 0
  let semiTransparentPixels = 0
  let opaquePixels = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let point = 0; point < mask.length; point++) {
    const alpha = data[point * channels + 3]
    if (alpha <= 8) transparentPixels++
    else if (alpha >= 248) opaquePixels++
    else semiTransparentPixels++
    if (alpha < threshold) continue
    mask[point] = 1
    const x = point % width
    const y = Math.floor(point / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const foreground = components(mask, width, height, 1)
  const mainArea = foreground[0]?.area || 0
  const significantComponentArea = Math.max(8, Math.ceil(mainArea * 0.002))
  const significantComponents = foreground.filter((component) => component.area >= significantComponentArea)
  const significantHoleArea = Math.max(3, Math.ceil(mainArea * 0.0004))
  const holes = components(mask, width, height, 0).filter(
    (component) => !component.touchesEdge && component.area >= significantHoleArea,
  )
  const total = width * height
  const cornerAlpha = [0, width - 1, (height - 1) * width, total - 1].map(
    (point) => data[point * channels + 3],
  )

  return {
    bbox: maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    transparentRatio: round(transparentPixels / total),
    semiTransparentRatio: round(semiTransparentPixels / total),
    opaqueRatio: round(opaquePixels / total),
    visibleRatio: round((semiTransparentPixels + opaquePixels) / total),
    significantComponentCount: significantComponents.length,
    significantComponentAreas: significantComponents.map((component) => component.area),
    significantHoleCount: holes.length,
    significantHoleAreas: holes.map((component) => component.area),
    cornerAlpha,
  }
}

function edgeMetrics(data, info) {
  const { width, height, channels } = info
  let edgePixels = 0
  let whiteFringePixels = 0
  let neutralShadowPixels = 0

  for (let point = 0; point < width * height; point++) {
    const alpha = data[point * channels + 3]
    if (alpha <= 8 || alpha >= 248) continue
    const x = point % width
    const y = Math.floor(point / width)
    let bordersTransparency = false
    for (let dy = -2; dy <= 2 && !bordersTransparency; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          bordersTransparency = true
          break
        }
        if (data[(nextY * width + nextX) * channels + 3] <= 8) {
          bordersTransparency = true
          break
        }
      }
    }
    if (!bordersTransparency) continue

    edgePixels++
    const offset = point * channels
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const colourRange = Math.max(red, green, blue) - Math.min(red, green, blue)
    const lightness = 0.299 * red + 0.587 * green + 0.114 * blue
    if (colourRange <= 28 && lightness >= 220) whiteFringePixels++
    if (colourRange <= 20 && lightness >= 55 && lightness <= 210 && alpha <= 180) neutralShadowPixels++
  }

  return {
    edgePixels,
    whiteFringePixels,
    whiteFringeRatio: round(whiteFringePixels / (edgePixels || 1)),
    neutralShadowPixels,
    neutralShadowRatio: round(neutralShadowPixels / (edgePixels || 1)),
  }
}

async function inspect(buffer) {
  const image = sharp(buffer, { failOn: 'error' })
  const metadata = await image.metadata()
  const raw = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { metadata, raw, alpha: alphaMetrics(raw.data, raw.info), edge: edgeMetrics(raw.data, raw.info) }
}

async function coreArtwork(buffer, threshold) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let point = 0; point < info.width * info.height; point++) {
    const alphaOffset = point * info.channels + 3
    const alpha = data[alphaOffset] >= threshold ? 255 : 0
    data[alphaOffset] = alpha
    if (!alpha) continue
    const x = point % info.width
    const y = Math.floor(point / info.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error(`No alpha pixels meet the ${threshold} core threshold`)
  const image = await sharp(data, { raw: info }).png().toBuffer()
  return {
    image,
    bbox: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

function keepLargestComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length)
  let largest = []
  const stack = []

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const current = []
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const point = stack.pop()
      current.push(point)
      const x = point % width
      const neighbours = [point - 1, point + 1, point - width, point + width]
      for (const next of neighbours) {
        if (next < 0 || next >= mask.length || !mask[next] || seen[next]) continue
        if (Math.abs((next % width) - x) > 1) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    if (current.length > largest.length) largest = current
  }

  const output = new Uint8Array(mask.length)
  for (const point of largest) output[point] = 1
  return output
}

function erodeMask(mask, width, height, radius) {
  if (!radius) return mask
  const output = new Uint8Array(mask.length)
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const point = y * width + x
      if (!mask[point]) continue
      let keep = true
      for (let nextY = y - radius; nextY <= y + radius && keep; nextY++) {
        for (let nextX = x - radius; nextX <= x + radius; nextX++) {
          if (!mask[nextY * width + nextX]) {
            keep = false
            break
          }
        }
      }
      if (keep) output[point] = 1
    }
  }
  return output
}

async function chromaArtwork(buffer, chromaKey) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const minimumMagentaExcess = chromaKey.minimumMagentaExcess
  let mask = new Uint8Array(info.width * info.height)
  for (let point = 0; point < mask.length; point++) {
    const offset = point * info.channels
    const magentaExcess = Math.min(data[offset], data[offset + 2]) - data[offset + 1]
    if (magentaExcess < minimumMagentaExcess) mask[point] = 1
  }
  mask = keepLargestComponent(mask, info.width, info.height)
  mask = erodeMask(mask, info.width, info.height, chromaKey.erodeRadius)
  mask = keepLargestComponent(mask, info.width, info.height)

  const rgba = Buffer.alloc(mask.length * 4)
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let point = 0; point < mask.length; point++) {
    const sourceOffset = point * info.channels
    const outputOffset = point * 4
    rgba[outputOffset] = data[sourceOffset]
    rgba[outputOffset + 1] = data[sourceOffset + 1]
    rgba[outputOffset + 2] = data[sourceOffset + 2]
    rgba[outputOffset + 3] = mask[point] ? 255 : 0
    if (!mask[point]) continue
    const x = point % info.width
    const y = Math.floor(point / info.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) throw new Error('Chroma key did not find a physical charm body')
  return {
    image: await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(),
    bbox: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    mode: 'chroma',
    keying: { minimumMagentaExcess, erodeRadius: chromaKey.erodeRadius },
  }
}

async function prepareArtwork(buffer, alphaCoreThreshold, chromaKey) {
  const inspection = await inspect(buffer)
  if (!inspection.metadata.hasAlpha || inspection.alpha.transparentRatio < 0.05) {
    return chromaArtwork(buffer, chromaKey)
  }
  return { ...await coreArtwork(buffer, alphaCoreThreshold), mode: 'alpha' }
}

async function normalize(prepared, targetWidth, targetHeight) {
  const padding = Math.min(10, Math.max(2, Math.floor(Math.min(targetWidth, targetHeight) * 0.06)))
  const innerWidth = targetWidth - padding * 2
  const innerHeight = targetHeight - padding * 2
  const extracted = await sharp(prepared.image)
    .extract(prepared.bbox)
    .resize({ width: innerWidth, height: innerHeight, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer({ resolveWithObject: true })
  const left = Math.floor((targetWidth - extracted.info.width) / 2)
  const top = Math.floor((targetHeight - extracted.info.height) / 2)
  return sharp({
    create: { width: targetWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: extracted.data, left, top }])
    .png()
    .toBuffer()
}

function validateInspection(target, inspection, normalizedInspection = null, sourceMetadata = inspection.metadata) {
  const errors = []
  const warnings = []
  const { metadata, alpha, edge } = inspection

  if (sourceMetadata.format !== 'png') {
    errors.push(`Expected PNG source, received ${sourceMetadata.format || 'unknown format'}`)
  }
  if ((sourceMetadata.width || 0) < 256 || (sourceMetadata.height || 0) < 256) {
    errors.push(`GPT original is too small (${sourceMetadata.width}x${sourceMetadata.height}; minimum 256px per side)`)
  }
  if (!metadata.hasAlpha) errors.push('Prepared artwork has no alpha channel')
  if (!alpha.bbox) errors.push('No visible charm pixels')
  if (alpha.transparentRatio < 0.05) errors.push('Background is not substantially transparent')
  if (alpha.opaqueRatio < 0.01) errors.push('No opaque charm core detected')
  if (alpha.cornerAlpha.some((value) => value > 8)) errors.push(`Canvas corners are not transparent (${alpha.cornerAlpha.join(', ')})`)
  if (alpha.significantComponentCount !== 1) {
    errors.push(`Expected one connected charm body, found ${alpha.significantComponentCount}`)
  }
  if (alpha.bbox) {
    const aspectRatio = alpha.bbox.width / alpha.bbox.height
    const aspectDrift = Math.abs(Math.log(aspectRatio / target.expectedAspectRatio))
    if (aspectDrift > Math.log(1.25)) {
      errors.push(`Silhouette aspect ${round(aspectRatio)} differs from source ${target.expectedAspectRatio}`)
    }
  }
  if (edge.whiteFringeRatio > 0.35 && edge.whiteFringePixels >= 16) {
    warnings.push(`Possible white halo: ${edge.whiteFringePixels} edge pixels (${edge.whiteFringeRatio})`)
  }
  if (edge.neutralShadowRatio > 0.2 && edge.neutralShadowPixels >= 16) {
    warnings.push(`Possible neutral shadow: ${edge.neutralShadowPixels} edge pixels (${edge.neutralShadowRatio})`)
  }

  if (normalizedInspection) {
    const normalized = normalizedInspection.alpha
    if (normalized.significantComponentCount !== 1) {
      errors.push(`Normalized artwork has ${normalized.significantComponentCount} significant components`)
    }
    if (normalized.significantHoleCount < target.minimumTransparentOpenings) {
      errors.push(
        `Normalized artwork has ${normalized.significantHoleCount} transparent openings; ` +
        `${target.minimumTransparentOpenings} required`,
      )
    }
    for (let index = 0; index < (target.minimumOpeningAreas || []).length; index++) {
      const actualArea = normalized.significantHoleAreas[index] || 0
      const minimumArea = target.minimumOpeningAreas[index]
      if (actualArea < minimumArea) {
        errors.push(
          `Transparent opening ${index + 1} is ${actualArea}px; at least ${minimumArea}px required ` +
          'on the target canvas',
        )
      }
    }
    if (normalized.bbox) {
      const touchesCanvas = normalized.bbox.left === 0 || normalized.bbox.top === 0 ||
        normalized.bbox.left + normalized.bbox.width === normalizedInspection.metadata.width ||
        normalized.bbox.top + normalized.bbox.height === normalizedInspection.metadata.height
      if (touchesCanvas) errors.push('Normalized charm touches or is clipped by the canvas edge')
    }
  }

  return { errors, warnings }
}

async function analyseTarget(target, catalogueById, alphaCoreThreshold, chromaKey) {
  const inputPath = path.join(inputDir, `${target.id}.png`)
  const charm = catalogueById.get(target.id)
  if (!charm) return { id: target.id, status: 'rejected', errors: ['Catalogue record is missing'], warnings: [] }
  if (!fs.existsSync(inputPath)) return { id: target.id, status: 'missing', errors: ['GPT original is missing'], warnings: [] }

  const original = fs.readFileSync(inputPath)
  try {
    const originalInspection = await inspect(original)
    const prepared = await prepareArtwork(original, alphaCoreThreshold, chromaKey)
    const preparedInspection = await inspect(prepared.image)
    const normalized = await normalize(prepared, charm.pxW, charm.pxH)
    const normalizedInspection = await inspect(normalized)
    const validation = validateInspection(target, preparedInspection, normalizedInspection, originalInspection.metadata)
    const status = validation.errors.length ? 'rejected' : 'ready_for_manual_review'
    return {
      id: target.id,
      name: target.name,
      status,
      input: path.relative(ROOT, inputPath),
      output: path.relative(ROOT, path.join(outputDir, `${target.id}.png`)),
      sourceReference: target.input,
      requiredTransparentOpenings: target.requiredTransparentOpenings,
      minimumTransparentOpenings: target.minimumTransparentOpenings,
      originalSha256: sha256(original),
      original: {
        width: originalInspection.metadata.width,
        height: originalInspection.metadata.height,
        hasAlpha: originalInspection.metadata.hasAlpha,
      },
      prepared: {
        mode: prepared.mode,
        keying: prepared.keying || null,
        alpha: preparedInspection.alpha,
        edge: preparedInspection.edge,
      },
      normalizedSha256: normalized ? sha256(normalized) : null,
      normalized: normalizedInspection ? {
        width: normalizedInspection.metadata.width,
        height: normalizedInspection.metadata.height,
        alpha: normalizedInspection.alpha,
        edge: normalizedInspection.edge,
      } : null,
      errors: validation.errors,
      warnings: validation.warnings,
      normalizedBuffer: normalized,
    }
  } catch (error) {
    return { id: target.id, status: 'rejected', errors: [error.message], warnings: [] }
  }
}

async function selfTest() {
  const source = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: Buffer.from(
    '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="#b88b34" fill-rule="evenodd" d="M96 60H416V452H96Z ' +
    'M156 130H236V230H156Z M276 280H356V390H276Z"/></svg>',
  ) }]).png().toBuffer()
  const target = { expectedAspectRatio: 320 / 392, minimumTransparentOpenings: 2 }
  const originalInspection = await inspect(source)
  const prepared = await prepareArtwork(source, 224, { minimumMagentaExcess: 120, erodeRadius: 2 })
  const normalized = await normalize(prepared, 130, 168)
  const normalizedInspection = await inspect(normalized)
  const result = validateInspection(target, await inspect(prepared.image), normalizedInspection, originalInspection.metadata)
  if (result.errors.length || normalizedInspection.alpha.significantHoleCount !== 2) {
    throw new Error(`Self-test failed: ${JSON.stringify({ result, alpha: normalizedInspection.alpha })}`)
  }
  console.log('Self-test passed: cutout normalization preserved one body and two openings.')
}

async function main() {
  if (SELF_TEST) return selfTest()

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/catalog.json'), 'utf8')).charms
  const catalogueById = new Map(catalogue.map((charm) => [charm.id, charm]))
  for (const target of manifest.targets) {
    const sourcePath = path.resolve(ROOT, target.input)
    if (!fs.existsSync(sourcePath)) throw new Error(`${target.id}: authentic source input is missing`)
    if (sha256(fs.readFileSync(sourcePath)) !== target.sourceSha256) {
      throw new Error(`${target.id}: authentic source input differs from the visually reviewed SHA-256`)
    }
  }
  const results = []
  for (const target of manifest.targets) {
    results.push(await analyseTarget(
      target,
      catalogueById,
      manifest.alphaCoreThreshold || 224,
      manifest.chromaKey || { minimumMagentaExcess: 120, erodeRadius: 2 },
    ))
  }

  if (APPLY) {
    fs.mkdirSync(outputDir, { recursive: true })
    for (const result of results) {
      if (result.status !== 'ready_for_manual_review') continue
      fs.writeFileSync(path.join(outputDir, `${result.id}.png`), result.normalizedBuffer)
    }
  }

  const publicResults = results.map(({ normalizedBuffer, ...result }) => result)
  const summary = {
    total: results.length,
    readyForManualReview: results.filter((result) => result.status === 'ready_for_manual_review').length,
    missing: results.filter((result) => result.status === 'missing').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
  }
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'verify',
    manifest: path.relative(ROOT, manifestPath),
    inputDirectory: path.relative(ROOT, inputDir),
    outputDirectory: path.relative(ROOT, outputDir),
    manualReviewRequired: true,
    summary,
    results: publicResults,
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `${APPLY ? 'Prepared' : 'Verified'} ${summary.readyForManualReview}/${summary.total} candidates; ` +
    `${summary.missing} missing; ${summary.rejected} rejected -> ${path.relative(ROOT, reportPath)}`,
  )
  if (summary.readyForManualReview !== summary.total) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\nError: ${error.message || error}`)
  process.exit(1)
})