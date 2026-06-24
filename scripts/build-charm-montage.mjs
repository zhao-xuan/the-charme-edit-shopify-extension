/**
 * build-charm-montage.mjs
 * -------------------------------------------------------------------------
 * Builds labelled contact-sheet montages of the individual charm cut-outs in
 * reference/3-charms-each-piece so they can be eyeballed and categorised.
 *
 *  - Pieces are grouped by their source collage photo (fromPhoto) because each
 *    collage tends to hold a coherent family (e.g. a sheet of gold letters).
 *  - Each cell shows the cut-out, a sequential cell number, the measured pixel
 *    size, and a colour-coded border from a cheap colour heuristic
 *    (gold / silver / colourful / natural) so visual correction is fast.
 *  - A legend (cell -> piece id) + per-piece colour features are written to
 *    reference/_montage/ for the rebuild step.
 *
 * Run:  node scripts/build-charm-montage.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIR = join(ROOT, 'reference', '3-charms-each-piece')
const OUT = join(ROOT, 'reference', '_montage')

const CELL = 168          // cell size (px)
const PAD = 10            // image padding inside cell
const LABEL_H = 26        // label strip height
const COLS = 8
const IMG = CELL - PAD * 2 // image area

const MAJOR_COLOR = {
  gold: '#caa12a',
  silver: '#8a8f96',
  colourful: '#d2453d',
  natural: '#4f9d69',
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  const d = max - min
  if (d > 0.0001) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

async function analyze(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let n = 0, sR = 0, sG = 0, sB = 0, sS = 0, sL = 0
  let gold = 0, grey = 0, sat = 0
  const hueHist = new Array(12).fill(0)
  for (let i = 0; i < width * height; i++) {
    const a = data[i * channels + 3]
    if (a < 140) continue
    const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2]
    n++
    sR += r; sG += g; sB += b
    const [h, s, l] = rgbToHsl(r, g, b)
    sS += s; sL += l
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const isGrey = (mx - mn) < 22
    if (isGrey) grey++
    else { sat++; hueHist[Math.floor(h / 30) % 12]++ }
    // golden: warm, red>=green>blue, mid lightness
    if (r >= g && g >= b && (r - b) > 26 && l > 0.18 && l < 0.9) gold++
  }
  if (!n) return { major: 'colourful', meanS: 0, meanL: 0, warm: 0, goldFrac: 0, greyFrac: 0, n: 0 }
  const meanR = sR / n, meanG = sG / n, meanB = sB / n
  const meanS = sS / n, meanL = sL / n
  const warm = meanR - meanB
  const goldFrac = gold / n, greyFrac = grey / n
  // dominant hue bucket among saturated pixels
  let domHue = -1, domCnt = 0
  hueHist.forEach((c, i) => { if (c > domCnt) { domCnt = c; domHue = i * 30 } })
  let major
  if (goldFrac > 0.45 && warm > 14) major = 'gold'
  else if (greyFrac > 0.62 && warm < 16 && meanS < 0.16) major = 'silver'
  else if (meanS > 0.28 && (sat / n) > 0.35) major = 'colourful'
  else if (meanS < 0.2 && meanL > 0.55) major = 'natural'
  else if (warm > 24) major = 'gold'
  else if (greyFrac > 0.5) major = 'silver'
  else major = 'colourful'
  return {
    major, meanS: +meanS.toFixed(3), meanL: +meanL.toFixed(3), warm: +warm.toFixed(1),
    goldFrac: +goldFrac.toFixed(3), greyFrac: +greyFrac.toFixed(3),
    domHue, meanRGB: [Math.round(meanR), Math.round(meanG), Math.round(meanB)], n,
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  const manifest = JSON.parse(await readFile(join(DIR, 'manifest.json'), 'utf8'))
  const groups = new Map()
  for (const p of manifest.pieces) {
    if (!groups.has(p.fromPhoto)) groups.set(p.fromPhoto, [])
    groups.get(p.fromPhoto).push(p)
  }
  const legend = {}
  const features = {}
  const photoKeys = [...groups.keys()].sort()
  let sheetIdx = 0
  for (const photo of photoKeys) {
    const pieces = groups.get(photo)
    const rows = Math.ceil(pieces.length / COLS)
    const W = COLS * CELL
    const H = rows * (CELL + LABEL_H)
    const base = sharp({ create: { width: W, height: H, channels: 4, background: '#f2f2f0' } })
    const composites = []
    const svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`]
    const sheetName = `sheet${String(sheetIdx + 1).padStart(2, '0')}-${photo.replace(/\.[^.]+$/, '')}`
    legend[sheetName] = []
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]
      const col = i % COLS, row = Math.floor(i / COLS)
      const cx = col * CELL, cy = row * (CELL + LABEL_H)
      const buf = await readFile(join(DIR, p.src))
      const feat = await analyze(buf)
      features[p.id] = feat
      const resized = await sharp(buf)
        .resize(IMG, IMG, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toBuffer()
      const meta = await sharp(resized).metadata()
      const offx = cx + PAD + Math.round((IMG - meta.width) / 2)
      const offy = cy + PAD + Math.round((IMG - meta.height) / 2)
      composites.push({ input: resized, left: offx, top: offy })
      const bc = MAJOR_COLOR[feat.major]
      // cell border (colour-coded by heuristic major)
      svgParts.push(`<rect x="${cx + 1}" y="${cy + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="none" stroke="${bc}" stroke-width="4"/>`)
      // cell number badge
      svgParts.push(`<rect x="${cx + 3}" y="${cy + 3}" width="34" height="20" fill="${bc}"/>`)
      svgParts.push(`<text x="${cx + 6}" y="${cy + 18}" font-family="Arial" font-size="15" font-weight="bold" fill="#fff">${i + 1}</text>`)
      // label strip: size + heuristic
      const ly = cy + CELL + 18
      svgParts.push(`<text x="${cx + 5}" y="${ly}" font-family="Arial" font-size="13" fill="#222">${p.pxW}x${p.pxH} ${feat.major[0].toUpperCase()}</text>`)
      legend[sheetName].push({ cell: i + 1, id: p.id, src: p.src, pxW: p.pxW, pxH: p.pxH, heuristic: feat.major })
    }
    svgParts.push('</svg>')
    composites.push({ input: Buffer.from(svgParts.join('')), left: 0, top: 0 })
    await base.composite(composites).png().toFile(join(OUT, `${sheetName}.png`))
    console.log(`wrote ${sheetName}.png  (${pieces.length} pieces, ${rows} rows)`) // eslint-disable-line
    sheetIdx++
  }
  await writeFile(join(OUT, 'legend.json'), JSON.stringify(legend, null, 2))
  await writeFile(join(OUT, 'features.json'), JSON.stringify(features, null, 2))
  // heuristic tally
  const tally = {}
  Object.values(features).forEach((f) => { tally[f.major] = (tally[f.major] || 0) + 1 })
  console.log('heuristic majors:', tally) // eslint-disable-line
  console.log(`sheets: ${photoKeys.length}  pieces: ${manifest.pieces.length}`) // eslint-disable-line
}
main()
