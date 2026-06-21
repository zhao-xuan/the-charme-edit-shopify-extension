/**
 * crop-five-cases.mjs (one-off)
 * -------------------------------------------------------------------------
 * Cut the 5 black silicone iPhone cases out of a single flat product shot
 * (white background, text labels underneath) into individual tight transparent
 * PNGs that match the existing /assets/cases renders, then derive the pure-white
 * recolour for each (same LUT as process-cases.mjs).
 *
 * Approach:
 *   1. Flood-fill the WHITE background inward from the image borders. Only
 *      border-connected near-white pixels are treated as background, so the
 *      light titanium camera islands (enclosed by dark silicone) are preserved.
 *   2. Connected-component label the foreground; the 5 largest blobs are the
 *      phones. The text labels are tiny separate blobs and drop out automatically.
 *   3. Per phone: build an alpha mask from its component only, erode 1px to kill
 *      the white fringe, feather, compose RGBA, trim tight, save black + white.
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = process.env.SRC || '/Users/tomzhao/Downloads/F44F4262-624B-42A1-B8C5-2A70AEC75BAB.png'
const OUT = join(ROOT, 'public', 'assets', 'cases')

// Phones left → right in the source shot.
const MODELS = ['iphone-air', 'iphone-16-pro', 'iphone-16-plus', 'iphone-16', 'iphone-12-pro']

const WHITE = 225 // luminance above which a border-connected pixel counts as background
const ERODE = 1 // px to shrink the silhouette (removes the anti-aliased white ring)

// Pure-white silicone recolour — identical control points to process-cases.mjs.
const WHITE_PTS = [[0, 120], [16, 168], [30, 226], [48, 246], [66, 255], [255, 255]]
const WHITE_LUT = (() => {
  const f = (l) => {
    for (let i = 1; i < WHITE_PTS.length; i++) {
      const [x0, y0] = WHITE_PTS[i - 1]
      const [x1, y1] = WHITE_PTS[i]
      if (l <= x1) return Math.round(y0 + ((y1 - y0) * (l - x0)) / (x1 - x0))
    }
    return 255
  }
  return Array.from({ length: 256 }, (_, l) => f(l))
})()

async function recolorBlackToWhite(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 8) continue
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    const v = WHITE_LUT[Math.round(lum)]
    data[o] = v
    data[o + 1] = v
    data[o + 2] = Math.round(v * 0.992)
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const lum = (i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]

  // 1. Flood-fill background inward from the borders.
  const bg = new Uint8Array(W * H)
  const stack = []
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    if (!bg[i] && lum(i) > WHITE) {
      bg[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < W; x++) {
    tryPush(x, 0)
    tryPush(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    tryPush(0, y)
    tryPush(W - 1, y)
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    const y = (i / W) | 0
    tryPush(x - 1, y)
    tryPush(x + 1, y)
    tryPush(x, y - 1)
    tryPush(x, y + 1)
  }

  // 2. Connected-component label the foreground (bg === 0), 8-connectivity.
  const label = new Int32Array(W * H)
  let next = 0
  const comps = []
  for (let s = 0; s < W * H; s++) {
    if (bg[s] || label[s]) continue
    next++
    let area = 0
    let minx = W
    let miny = H
    let maxx = 0
    let maxy = 0
    const q = [s]
    label[s] = next
    while (q.length) {
      const i = q.pop()
      const x = i % W
      const y = (i / W) | 0
      area++
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = ny * W + nx
          if (!bg[j] && !label[j]) {
            label[j] = next
            q.push(j)
          }
        }
      }
    }
    comps.push({ id: next, area, minx, miny, maxx, maxy })
  }

  // 3. Top 5 by area = phones; order left → right.
  comps.sort((a, b) => b.area - a.area)
  const phones = comps.slice(0, 5).sort((a, b) => a.minx - b.minx)

  for (let k = 0; k < 5; k++) {
    const c = phones[k]
    const model = MODELS[k]
    const bw = c.maxx - c.minx + 1
    const bh = c.maxy - c.miny + 1

    // Alpha from THIS component only (isolates the phone from neighbours/shadow).
    let alpha = new Float32Array(bw * bh)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const gi = (c.miny + y) * W + (c.minx + x)
        alpha[y * bw + x] = label[gi] === c.id ? 255 : 0
      }
    }
    // Erode (3x3 min) to drop the white-blended edge ring.
    for (let e = 0; e < ERODE; e++) {
      const na = new Float32Array(bw * bh)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let m = alpha[y * bw + x]
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) {
                m = 0
                continue
              }
              m = Math.min(m, alpha[ny * bw + nx])
            }
          }
          na[y * bw + x] = m
        }
      }
      alpha = na
    }
    // Feather (one 3x3 box blur) for a soft 1px anti-aliased edge.
    {
      const na = new Float32Array(bw * bh)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let sum = 0
          let cnt = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
              sum += alpha[ny * bw + nx]
              cnt++
            }
          }
          na[y * bw + x] = sum / cnt
        }
      }
      alpha = na
    }

    const out = Buffer.alloc(bw * bh * 4)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const gi = (c.miny + y) * W + (c.minx + x)
        const li = y * bw + x
        out[li * 4] = data[gi * 4]
        out[li * 4 + 1] = data[gi * 4 + 1]
        out[li * 4 + 2] = data[gi * 4 + 2]
        out[li * 4 + 3] = Math.round(alpha[li])
      }
    }

    const black = await sharp(out, { raw: { width: bw, height: bh, channels: 4 } })
      .trim({ threshold: 10 })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(join(OUT, `${model}-black.png`), black)
    const white = await recolorBlackToWhite(black)
    await writeFile(join(OUT, `${model}-white.png`), white)
    const meta = await sharp(black).metadata()
    console.log(
      `${model.padEnd(16)} ${meta.width}x${meta.height}  aspect ${(meta.width / meta.height).toFixed(4)}  (blob area ${c.area})`
    )
  }
  console.log('\ndone →', OUT)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
