/**
 * verify-precise-shots.mjs
 * -------------------------------------------------------------------------
 * For each full-page render (_fp_<base>.png) saved by the Playwright loop:
 *   1. detect the black case bbox, crop it -> reference/_authored-shots/<base>.png
 *   2. overlay the EXACT piece boxes from pieces-tracking.json (same fractions
 *      used to place the charms) on the crop
 *   3. write a side-by-side _verify_<base>.png : LEFT = real 5-pieces-bordered
 *      photo, RIGHT = my render + the same boxes — so alignment is obvious.
 *
 * Run: node scripts/verify-precise-shots.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, readdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIR = join(ROOT, 'reference', '_authored-shots')
const BORDER = join(ROOT, 'reference', '5-pieces-bordered')

const exists = async (p) => {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function caseBBox(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let minx = W, miny = H, maxx = 0, maxy = 0
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * C
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 90) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
      }
    }
  }
  return { minx, miny, maxx, maxy, n: maxx - minx, W, H }
}

async function main() {
  const tracking = JSON.parse(await readFile(join(ROOT, 'reference', 'pieces-tracking.json'), 'utf8'))
  const photoMeta = new Map(tracking.photos.map((p) => [p.photo, p]))
  const byPhoto = new Map()
  for (const p of tracking.pieces) {
    if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, [])
    byPhoto.get(p.photo).push(p)
  }

  const files = (await readdir(DIR)).filter((f) => f.startsWith('_fp_') && f.endsWith('.png'))
  for (const f of files) {
    const base = f.replace(/^_fp_/, '').replace(/\.png$/, '')
    const photo = base + '.jpg'
    const meta = photoMeta.get(photo)
    const pieces = byPhoto.get(photo)
    if (!meta || !meta.caseBoxPx) continue
    const b = meta.caseBoxPx

    const bb = await caseBBox(join(DIR, f))
    const pad = 14
    const L = Math.max(0, bb.minx - pad), T = Math.max(0, bb.miny - pad)
    const cw = Math.min(bb.W - L, bb.maxx - bb.minx + pad * 2)
    const ch = Math.min(bb.H - T, bb.maxy - bb.miny + pad * 2)
    await sharp(join(DIR, f)).extract({ left: L, top: T, width: cw, height: ch }).toFile(join(DIR, `${base}.png`))

    // overlay boxes on a height-1100 copy of my render
    const myCrop = await sharp(join(DIR, `${base}.png`)).resize({ height: 1100 }).png().toBuffer()
    const mm = await sharp(myCrop).metadata()
    let rects = ''
    for (const p of pieces) {
      const fx = (p.pixelBox.x - b.minx) / b.w
      const fy = (p.pixelBox.y - b.miny) / b.h
      const fw = p.pixelBox.w / b.w
      const fh = p.pixelBox.h / b.h
      const x = fx * mm.width, y = fy * mm.height, rw = fw * mm.width, rh = fh * mm.height
      rects += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${rw.toFixed(0)}" height="${rh.toFixed(0)}" fill="none" stroke="#1d9bf0" stroke-width="2.5"/>`
      rects += `<text x="${(x + 1).toFixed(0)}" y="${(y - 2).toFixed(0)}" font-size="16" fill="#1d9bf0" font-family="sans-serif" font-weight="bold">${p.id}</text>`
    }
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${mm.width}" height="${mm.height}">${rects}</svg>`)
    const myAnnot = await sharp(myCrop).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer()

    const borderPath = join(BORDER, photo)
    if (await exists(borderPath)) {
      const real = await sharp(borderPath).resize({ height: 1100 }).png().toBuffer()
      const rM = await sharp(real).metadata()
      const gap = 28
      await sharp({ create: { width: rM.width + gap + mm.width, height: 1100, channels: 4, background: '#ffffff' } })
        .composite([{ input: real, left: 0, top: 0 }, { input: myAnnot, left: rM.width + gap, top: 0 }])
        .png()
        .toFile(join(DIR, `_verify_${base}.png`))
    }
    console.log(`${base}: crop ${cw}x${ch}`) // eslint-disable-line
  }
  console.log('\ndone') // eslint-disable-line
}

main()
