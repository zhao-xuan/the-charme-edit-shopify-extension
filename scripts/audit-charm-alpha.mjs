#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const args = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1]
}

const catalogPath = valueAfter('--catalog', '/tmp/charme-production-audit/catalog.json')
const imageDir = valueAfter('--images', '/tmp/charme-production-audit/images')
const outputPath = valueAfter('--output', '/tmp/charme-production-audit/alpha-audit.json')

function components(mask, width, height, value) {
  const seen = new Uint8Array(width * height)
  const found = []
  const stack = []

  for (let start = 0; start < mask.length; start++) {
    if (seen[start] || mask[start] !== value) continue
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
        if (next < 0 || next >= mask.length || seen[next] || mask[next] !== value) continue
        if (Math.abs((next % width) - x) > 1) continue
        seen[next] = 1
        stack.push(next)
      }
    }

    found.push({ area, touchesEdge })
  }

  return found.sort((left, right) => right.area - left.area)
}

async function analyseCharm(charm) {
  const file = path.join(imageDir, `${charm.id}.png`)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const mask = new Uint8Array(width * height)
  let visiblePixels = 0

  for (let point = 0; point < mask.length; point++) {
    if (data[point * channels + 3] < 32) continue
    mask[point] = 1
    visiblePixels++
  }

  const foreground = components(mask, width, height, 1)
  const mainArea = foreground[0]?.area || 0
  const holes = components(mask, width, height, 0).filter(
    (component) => !component.touchesEdge && component.area >= Math.max(4, mainArea * 0.0015),
  )
  const extras = foreground.slice(1).filter(
    (component) => component.area >= Math.max(4, mainArea * 0.002),
  )

  return {
    id: charm.id,
    name: charm.name,
    category: charm.category,
    src: charm.src,
    width,
    height,
    visibleRatio: Number((visiblePixels / (width * height)).toFixed(4)),
    mainArea,
    holeCount: holes.length,
    holeArea: holes.reduce((total, hole) => total + hole.area, 0),
    holeRatio: Number((holes.reduce((total, hole) => total + hole.area, 0) / (mainArea || 1)).toFixed(4)),
    extraComponentCount: extras.length,
  }
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const charms = Array.isArray(catalog) ? catalog : catalog.charms || []
const results = []

for (const charm of charms) results.push(await analyseCharm(charm))

const suspects = results
  .filter(
    (result) =>
      result.holeCount ||
      result.extraComponentCount ||
      result.visibleRatio < 0.08 ||
      result.visibleRatio > 0.93,
  )
  .sort(
    (left, right) =>
      right.holeRatio + right.extraComponentCount * 0.2 -
      (left.holeRatio + left.extraComponentCount * 0.2),
  )

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(
  outputPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, suspects }, null, 2)}\n`,
)

console.log(`Audited ${results.length} charms; ${suspects.length} topology suspects -> ${outputPath}`)