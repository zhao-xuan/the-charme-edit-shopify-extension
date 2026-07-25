/**
 * crop-authored-shots.mjs
 * -------------------------------------------------------------------------
 * Post-processes the full-page customizer screenshots saved by the Playwright
 * render loop (reference/_authored-shots/_fp_<base>.png). For each one it
 * detects the BLACK iPhone case bounding box (dark pixels on the cream app
 * background — getBoundingClientRect coords are unreliable in the embedded
 * browser) and crops it to reference/_authored-shots/<base>.png.
 *
 * Run: node scripts/crop-authored-shots.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIR = join(__dirname, '..', 'reference', '_authored-shots')

async function caseBBox(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let minx = W,
    miny = H,
    maxx = 0,
    maxy = 0,
    n = 0
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * C
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 90) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
        n++
      }
    }
  }
  return { minx, miny, maxx, maxy, n, W, H }
}

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.startsWith('_fp_') && f.endsWith('.png'))
  if (!files.length) {
    console.log('no _fp_*.png screenshots found — run the Playwright render loop first') // eslint-disable-line
    return
  }
  for (const f of files) {
    const base = f.replace(/^_fp_/, '').replace(/\.png$/, '')
    const bb = await caseBBox(join(DIR, f))
    if (bb.n < 50) {
      console.log(`SKIP ${base}: no case detected`) // eslint-disable-line
      continue
    }
    const pad = 14
    const left = Math.max(0, bb.minx - pad)
    const top = Math.max(0, bb.miny - pad)
    const width = Math.min(bb.W - left, bb.maxx - bb.minx + pad * 2)
    const height = Math.min(bb.H - top, bb.maxy - bb.miny + pad * 2)
    await sharp(join(DIR, f)).extract({ left, top, width, height }).toFile(join(DIR, `${base}.png`))
    console.log(`${base}: crop ${width}x${height}`) // eslint-disable-line
  }
  console.log('\ndone') // eslint-disable-line
}

main()
