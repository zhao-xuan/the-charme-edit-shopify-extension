import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { rekey } from './rekey-broken-charms.mjs'

const ROOT = process.cwd()
const SOURCE_DIR = path.join(ROOT, 'reference/2-charms-extracted')
const PIECE_DIR = path.join(ROOT, 'reference/3-charms-each-piece')
const PUBLIC_DIR = path.join(ROOT, 'public/assets/charms/ref')
const REPAIR_DIR = path.join(ROOT, 'reference/charm-repairs')
const CROP_DIR = path.join(REPAIR_DIR, 'source-crops')
const OUTPUT_DIR = path.join(REPAIR_DIR, 'generated')
const CATALOG_PATH = path.join(ROOT, 'src/data/catalog.json')
const APPLY = process.argv.includes('--apply')
const APPLY_METALS = process.argv.includes('--apply-metals')
const REFRESH_CROPS = process.argv.includes('--refresh-crops')
const DOWNSAMPLE = 4
const CATEGORY_BY_ID = new Map(
  JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')).charms.map((charm) => [charm.id, charm.category]),
)

const TARGETS = [
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-08',
    sheet: 'DDCC0C89-AC31-4ABB-B784-1406F89C9BBB.png',
  },
  {
    id: 'e7e403b5-ce76-47e7-808b-f552fdf2b7e9-32',
    sheet: 'E7E403B5-CE76-47E7-808B-F552FDF2B7E9.png',
  },
  {
    id: '7561dd4b-da89-4f19-a1ff-d75ff5b41698-15',
    sheet: '7561DD4B-DA89-4F19-A1FF-D75FF5B41698.png',
  },
  {
    id: '7561dd4b-da89-4f19-a1ff-d75ff5b41698-03',
    sheet: '7561DD4B-DA89-4F19-A1FF-D75FF5B41698.png',
    documentImage: 'image26.png',
  },
  {
    id: 'silver-21',
    sheet: 'silver.png',
    documentImage: 'image22.png',
  },
  {
    id: 'e7e403b5-ce76-47e7-808b-f552fdf2b7e9-27',
    sheet: 'E7E403B5-CE76-47E7-808B-F552FDF2B7E9.png',
    documentImage: 'image27.png',
  },
  {
    id: 'e7e403b5-ce76-47e7-808b-f552fdf2b7e9-29',
    sheet: 'E7E403B5-CE76-47E7-808B-F552FDF2B7E9.png',
    documentImage: 'image12.png',
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-35',
    sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png',
    documentImage: 'image11.png',
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-50',
    sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png',
    documentImage: 'image14.png',
  },
  {
    id: 'f1552077-9a1d-4e7c-bf0a-000000000abc-07',
    sheet: 'f1552077-9a1d-4e7c-bf0a-000000000abc-07.png',
    documentImage: 'image8.png',
    directSource: true,
  },
  {
    id: 'e540ac60-3ca6-447f-833a-9234eec3b235-10',
    sheet: 'E540AC60-3CA6-447F-833A-9234EEC3B235.png',
    documentImage: 'image15.png',
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-04',
    sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png',
    documentImage: 'image3.png',
    rekeyOpts: { removeNeutralShadow: false },
    apply: false,
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-11',
    sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png',
    documentImage: 'image16.png',
    crop: { left: 1202, top: 230, width: 192, height: 260 },
  },
  {
    id: '2075d4e3-c7dd-4c32-bbd0-38bc5ddfcf9b-03',
    sheet: '2075D4E3-C7DD-4C32-BBD0-38BC5DDFCF9B.png',
    documentImage: 'image17.png',
    solid: false,
  },
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-28',
    sheet: 'DDCC0C89-AC31-4ABB-B784-1406F89C9BBB.png',
    documentImage: 'image23.png',
    solid: false,
    apply: false,
  },
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-01',
    sheet: 'DDCC0C89-AC31-4ABB-B784-1406F89C9BBB.png',
    documentImage: 'image10.png',
    solid: false,
    apply: false,
  },
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-15',
    sheet: 'DDCC0C89-AC31-4ABB-B784-1406F89C9BBB.png',
    documentImage: 'image19.png',
    apply: false,
  },
  {
    id: '52e483c2-c80e-4920-998c-c7bf5aa59b8a-01',
    sheet: '52E483C2-C80E-4920-998C-C7BF5AA59B8A.png',
    documentImage: 'image24.png',
    solid: false,
    apply: false,
  },
  {
    id: 'silver-03',
    sheet: 'silver.png',
    documentImage: 'image7.png',
    apply: false,
  },
  {
    id: 'silver-02',
    sheet: 'silver.png',
    documentImage: 'image18.png',
    solid: false,
  },
  {
    id: 'image2-02',
    sheet: 'image2.png',
    documentImage: 'image9.png',
    apply: false,
  },
  {
    id: 'image2-24',
    sheet: 'image2.png',
    documentImage: 'image20.png',
    apply: false,
  },
  {
    id: 'image2-20',
    sheet: 'image2.png',
    documentImage: 'image25.png',
  },
  {
    id: 'image2-22',
    sheet: 'image2.png',
    documentImage: 'image25.png',
  },
  {
    id: 'ddcc0c89-ac31-4abb-b784-1406f89c9bbb-02',
    sheet: 'DDCC0C89-AC31-4ABB-B784-1406F89C9BBB.png',
    documentImage: 'image13.png',
    solid: false,
  },
]

