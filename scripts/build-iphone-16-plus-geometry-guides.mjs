import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const referencesDir = 'reference/case-history/generated/black-white-glitter-shape-trials/references'
const canonicalGuide = 'reference/case-history/references/gpt-iphone-16-plus-closed-gel-path.png'
const plusWhiteSource = `${referencesDir}/trial-iphone-16-plus-white-source.png`
const plusBlackSource = `${referencesDir}/trial-iphone-16-plus-black-source.png`
const plusBlackGuide = `${referencesDir}/trial-iphone-16-plus-black-glitter-shape-guide.png`
const shouldWrite = process.argv.includes('--write')
const opaqueInterior = process.argv.includes('--opaque-interior')

const targets = [
  {
    finish: 'black',
    sourcePath: `${referencesDir}/trial-iphone-16-black-source.png`,
    outputPath: `${referencesDir}/trial-iphone-16-black-plus-glitter-shape-guide.png`,
  },
  {
    finish: 'white',
    sourcePath: `${referencesDir}/trial-iphone-16-white-source.png`,
    outputPath: `${referencesDir}/trial-iphone-16-white-plus-glitter-shape-guide.png`,
  },
  {
    finish: 'glitter',
    sourcePath: `${referencesDir}/trial-iphone-16-accepted-glitter-geometry.png`,
    outputPath: `${referencesDir}/trial-iphone-16-glitter-plus-glitter-shape-guide.png`,
  },
]

if (opaqueInterior) {
  targets.push(
    {
      finish: 'plus-black',
      sourcePath: plusBlackSource,
      outputPath: `${referencesDir}/trial-iphone-16-plus-black-logo-safe-shape-guide.png`,
    },
    {
      finish: 'plus-white',
      sourcePath: plusWhiteSource,
      outputPath: `${referencesDir}/trial-iphone-16-plus-white-logo-safe-shape-guide.png`,
    },
  )
  for (const target of targets.slice(0, 3)) {
    target.outputPath = target.outputPath.replace('-shape-guide.png', '-logo-safe-shape-guide.png')
  }
}

async function rgba(filePath) {
  return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function subjectBounds(filePath) {
  const { data, info } = await rgba(filePath)
  const alphaHasBackground = Array.from({ length: info.width * info.height }, (_, index) => data[index * 4 + 3])
    .some((alpha) => alpha <= 40)
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4
    const isSubject = alphaHasBackground
      ? data[offset + 3] > 40
      : Math.min(data[offset], data[offset + 1], data[offset + 2]) < 246
    if (!isSubject) continue
    const x = index % info.width
    const y = Math.floor(index / info.width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left || bottom < top) throw new Error(`No visible subject in ${filePath}`)
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

async function guideOverlay() {
  const [guide, source] = await Promise.all([rgba(canonicalGuide), rgba(plusWhiteSource)])
  if (guide.info.width !== source.info.width || guide.info.height !== source.info.height) {
    throw new Error('Canonical guide and iPhone 16 Plus White source dimensions differ')
  }
  const overlay = Buffer.alloc(guide.data.length)
  for (let offset = 0; offset < guide.data.length; offset += 4) {
    const difference = Math.max(
      Math.abs(guide.data[offset] - source.data[offset]),
      Math.abs(guide.data[offset + 1] - source.data[offset + 1]),
      Math.abs(guide.data[offset + 2] - source.data[offset + 2]),
    )
    if (difference < 4 || guide.data[offset] <= guide.data[offset + 1]) continue
    overlay[offset] = 255
    overlay[offset + 1] = 55
    overlay[offset + 2] = 70
    overlay[offset + 3] = opaqueInterior ? 255 : Math.max(28, Math.min(230, difference * 3))
  }
  return { overlay, info: guide.info }
}

async function remapGuide(targetSourcePath) {
  const [sourceBounds, targetBounds, source, overlay] = await Promise.all([
    subjectBounds(plusWhiteSource),
    subjectBounds(targetSourcePath),
    readFile(targetSourcePath),
    guideOverlay(),
  ])
  const registeredOverlay = await sharp(overlay.overlay, {
    raw: { width: overlay.info.width, height: overlay.info.height, channels: 4 },
  })
    .extract(sourceBounds)
    .resize(targetBounds.width, targetBounds.height, { fit: 'fill' })
    .png()
    .toBuffer()
  return sharp(source)
    .composite([{ input: registeredOverlay, left: targetBounds.left, top: targetBounds.top }])
    .png()
    .toBuffer()
}

async function guideDifference(actual, expectedPath, sourcePath) {
  const [left, right, source] = await Promise.all([
    sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    rgba(expectedPath),
    rgba(sourcePath),
  ])
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
    throw new Error('Regression guide dimensions differ')
  }
  let changed = 0
  let absoluteDifference = 0
  let actualCoverage = 0
  let expectedCoverage = 0
  let intersection = 0
  let union = 0
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let actualSourceDifference = 0
    let expectedSourceDifference = 0
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(left.data[offset + channel] - right.data[offset + channel])
      absoluteDifference += difference
      if (difference > 3) changed += 1
      if (channel < 3) {
        actualSourceDifference = Math.max(
          actualSourceDifference,
          Math.abs(left.data[offset + channel] - source.data[offset + channel]),
        )
        expectedSourceDifference = Math.max(
          expectedSourceDifference,
          Math.abs(right.data[offset + channel] - source.data[offset + channel]),
        )
      }
    }
    const actualChanged = actualSourceDifference > 3
    const expectedChanged = expectedSourceDifference > 3
    if (actualChanged) actualCoverage += 1
    if (expectedChanged) expectedCoverage += 1
    if (actualChanged && expectedChanged) intersection += 1
    if (actualChanged || expectedChanged) union += 1
  }
  const pixelCount = left.info.width * left.info.height
  return {
    changedChannelShare: changed / left.data.length,
    meanAbsoluteDifference: absoluteDifference / left.data.length,
    geometryIntersectionOverUnion: intersection / union,
    actualCoverageShare: actualCoverage / pixelCount,
    expectedCoverageShare: expectedCoverage / pixelCount,
  }
}

const regression = await guideDifference(await remapGuide(plusBlackSource), plusBlackGuide, plusBlackSource)
if (regression.geometryIntersectionOverUnion < 0.96) {
  throw new Error(`Guide remap regression failed: ${JSON.stringify(regression)}`)
}

async function writeImmutable(filePath, bytes) {
  try {
    await writeFile(filePath, bytes, { flag: 'wx' })
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = await readFile(filePath)
    if (!existing.equals(bytes)) throw new Error(`${filePath} already exists with different bytes`)
    return false
  }
}

const outputs = []
for (const target of targets) {
  const bytes = await remapGuide(target.sourcePath)
  let written = false
  if (shouldWrite) {
    await mkdir(path.dirname(target.outputPath), { recursive: true })
    written = await writeImmutable(target.outputPath, bytes)
  }
  const metadata = await sharp(bytes).metadata()
  outputs.push({
    finish: target.finish,
    outputPath: target.outputPath,
    widthPx: metadata.width,
    heightPx: metadata.height,
    bytes: bytes.length,
    written,
  })
}

console.log(JSON.stringify({ regression, wrote: shouldWrite, outputs }, null, 2))