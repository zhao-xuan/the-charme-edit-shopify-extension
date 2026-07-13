// Crop a raw GPT case render (phone on a white background) into the app's
// transparent rounded-rectangle case PNG, matching the existing case sets.
//
// Reuses the keying logic from crop-integrated-renders.mjs: locate the case
// rectangle from a row/column density profile against the corner background,
// then stamp a rounded-rect alpha mask. The BLACK render keys reliably, so its
// window (size + centre) is applied to BOTH finishes — the phone never shifts
// when the case colour toggles.
//
// Usage: node scripts/crop-cases.mjs <id> <without-gel|with-gel>
//   reads  /tmp/gen-<id>-black.png  (+ /tmp/gen-<id>-white.png if present)
//   writes public/assets/cases/<case-without-gel|case-with-gel>/<prefix><id>-<finish>.png
//          prefix = '' for without-gel, 'integrated-' for with-gel
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CASES = path.join(__dirname, '..', 'public', 'assets', 'cases')

const FG_DIFF = { white: 10, black: 36 }
const ROW_FRAC = 0.12
const CORNER_FRAC = 0.15
const INSET = 3

function colorDist(r, g, b, br, bg, bb) {
  const dr = r - br, dg = g - bg, db = b - bb
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

async function cornerBg(data, W, H, C) {
  let br = 0, bg = 0, bb = 0, n = 0
  const S = 12
  for (const [ox, oy] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) {
    for (let y = oy; y < oy + S; y++) for (let x = ox; x < ox + S; x++) {
      const i = (y * W + x) * C
      br += data[i]; bg += data[i + 1]; bb += data[i + 2]; n++
    }
  }
  return [br / n, bg / n, bb / n]
}

async function measure(src, diff) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const [br, bg, bb] = await cornerBg(data, W, H, C)
  const rc = new Int32Array(H), cc = new Int32Array(W)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C
    if (colorDist(data[i], data[i + 1], data[i + 2], br, bg, bb) > diff) { rc[y]++; cc[x]++ }
  }
  const rt = W * ROW_FRAC, ct = H * ROW_FRAC
  let minY = 0; while (minY < H && rc[minY] < rt) minY++
  let maxY = H - 1; while (maxY > 0 && rc[maxY] < rt) maxY--
  let minX = 0; while (minX < W && cc[minX] < ct) minX++
  let maxX = W - 1; while (maxX > 0 && cc[maxX] < ct) maxX--
  return { W, H, w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

async function cutout(src, W, H, left, top, ow, oh, mask) {
  const L = Math.max(0, Math.min(W - ow, Math.round(left)))
  const T = Math.max(0, Math.min(H - oh, Math.round(top)))
  const rgba = await sharp(src).ensureAlpha().extract({ left: L, top: T, width: ow, height: oh }).raw().toBuffer()
  for (let p = 0; p < ow * oh; p++) rgba[p * 4 + 3] = mask[p]
  return sharp(rgba, { raw: { width: ow, height: oh, channels: 4 } }).png().toBuffer()
}

async function main() {
  const [id, mode] = process.argv.slice(2)
  if (!id || !mode || !['without-gel', 'with-gel'].includes(mode)) {
    console.error('usage: node scripts/crop-cases.mjs <id> <without-gel|with-gel>')
    process.exit(2)
  }
  const outDir = path.join(CASES, mode === 'with-gel' ? 'case-with-gel' : 'case-without-gel')
  const prefix = mode === 'with-gel' ? 'integrated-' : ''
  // without-gel raws live at /tmp/gen-<id>-<finish>.png ; with-gel (poured gel)
  // raws live at /tmp/gel-<id>-<finish>.png so the two never collide in /tmp.
  const inPrefix = mode === 'with-gel' ? 'gel' : 'gen'
  // Finishes: without-gel = black+white ; with-gel = black+white+glitter.
  const finishes = mode === 'with-gel' ? ['black', 'white', 'glitter'] : ['black', 'white']
  fs.mkdirSync(outDir, { recursive: true })

  const blackSrc = `/tmp/${inPrefix}-${id}-black.png`
  if (!fs.existsSync(blackSrc)) { console.error('missing', blackSrc); process.exit(1) }

  // Key the case rectangle off the black render (reliable on the light background),
  // then apply the SAME window + rounded-rect mask to every finish so the phone
  // never shifts when the customer toggles the gel colour.
  const blk = await measure(blackSrc, FG_DIFF.black)
  const ow = blk.w, oh = blk.h
  const left = blk.cx - ow / 2, top = blk.cy - oh / 2
  const radius = Math.round(ow * CORNER_FRAC)
  const maskSvg = Buffer.from(
    `<svg width="${ow}" height="${oh}"><rect x="${INSET}" y="${INSET}" width="${ow - INSET * 2}" height="${oh - INSET * 2}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  )
  const mask = await sharp(maskSvg).ensureAlpha().extractChannel(3).blur(1.0).raw().toBuffer()

  const done = []
  for (const finish of finishes) {
    const src = `/tmp/${inPrefix}-${id}-${finish}.png`
    if (!fs.existsSync(src)) continue
    const png = await cutout(src, blk.W, blk.H, left, top, ow, oh, mask)
    await sharp(png).toFile(path.join(outDir, `${prefix}${id}-${finish}.png`))
    done.push(finish)
  }
  console.log('cropped', id, `${ow}x${oh}`, 'r' + radius, '→', outDir, '(' + done.join('+') + ')')
}

main()
