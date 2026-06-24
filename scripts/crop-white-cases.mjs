/**
 * crop-white-cases.mjs (one-off)
 * -------------------------------------------------------------------------
 * Cut WHITE silicone iPhone cases out of flat Apple product shots (near-pure
 * white background, text labels underneath) into individual tight transparent
 * PNGs matching the existing /assets/cases renders.
 *
 * White-on-white is the hard case: background ≈ 253, case body ≈ 242 — only a
 * narrow luminance gap, plus a soft contact shadow under each phone. Pipeline:
 *   1. Flood-fill the BACKGROUND inward from the borders, treating a pixel as
 *      background only if it is brighter than T_BG (between body and bg). The
 *      case body acts as a wall so the fill stops at the silhouette; enclosed
 *      dark regions (camera lenses) are never border-reachable so they stay
 *      opaque automatically.
 *   2. (optional STRIP_SHADOW) Remove the external soft contact shadow: from
 *      each phone's bbox border, flood through in-foreground pixels darker than
 *      T_SHADOW; those are the gray shadow appendage (the dark camera lenses are
 *      enclosed by bright body, so they are NOT reached and stay opaque).
 *   3. Connected-component label the foreground; the N largest blobs are the
 *      phones (text labels are tiny separate blobs and drop out). Order them
 *      left → right (single row).
 *   4. Per phone: erode 1px (kill the white fringe), feather, compose RGBA,
 *      trim tight, save.
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DL = '/Users/tomzhao/Downloads'

const T_BG = +(process.env.T_BG || 247) // luminance above which a border-connected pixel is background
const T_SHADOW = +(process.env.T_SHADOW || 236) // foreground pixels darker than this, reachable from outside, are contact shadow
const STRIP_SHADOW = process.env.STRIP_SHADOW !== '0'
const ERODE = +(process.env.ERODE || 1)

/**
 * Each job: a source shot + the model keys for its phones, left → right.
 * `take` limits to the first N phones (ignores duplicate renders in the shot).
 * `alias` copies a produced crop to extra model keys that share the same case.
 */
const JOBS = [
  { src: '4C44E8B8-529B-4D99-B603-B977EFBF0E6C', models: ['iphone-8', 'iphone-8-plus', 'iphone-x'], alias: { 'iphone-8': 'iphone-7', 'iphone-8-plus': 'iphone-7-plus' } },
  { src: 'C88B5072-0215-4EC8-BBDC-8297E2CEA2AD', models: ['iphone-xs', null], take: 1 }, // [XS, XR] — XR has no model
  { src: '4920E5D5-FD7E-447D-938E-271FBC40B454', models: ['iphone-11', 'iphone-11-pro', 'iphone-11-pro-max'], take: 3 }, // 4th is a dup
  { src: '588ADAED-8706-42DE-AB1F-045D8A0840C5', models: ['iphone-12-mini', 'iphone-12', 'iphone-12-pro', 'iphone-12-pro-max'] },
  { src: 'BC29204D-9648-4B88-A5DD-2EA091F0E3ED', models: ['iphone-13-mini', 'iphone-13', 'iphone-13-pro', 'iphone-13-pro-max'] },
  // 3×4 white-on-white grid (row-major): 16 / 15 / 14 families.
  {
    src: '3x4-grid',
    grid: { rows: 3, cols: 4 },
    models: [
      'iphone-16', 'iphone-16-plus', 'iphone-16-pro', 'iphone-16-pro-max',
      'iphone-15', 'iphone-15-plus', 'iphone-15-pro', 'iphone-15-pro-max',
      'iphone-14', 'iphone-14-plus', 'iphone-14-pro', 'iphone-14-pro-max',
    ],
  },
  // TODO: clean iPhone 17 / 17 Air / 17 Pro / 17 Pro Max white shot — re-add when
  // available → models: ['iphone-17', 'iphone-air', 'iphone-17-pro', 'iphone-17-pro-max'].
]

