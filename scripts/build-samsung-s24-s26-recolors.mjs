#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const CAMPAIGN = 'samsung-s24-s26-recolors-v1'
const ROOT = 'reference/case-history/generated/samsung-s24-s26-recolors'
const ORIGINALS = 'reference/case-history/generated/official-phone-case-crawl/originals'
const MANIFEST_PATH = 'reference/case-history/samsung-s24-s26-recolors.json'

const SOURCES = [
  ['galaxy-s24', 'Galaxy S24', 'black', 'violet', 'galaxy-s24-violet-fdb6c707aaf5.png', 'opaque-recolor'],
  ['galaxy-s24-plus', 'Galaxy S24+', 'black', 'violet', 'galaxy-s24-plus-violet-7c19a5eaf58b.png', 'opaque-recolor'],
  ['galaxy-s24-ultra', 'Galaxy S24 Ultra', 'black', 'violet', 'galaxy-s24-ultra-violet-5df8495468d2.png', 'opaque-recolor'],
  ['galaxy-s25', 'Galaxy S25', 'white', 'blue', 'galaxy-s25-blue-a9e119563669.png', 'opaque-recolor'],
  ['galaxy-s25-plus', 'Galaxy S25+', 'white', 'blue', 'galaxy-s25-plus-blue-7ba60c2ccdfb.png', 'opaque-recolor'],
  ['galaxy-s25-ultra', 'Galaxy S25 Ultra', 'white', 'grey', 'galaxy-s25-ultra-grey-8b092d323527.png', 'opaque-recolor'],
  ['galaxy-s26', 'Galaxy S26', 'black', 'clear', 'galaxy-s26-other-894410e9f2f9.png', 'clear-to-opaque'],
  ['galaxy-s26', 'Galaxy S26', 'white', 'clear', 'galaxy-s26-other-894410e9f2f9.png', 'clear-to-opaque'],
  ['galaxy-s26-plus', 'Galaxy S26+', 'black', 'clear', 'galaxy-s26-plus-other-66698b8a4a9a.png', 'clear-to-opaque'],
  ['galaxy-s26-plus', 'Galaxy S26+', 'white', 'clear', 'galaxy-s26-plus-other-66698b8a4a9a.png', 'clear-to-opaque'],
  ['galaxy-s26-ultra', 'Galaxy S26 Ultra', 'black', 'clear', 'galaxy-s26-ultra-other-7231a0834068.png', 'clear-to-opaque'],
  ['galaxy-s26-ultra', 'Galaxy S26 Ultra', 'white', 'clear', 'galaxy-s26-ultra-other-7231a0834068.png', 'clear-to-opaque'],
]

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function inspect(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    if (data[index * info.channels + 3] < 128) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error(`No visible product in ${filePath}`)
  const visibleBoundsPx = {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  }
  return {
    sha256: sha256(bytes),
    format: metadata.format,
    widthPx: info.width,
    heightPx: info.height,
    visibleBoundsPx,
    visibleAspect: Number((visibleBoundsPx.width / visibleBoundsPx.height).toFixed(6)),
  }
}

function promptFor({ modelName, finish, sourceColour, source, mode }) {
  const target = finish.toUpperCase()
  const materialInstruction = mode === 'clear-to-opaque'
    ? `The current case is clear. Replace only that clear case material with a smooth, fully opaque matte ${target} silicone case. Keep the phone and all camera hardware visible and unchanged.`
    : `Change only the ${sourceColour} silicone case material to smooth matte ${TARGET(finish)} silicone.`
  return `Edit IMAGE 1 and generate exactly ONE new downloadable transparent PNG.

IMAGE 1 is the authoritative straight-on ${modelName} phone-in-case product image. ${materialInstruction}

IDENTITY LOCK: preserve the exact ${modelName} phone, complete outer silhouette, physical width-to-height ratio ${source.visibleAspect}, rounded corners, side buttons, camera opening, lens count, lens positions, flash, sensors, logo, lighting, highlights and framing. Do not redraw, add, remove, move, resize, crop or mirror any hardware or geometry.

COLOUR LOCK: the complete case body must read as neutral ${finish === 'black' ? 'deep black' : 'clean white'} matte silicone. Recolour the case only. Never tint, cover, desaturate or alter the phone, camera glass, lenses, flash, sensors, metal rings or logo. No violet, blue, grey or transparent case material may remain.

ALPHA AND COMPOSITION LOCK: preserve IMAGE 1's transparent canvas and centred, full-product composition. The area outside the product must be genuine alpha 0. No backdrop, checkerboard, floor, shadow, glow, haze, halo, margin colour or extra object. Keep the complete case fully visible and uncropped.

No Gel, resin, charms, pattern, carbon fibre, magnetic ring, decoration, hand, packaging, text, watermark, comparison, grid or explanation. Return exactly ONE image and no prose.`
}

function TARGET(finish) {
  return finish === 'black' ? 'BLACK' : 'WHITE'
}

await mkdir(path.join(ROOT, 'candidates'), { recursive: true })
await mkdir(path.join(ROOT, 'prompts'), { recursive: true })

const targets = []
for (const [modelId, modelName, finish, sourceColour, filename, mode] of SOURCES) {
  const sourcePath = path.join(ORIGINALS, filename)
  const source = await inspect(sourcePath)
  const promptText = promptFor({ modelName, finish, sourceColour, source, mode })
  const key = `${modelId}:${finish}`
  const promptPath = path.join(ROOT, 'prompts', `${modelId}-${finish}.txt`)
  await writeFile(promptPath, `${promptText}\n`)
  targets.push({
    key,
    modelId,
    modelName,
    finish,
    sourceColour,
    mode,
    sourcePath,
    ...source,
    promptPath,
    promptSha256: sha256(`${promptText}\n`),
    candidatePath: path.join(ROOT, 'candidates', `${modelId}-${finish}-v1-gpt.png`),
    status: 'pending',
  })
}

const manifest = {
  schemaVersion: 1,
  campaign: CAMPAIGN,
  publish: false,
  policy: 'Only exact original GPT PNG bytes may be reviewed or published. Never crop, resize, recolour, composite, retouch, re-encode, or attach images to Shopify Product Media or variant media.',
  summary: { targets: targets.length, opaqueRecolors: 6, clearToOpaque: 6 },
  targets,
}
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ manifestPath: MANIFEST_PATH, targets: targets.length }, null, 2))