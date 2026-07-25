#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { rekey } from './rekey-broken-charms.mjs'

const ROOT = process.cwd()
const CATALOG_PATH = path.join(ROOT, 'src/data/catalog.json')
const MANIFEST_PATH = path.join(ROOT, 'reference/3-charms-each-piece/manifest.json')
const PIECE_DIR = path.join(ROOT, 'reference/3-charms-each-piece')
const PUBLIC_DIR = path.join(ROOT, 'public/assets/charms/ref')
const REFERENCE_DIR = path.join(ROOT, 'reference/charm-repairs/missing-references')
const SOURCE_CROP_DIR = path.join(ROOT, 'reference/charm-repairs/missing-source-crops')
const OUTPUT_DIR = path.join(ROOT, 'reference/charm-repairs/missing-generated')
const REPORT_PATH = path.join(ROOT, 'reference/charm-repairs/missing-charm-report.json')
const APPLY = process.argv.includes('--apply')
const APPLY_METALS = process.argv.includes('--apply-metals')
const SET_ID = 'f1554077-9a1d-4e7c-bf0a-000000000abc'
const METAL_EDGE_TARGETS = new Set([`${SET_ID}-02`, `${SET_ID}-04`])

const TARGETS = [
  {
    documentImage: 'image1.png',
    id: 'silver-17',
    name: 'Silver Pearl',
    existing: true,
    widthMm: 15.2,
    heightMm: 14.4,
    sizeBasis: 'Measured real piece P125.',
    method: 'Reuse the exact existing artwork and correct its catalogue dimensions to the measured real piece.',
  },
  {
    documentImage: 'image2.png',
    id: `${SET_ID}-01`,
    name: 'Orange Glitter Star',
    category: 'colourful',
    collection: 'Celestial',
    subcategory: 'celestial',
    charmLabel: 'star',
    widthMm: 19.9,
    heightMm: 20,
    sizeBasis: 'Estimated from the measured 20 mm star family and constrained to the final artwork aspect ratio; source photo 366 has no case ruler.',
    method: 'Extract the same physical orange glitter star from the high-resolution carbon-fibre source photo.',
    build: buildOrangeStar,
  },
  {
    documentImage: 'image3.png',
    id: 'image3-26',
    name: 'Colourful Plumeria',
    existing: true,
    widthMm: 20.7,
    heightMm: 20,
    sizeBasis: 'Measured real piece P243.',
    method: 'Reuse the exact unpublished local artwork and correct its catalogue dimensions to the measured real piece.',
  },
  {
    documentImage: 'image4.png',
    id: 'silver-22',
    name: 'Silver Gemstone',
    existing: true,
    widthMm: 14.9,
    heightMm: 19.4,
    sizeBasis: 'Measured real piece P131.',
    method: 'Reuse the exact existing artwork and correct its catalogue dimensions to the measured real piece.',
  },
  {
    documentImage: 'image5.png',
    id: `${SET_ID}-02`,
    name: 'Large Silver Butterfly',
    category: 'silver',
    collection: 'Animals & insects',
    subcategory: 'animal',
    charmLabel: 'butterfly',
    widthMm: 30,
    heightMm: 27.2,
    sizeBasis: 'Estimated from the measured 30 mm large-butterfly family and constrained to the final artwork aspect ratio.',
    method: 'Re-key the exact document reference while preserving every designed wing opening.',
    build: () => buildReference('image5.png', false, {
      softLo: 7,
      softHi: 38,
      binT: 18,
      closeR: 1,
      holeMaxFrac: 0,
      edgeMode: 'silver',
    }),
  },
  {
    documentImage: 'image6.jpg',
    id: `${SET_ID}-03`,
    name: 'White Star & Moon Pair',
    category: 'unique',
    collection: 'Celestial',
    subcategory: 'celestial',
    charmLabel: 'star moon',
    widthMm: 39,
    heightMm: 21,
    sizeBasis: 'Estimated as two approximately 20 mm pieces in the documented side-by-side set and constrained to the final artwork aspect ratio.',
    method: 'Extract both exact white pieces from the high-resolution document photograph and preserve their documented spacing.',
    build: () => extractMasked(path.join(REFERENCE_DIR, 'image6.jpg'), {
      score: (red, green, blue) => (red + green + blue) / 3,
      threshold: 145,
      keepCount: 2,
      closeRadius: 2,
    }),
  },
  {
    documentImage: 'image7.png',
    id: `${SET_ID}-04`,
    name: 'Gold Sculpted Bow',
    category: 'gold',
    collection: 'Symbols',
    subcategory: 'symbol',
    charmLabel: 'bow',
    widthMm: 20,
    heightMm: 19.1,
    sizeBasis: 'Estimated from the measured 20 mm bow family and constrained to the final artwork aspect ratio.',
    method: 'Re-key the exact document reference while preserving the sculpted ribbon and negative spaces.',
    build: () => buildReference('image7.png', false, {
      softLo: 7,
      softHi: 42,
      binT: 18,
      closeR: 1,
      holeMaxFrac: 0,
      edgeMode: 'gold',
    }),
  },
]

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

