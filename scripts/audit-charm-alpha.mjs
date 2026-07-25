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

const luminance = (red, green, blue) => 0.299 * red + 0.587 * green + 0.114 * blue
const chroma = (red, green, blue) => Math.max(red, green, blue) - Math.min(red, green, blue)

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
  const alpha = new Uint8Array(width * height)
  let visiblePixels = 0

  for (let point = 0; point < mask.length; point++) {
    alpha[point] = data[point * channels + 3]
    if (alpha[point] < 32) continue
    mask[point] = 1
    visiblePixels++
  }

  let outerEdgePixels = 0
  let fringePixels = 0
  let whiteFringePixels = 0
  let neutralFringePixels = 0
  let neutralSolidEdgePixels = 0
  let warmEdgePixels = 0
  for (let point = 0; point < alpha.length; point++) {
    if (alpha[point] < 8) continue
    const x = point % width
    const y = Math.floor(point / width)
    let isOuterEdge = false
    for (let offsetY = -2; offsetY <= 2 && !isOuterEdge; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const nextX = x + offsetX
        const nextY = y + offsetY
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          isOuterEdge = true
          break
        }
        if (alpha[nextY * width + nextX] < 8) {
          isOuterEdge = true
          break
        }
      }
    }
    if (!isOuterEdge) continue

    outerEdgePixels++
    const offset = point * channels
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const lightness = luminance(red, green, blue)
    const colourRange = chroma(red, green, blue)
    if (red - blue >= 12) warmEdgePixels++
    if (alpha[point] >= 224 && colourRange <= 22 && lightness >= 95) {
      neutralSolidEdgePixels++
    }
    if (alpha[point] >= 248) continue

    fringePixels++
    if (colourRange <= 28 && lightness >= 220) whiteFringePixels++
    if (colourRange <= 22 && lightness >= 110) neutralFringePixels++
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
    edge: {
      outerPixels: outerEdgePixels,
      fringePixels,
      whiteFringePixels,
      whiteFringeRatio: Number((whiteFringePixels / (fringePixels || 1)).toFixed(4)),
      whiteFringeCoverage: Number((whiteFringePixels / (visiblePixels || 1)).toFixed(4)),
      neutralFringePixels,
      neutralFringeRatio: Number((neutralFringePixels / (fringePixels || 1)).toFixed(4)),
      neutralSolidRatio: Number((neutralSolidEdgePixels / (outerEdgePixels || 1)).toFixed(4)),
      warmRatio: Number((warmEdgePixels / (outerEdgePixels || 1)).toFixed(4)),
    },
  }
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const charms = Array.isArray(catalog) ? catalog : catalog.charms || []
const results = []

for (const charm of charms) results.push(await analyseCharm(charm))

const topologySuspects = results
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

const edgeSuspects = results
  .filter(
    (result) =>
      result.edge.whiteFringePixels >= 8 &&
      (result.edge.whiteFringeRatio >= 0.3 || result.edge.whiteFringeCoverage >= 0.01),
  )
  .sort(
    (left, right) =>
      right.edge.whiteFringeCoverage - left.edge.whiteFringeCoverage ||
      right.edge.whiteFringeRatio - left.edge.whiteFringeRatio,
  )

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(
  outputPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: results.length,
    topologySuspects,
    edgeSuspects,
    results,
  }, null, 2)}\n`,
)

console.log(
  `Audited ${results.length} charms; ${topologySuspects.length} topology suspects; ` +
  `${edgeSuspects.length} white-edge suspects -> ${outputPath}`,
)