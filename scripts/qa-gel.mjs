// Quick automated QA for with-gel renders: sample the gel-slab region brightness
// so gross failures (a finish that didn't get the gel, or wrong colour) are caught
// without opening every image. Black gel should be dark (lum<70); white/glitter
// light (lum>190).
// Usage: node scripts/qa-gel.mjs <id> [<id> ...]
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(__dirname, '..', 'public', 'assets', 'cases', 'case-with-gel')

async function lumOf(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let r = 0, g = 0, b = 0, n = 0
  for (let y = Math.floor(H * 0.55); y < Math.floor(H * 0.85); y++)
    for (let x = Math.floor(W * 0.35); x < Math.floor(W * 0.65); x++) {
      const i = (y * W + x) * C
      if (data[i + 3] < 128) continue
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
  return { lum: Math.round((r + g + b) / (3 * n)), rgb: [r, g, b].map((v) => Math.round(v / n)) }
}

const EXPECT = { black: [0, 70], white: [190, 255], glitter: [185, 255] }
const ids = process.argv.slice(2)
let bad = 0
for (const id of ids) {
  for (const fin of ['black', 'white', 'glitter']) {
    const p = path.join(DIR, `integrated-${id}-${fin}.png`)
    try {
      const { lum, rgb } = await lumOf(p)
      const [lo, hi] = EXPECT[fin]
      const ok = lum >= lo && lum <= hi
      if (!ok) bad++
      console.log(`${(id + ' ' + fin).padEnd(26)} lum=${String(lum).padStart(3)} rgb=(${rgb}) ${ok ? 'OK' : '  <-- CHECK'}`)
    } catch (e) {
      console.log(`${(id + ' ' + fin).padEnd(26)} MISSING`)
      bad++
    }
  }
}
process.exit(bad ? 1 : 0)
