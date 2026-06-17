/**
 * process-glitter.mjs
 * -------------------------------------------------------------------------
 * Generates ONE reusable glitter-gel overlay texture used to give the real
 * Apple case PHOTOS a "Glitter gel" finish at render time (the flat product
 * photos have no sparkle of their own). A single texture works on both black
 * and white silicone: bright-white specks read on dark cases, soft-dark specks
 * frost light cases — composited with plain alpha (no per-colour blend mode).
 *
 * The texture is masked to each case's own silhouette at render time (CSS mask
 * in the live preview, canvas destination-in in the export), so sparkle only
 * lands on the silicone, never the transparent corners.
 *
 * Run with:  node scripts/process-glitter.mjs   (re-run to reshuffle sparkle)
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'
const OUT = join(ROOT, 'public', 'assets', 'cases')

// Generous size covering the tallest case (~0.5 aspect); stretched to fit each
// case at render time — random noise hides any non-uniform scaling.
const W = 1100
const H = 2200

function sparkleBuffer(w, h) {
  const data = Buffer.alloc(w * h * 4, 0)
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const o = (y * w + x) * 4
    if (a > data[o + 3]) {
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a
    }
  }
  const dot = (cx, cy, rad, r, g, b, a) => {
    const ri = Math.ceil(rad)
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        const d = Math.hypot(dx, dy)
        if (d > rad) continue
        put(cx + dx, cy + dy, r, g, b, Math.round(a * (1 - d / rad)))
      }
    }
  }
  const n = Math.round((w * h) / 55)
  for (let i = 0; i < n; i++) {
    const cx = (Math.random() * w) | 0
    const cy = (Math.random() * h) | 0
    const big = Math.random() < 0.05
    const rad = big ? 1.4 + Math.random() * 2.2 : 0.7 + Math.random() * 1.1
    const dark = Math.random() < 0.45
    const a = Math.round((big ? 0.75 + Math.random() * 0.25 : 0.32 + Math.random() * 0.5) * 255)
    if (big && !dark) dot(cx, cy, rad * 2.4, 255, 255, 255, Math.round(a * 0.22)) // soft halo
    if (dark) dot(cx, cy, rad, 55, 55, 58, a)
    else dot(cx, cy, rad, 255, 255, 255, a)
  }
  return data
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const png = await sharp(sparkleBuffer(W, H), { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(OUT, 'glitter.png'), png)
  console.log(`Wrote ${W}×${H} glitter overlay (${Math.round(png.length / 1024)} kb) → public/assets/cases/glitter.png`)
}

main().catch((e) => { console.error(e); process.exit(1) })