function relative(file) {
  return path.relative(ROOT, file)
}

async function buildReference(filename, solid, options) {
  const result = await rekey(
    path.parse(filename).name,
    relative(path.join(REFERENCE_DIR, filename)),
    solid,
    options,
  )
  return result.buf
}

async function buildOrangeStar() {
  const sourcePath = path.join(ROOT, 'reference/1-charms-real-image/Image_20260619201121_366_2327.jpg')
  const cropPath = path.join(SOURCE_CROP_DIR, 'orange-glitter-star.png')
  await sharp(sourcePath)
    .extract({ left: 210, top: 350, width: 470, height: 470 })
    .png()
    .toFile(cropPath)
  return extractMasked(cropPath, {
    score: (red, green, blue) => red - (green + blue) / 2,
    threshold: 18,
    keepCount: 1,
    closeRadius: 2,
  })
}

function erode(mask, width, height) {
  const output = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const point = row * width + column
      if (!mask[point]) continue
      let keep = true
      for (let rowOffset = -1; rowOffset <= 1 && keep; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
          const nextColumn = column + columnOffset
          const nextRow = row + rowOffset
          if (
            nextColumn < 0 ||
            nextRow < 0 ||
            nextColumn >= width ||
            nextRow >= height ||
            !mask[nextRow * width + nextColumn]
          ) {
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

function dilate(mask, width, height) {
  const output = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const point = row * width + column
      if (mask[point]) {
        output[point] = 1
        continue
      }
      for (let rowOffset = -1; rowOffset <= 1 && !output[point]; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
          const nextColumn = column + columnOffset
          const nextRow = row + rowOffset
          if (
            nextColumn >= 0 &&
            nextRow >= 0 &&
            nextColumn < width &&
            nextRow < height &&
            mask[nextRow * width + nextColumn]
          ) {
            output[point] = 1
            break
          }
        }
      }
    }
  }
  return output
}

function close(mask, width, height, radius) {
  let output = mask
  for (let pass = 0; pass < radius; pass++) output = dilate(output, width, height)
  for (let pass = 0; pass < radius; pass++) output = erode(output, width, height)
  return output
}

function components(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1)
  const areas = []
  const stack = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] >= 0) continue
    const label = areas.length
    let area = 0
    labels[start] = label
    stack.push(start)
    while (stack.length) {
      const point = stack.pop()
      const column = point % width
      const row = Math.floor(point / width)
      area++
      const neighbours = [point - 1, point + 1, point - width, point + width]
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= mask.length || !mask[neighbour] || labels[neighbour] >= 0) continue
        if (Math.abs((neighbour % width) - column) > 1 || Math.abs(Math.floor(neighbour / width) - row) > 1) continue
        labels[neighbour] = label
        stack.push(neighbour)
      }
    }
    areas.push(area)
  }
  return { labels, areas }
}

function fillHoles(mask, width, height) {
  const reachable = new Uint8Array(mask.length)
  const stack = []
  const push = (point) => {
    if (point < 0 || point >= mask.length || mask[point] || reachable[point]) return
    reachable[point] = 1
    stack.push(point)
  }
  for (let column = 0; column < width; column++) {
    push(column)
    push((height - 1) * width + column)
  }
  for (let row = 0; row < height; row++) {
    push(row * width)
    push(row * width + width - 1)
  }
  while (stack.length) {
    const point = stack.pop()
    const column = point % width
    const row = Math.floor(point / width)
    if (column > 0) push(point - 1)
    if (column < width - 1) push(point + 1)
    if (row > 0) push(point - width)
    if (row < height - 1) push(point + width)
  }
  const output = mask.slice()
  for (let point = 0; point < output.length; point++) {
    if (!mask[point] && !reachable[point]) output[point] = 1
  }
  return output
}