const distanceFromWhite = (red, green, blue) => {
  const dr = 255 - red
  const dg = 255 - green
  const db = 255 - blue
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

async function inkMap(input) {
  const { data, info } = await sharp(input)
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const sourceWidth = info.width
  const sourceHeight = info.height
    const width = Math.max(1, Math.floor(sourceWidth / DOWNSAMPLE))
  const height = Math.max(1, Math.floor(sourceHeight / DOWNSAMPLE))
  const ink = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0
      let count = 0
      for (let dy = 0; dy < DOWNSAMPLE; dy++) {
        for (let dx = 0; dx < DOWNSAMPLE; dx++) {
          const sourceX = x * DOWNSAMPLE + dx
          const sourceY = y * DOWNSAMPLE + dy
          if (sourceX >= sourceWidth || sourceY >= sourceHeight) continue
          const offset = (sourceY * sourceWidth + sourceX) * info.channels
           total += distanceFromWhite(data[offset], data[offset + 1], data[offset + 2])
          count++
        }
      }
      ink[y * width + x] = total / count
    }
  }

  return { ink, width, height, sourceWidth, sourceHeight }
}

function trimInk(source) {
  let minX = source.width
  let minY = source.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.ink[y * source.width + x] <= 18) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0) throw new Error('Template contains no visible artwork')
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const ink = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ink[y * width + x] = source.ink[(y + minY) * source.width + x + minX]
    }
  }
  return { ink, width, height }
}

function matchTemplate(sheet, template) {
  let weight = 0
  for (const value of template.ink) weight += value
  let bestScore = Infinity
  let bestX = 0
  let bestY = 0

  for (let offsetY = 0; offsetY + template.height <= sheet.height; offsetY++) {
    for (let offsetX = 0; offsetX + template.width <= sheet.width; offsetX++) {
      let difference = 0
      for (let y = 0; y < template.height; y++) {
        const sheetRow = (offsetY + y) * sheet.width + offsetX
        const templateRow = y * template.width
        for (let x = 0; x < template.width; x++) {
          const expected = template.ink[templateRow + x]
          difference += expected * Math.abs(sheet.ink[sheetRow + x] - expected)
        }
        if (difference >= bestScore * weight) {
          difference = Infinity
          break
        }
      }
      if (difference < bestScore * weight) {
        bestScore = difference / weight
        bestX = offsetX
        bestY = offsetY
      }
    }
  }

  return {
    x: bestX * DOWNSAMPLE,
    y: bestY * DOWNSAMPLE,
    width: template.width * DOWNSAMPLE,
    height: template.height * DOWNSAMPLE,
    score: bestScore,
  }
}

async function repair(target) {
  const sheetPath = path.join(SOURCE_DIR, target.sheet)
  const currentPath = path.join(PIECE_DIR, `${target.id}.png`)
  const cropPath = path.join(CROP_DIR, `${target.id}.png`)
  const outputPath = path.join(OUTPUT_DIR, `${target.id}.png`)
  let match = null
  const sourceCropReused = !target.crop && !REFRESH_CROPS && fs.existsSync(cropPath)

  if (!sourceCropReused) {
    if (target.crop) {
      await sharp(sheetPath).extract(target.crop).png().toFile(cropPath)
    } else if (target.directSource) {
      await sharp(sheetPath).png().toFile(cropPath)
    } else {
      const sheet = await inkMap(sheetPath)
      const current = await inkMap(currentPath)
      match = matchTemplate(sheet, trimInk(current))
      const padding = typeof target.padding === 'number'
        ? { top: target.padding, right: target.padding, bottom: target.padding, left: target.padding }
        : target.padding || { top: 14, right: 14, bottom: 14, left: 14 }
      const left = Math.max(0, match.x - padding.left)
      const top = Math.max(0, match.y - padding.top)
      const width = Math.min(sheet.sourceWidth - left, match.width + padding.left + padding.right)
      const height = Math.min(sheet.sourceHeight - top, match.height + padding.top + padding.bottom)
      await sharp(sheetPath).extract({ left, top, width, height }).png().toFile(cropPath)
    }
  }
  const cropRelative = path.relative(ROOT, cropPath)
  const category = CATEGORY_BY_ID.get(target.id)
  const edgeMode = category === 'gold' || category === 'silver' ? category : undefined
  const metalDefaults = edgeMode
    ? { edgeAwareBackground: true, removeNeutralShadow: true, maxShadowChroma: edgeMode === 'gold' ? 12 : 8 }
    : {}
  const repaired = await rekey(
    target.id,
    cropRelative,
    target.solid ?? true,
    { ...metalDefaults, ...target.rekeyOpts, edgeMode },
  )
  const currentMeta = await sharp(currentPath).metadata()
  const normalized = await sharp(repaired.buf)
    .resize(currentMeta.width, currentMeta.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
  fs.writeFileSync(outputPath, normalized)

  const applied = (APPLY || (APPLY_METALS && Boolean(edgeMode))) && target.apply !== false
  if (applied) {
    fs.writeFileSync(currentPath, normalized)
    fs.writeFileSync(path.join(PUBLIC_DIR, `${target.id}.png`), normalized)
  }

  return {
    id: target.id,
    documentImage: target.documentImage || null,
    source: target.sheet,
    sourceCrop: path.relative(ROOT, cropPath),
    sourceCropReused,
    match: match
      ? {
          x: match.x,
          y: match.y,
          width: match.width,
          height: match.height,
          score: Number(match.score.toFixed(2)),
        }
      : null,
    output: path.relative(ROOT, outputPath),
    sha256: crypto.createHash('sha256').update(normalized).digest('hex'),
    dimensions: `${currentMeta.width}x${currentMeta.height}`,
    applied,
  }
}

async function main() {
  fs.mkdirSync(CROP_DIR, { recursive: true })
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const report = []
  for (const target of TARGETS) report.push(await repair(target))
  fs.writeFileSync(path.join(REPAIR_DIR, 'solid-repair-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  if (!APPLY && !APPLY_METALS) {
    console.log('\nGenerated staging artwork only. Re-run with --apply after visual QA.')
  }
}

main()