async function segment(srcPath, expectedN, grid) {
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const lum = (i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]

  // 1. Flood-fill background inward from the borders (near-white only).
  const bg = new Uint8Array(W * H)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    if (!bg[i] && lum(i) > T_BG) {
      bg[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < W; x++) {
    push(x, 0)
    push(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    push(0, y)
    push(W - 1, y)
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W
    const y = (i / W) | 0
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
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

  comps.sort((a, b) => b.area - a.area)
  let phones = comps.slice(0, expectedN)
  if (grid) {
    // Row-major: sort by vertical centre, chunk into rows, sort each row by x.
    phones.sort((a, b) => (a.miny + a.maxy) / 2 - (b.miny + b.maxy) / 2)
    const ordered = []
    for (let r = 0; r < grid.rows; r++) {
      const row = phones.slice(r * grid.cols, (r + 1) * grid.cols)
      row.sort((a, b) => (a.minx + a.maxx) / 2 - (b.minx + b.maxx) / 2)
      ordered.push(...row)
    }
    phones = ordered
  } else {
    phones.sort((a, b) => a.minx - b.minx)
  }
  return { data, W, H, label, phones, lum }
}

function buildAlpha({ data, W, label, lum }, c) {
  const bw = c.maxx - c.minx + 1
  const bh = c.maxy - c.miny + 1
  const inComp = (x, y) => label[(c.miny + y) * W + (c.minx + x)] === c.id

  let alpha = new Float32Array(bw * bh)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      alpha[y * bw + x] = inComp(x, y) ? 255 : 0
    }
  }

  // 2b. Strip external contact shadow: flood dark, in-component pixels from the
  // bbox border. Enclosed dark lenses are not reached, so they stay opaque.
  if (STRIP_SHADOW) {
    const li = (x, y) => (c.miny + y) * W + (c.minx + x)
    const shadow = new Uint8Array(bw * bh)
    const st = []
    const tryS = (x, y) => {
      if (x < 0 || y < 0 || x >= bw || y >= bh) return
      const k = y * bw + x
      if (shadow[k]) return
      if (alpha[k] === 0) return // outside silhouette
      if (lum(li(x, y)) >= T_SHADOW) return // bright body wall
      shadow[k] = 1
      st.push(k)
    }
    for (let x = 0; x < bw; x++) {
      tryS(x, 0)
      tryS(x, bh - 1)
    }
    for (let y = 0; y < bh; y++) {
      tryS(0, y)
      tryS(bw - 1, y)
    }
    while (st.length) {
      const k = st.pop()
      const x = k % bw
      const y = (k / bw) | 0
      tryS(x - 1, y)
      tryS(x + 1, y)
      tryS(x, y - 1)
      tryS(x, y + 1)
    }
    for (let k = 0; k < bw * bh; k++) if (shadow[k]) alpha[k] = 0
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
  // Feather (one 3x3 box blur).
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
      const k = y * bw + x
      out[k * 4] = data[gi * 4]
      out[k * 4 + 1] = data[gi * 4 + 1]
      out[k * 4 + 2] = data[gi * 4 + 2]
      out[k * 4 + 3] = Math.round(alpha[k])
    }
  }
  return { out, bw, bh }
}

async function cut(srcPath, expectedN, grid) {
  const seg = await segment(srcPath, expectedN, grid)
  const results = []
  for (const c of seg.phones) {
    const { out, bw, bh } = buildAlpha(seg, c)
    const png = await sharp(out, { raw: { width: bw, height: bh, channels: 4 } })
      .trim({ threshold: 8 })
      .png({ compressionLevel: 9 })
      .toBuffer()
    results.push(png)
  }
  return results
}

const STAGE = '/tmp/white-out'

/** Process every job → write each crop (and its aliases) to the staging dir. */
async function main() {
  await mkdir(STAGE, { recursive: true })
  const written = []
  for (const job of JOBS) {
    const expectedN = job.take || job.models.length
    const pngs = await cut(join(DL, `${job.src}.png`), expectedN, job.grid)
    for (let i = 0; i < pngs.length; i++) {
      const model = job.models[i]
      if (!model) continue
      await writeFile(join(STAGE, `${model}-white.png`), pngs[i])
      const meta = await sharp(pngs[i]).metadata()
      written.push(model)
      console.log(`${model.padEnd(20)} ${meta.width}x${meta.height}`)
      if (job.alias && job.alias[model]) {
        await writeFile(join(STAGE, `${job.alias[model]}-white.png`), pngs[i])
        written.push(job.alias[model])
        console.log(`${job.alias[model].padEnd(20)} (alias of ${model})`)
      }
    }
  }

  // Montage of everything on a light app-stage background for review.
  const order = written.slice().sort()
  const cell = 250
  const perRow = 6
  const rows = Math.ceil(order.length / perRow)
  const tiles = []
  for (let i = 0; i < order.length; i++) {
    const b = await sharp(join(STAGE, `${order[i]}-white.png`)).resize({ height: 360, fit: 'inside' }).toBuffer()
    const m = await sharp(b).metadata()
    const r = (i / perRow) | 0
    const cI = i % perRow
    tiles.push({ input: b, left: cI * cell + ((cell - m.width) / 2 | 0), top: r * 420 + 20 })
  }
  await sharp({ create: { width: cell * perRow, height: rows * 420 + 20, channels: 4, background: { r: 244, g: 244, b: 246, alpha: 1 } } })
    .composite(tiles)
    .png()
    .toFile(join(STAGE, '_montage.png'))
  console.log(`\nWrote ${written.length} white crops → ${STAGE}\nmontage → ${join(STAGE, '_montage.png')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