async function extractMasked(sourcePath, options) {
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const mask = new Uint8Array(info.width * info.height)
  for (let point = 0; point < mask.length; point++) {
    const offset = point * 4
    if (options.score(data[offset], data[offset + 1], data[offset + 2]) >= options.threshold) mask[point] = 1
  }

  const closed = close(mask, info.width, info.height, options.closeRadius)
  const labelled = components(closed, info.width, info.height)
  const keepLabels = new Set(
    labelled.areas
      .map((area, label) => ({ area, label }))
      .sort((left, right) => right.area - left.area)
      .slice(0, options.keepCount)
      .map((component) => component.label),
  )
  const kept = new Uint8Array(mask.length)
  for (let point = 0; point < kept.length; point++) {
    if (keepLabels.has(labelled.labels[point])) kept[point] = 1
  }
  const filled = fillHoles(kept, info.width, info.height)
  const hardAlpha = Buffer.alloc(filled.length)
  for (let point = 0; point < filled.length; point++) hardAlpha[point] = filled[point] * 255
  const alpha = await sharp(hardAlpha, {
    raw: { width: info.width, height: info.height, channels: 1 },
  }).blur(0.6).raw().toBuffer()

  const output = Buffer.from(data)
  let minColumn = info.width
  let minRow = info.height
  let maxColumn = -1
  let maxRow = -1
  for (let point = 0; point < filled.length; point++) {
    const alphaValue = alpha[point * 3]
    output[point * 4 + 3] = alphaValue
    if (alphaValue <= 12) continue
    const column = point % info.width
    const row = Math.floor(point / info.width)
    minColumn = Math.min(minColumn, column)
    minRow = Math.min(minRow, row)
    maxColumn = Math.max(maxColumn, column)
    maxRow = Math.max(maxRow, row)
  }
  if (maxColumn < 0) throw new Error(`No foreground detected in ${relative(sourcePath)}`)
  const padding = 2
  const left = Math.max(0, minColumn - padding)
  const top = Math.max(0, minRow - padding)
  const right = Math.min(info.width - 1, maxColumn + padding)
  const bottom = Math.min(info.height - 1, maxRow + padding)
  return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer()
}

function newCatalogRecord(target, metadata) {
  return {
    id: target.id,
    name: target.name,
    collection: target.collection,
    category: target.category,
    major: target.category === 'unique' ? 'natural' : target.category,
    subcategory: target.subcategory,
    subLabel: target.collection,
    charmLabel: target.charmLabel,
    tier: 'midi',
    type: 2,
    price: 3,
    src: `/assets/charms/ref/${target.id}.png`,
    pxW: metadata.width,
    pxH: metadata.height,
    widthMm: target.widthMm,
    heightMm: target.heightMm,
    minScale: 0.8,
    maxScale: 1.5,
  }
}

function upsertManifest(manifest, target, metadata) {
  const record = {
    id: target.id,
    src: `${target.id}.png`,
    fromPhoto: `Missing Charms.docx/${target.documentImage}`,
    pxW: metadata.width,
    pxH: metadata.height,
  }
  const index = manifest.pieces.findIndex((piece) => piece.id === target.id)
  if (index >= 0) manifest.pieces[index] = { ...manifest.pieces[index], ...record }
  else manifest.pieces.push(record)
}

async function main() {
  fs.mkdirSync(SOURCE_CROP_DIR, { recursive: true })
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const byId = new Map(catalog.charms.map((charm) => [charm.id, charm]))
  const report = []

  for (const target of TARGETS) {
    const referencePath = path.join(REFERENCE_DIR, target.documentImage)
    const reference = fs.readFileSync(referencePath)
    const applied = APPLY || (APPLY_METALS && METAL_EDGE_TARGETS.has(target.id))
    let output
    let metadata

    if (target.existing) {
      const piecePath = path.join(PIECE_DIR, `${target.id}.png`)
      const publicPath = path.join(PUBLIC_DIR, `${target.id}.png`)
      const piece = fs.readFileSync(piecePath)
      const publicCopy = fs.readFileSync(publicPath)
      if (!piece.equals(publicCopy)) throw new Error(`${target.id}: local mirrors differ`)
      output = piece
      metadata = await sharp(output).metadata()
      if (applied) {
        const record = byId.get(target.id)
        if (!record) throw new Error(`${target.id}: catalogue record not found`)
        record.widthMm = target.widthMm
        record.heightMm = target.heightMm
      }
    } else {
      output = await target.build()
      metadata = await sharp(output).metadata()
      const outputPath = path.join(OUTPUT_DIR, `${target.id}.png`)
      fs.writeFileSync(outputPath, output)
      if (applied) {
        fs.writeFileSync(path.join(PIECE_DIR, `${target.id}.png`), output)
        fs.writeFileSync(path.join(PUBLIC_DIR, `${target.id}.png`), output)
        const existing = byId.get(target.id)
        const next = newCatalogRecord(target, metadata)
        if (existing) Object.assign(existing, next)
        else {
          catalog.charms.push(next)
          byId.set(target.id, next)
        }
        upsertManifest(manifest, target, metadata)
      }
    }

    report.push({
      documentImage: target.documentImage,
      documentReferenceSha256: sha256(reference),
      id: target.id,
      name: target.name,
      method: target.method,
      sizeBasis: target.sizeBasis,
      output: target.existing
        ? `public/assets/charms/ref/${target.id}.png`
        : relative(path.join(OUTPUT_DIR, `${target.id}.png`)),
      sha256: sha256(output),
      width: metadata.width,
      height: metadata.height,
      widthMm: target.widthMm,
      heightMm: target.heightMm,
      existingArtwork: !!target.existing,
      applied,
    })
  }

  if (APPLY) {
    manifest.count = manifest.pieces.length
    fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`)
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!APPLY && !APPLY_METALS) {
    console.log('\nGenerated staging artwork and metadata proposals only. Re-run with --apply after visual QA.')
  }
}

main()