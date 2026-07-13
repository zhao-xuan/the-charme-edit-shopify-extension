// Crop a SINGLE light-case (white/cream) phone render on a white background into
// the app's transparent rounded-rectangle PNG. Keys off the case-vs-white-bg
// edge (low threshold), so it works for cream/米白色 cases that the black-keyed
// crop-cases.mjs can't measure. Optionally resizes to a target WxH so a finish
// generated on a differently-framed base still matches its siblings.
//
// Usage: node scripts/crop-one.mjs <in.png> <out.png> [targetW targetH]
import sharp from 'sharp'

const CORNER_FRAC = 0.15
const INSET = 3
const ROW_FRAC = 0.12
const FG_DIFF = 10

function dist(r, g, b, br, bg, bb) { const dr = r - br, dg = g - bg, db = b - bb; return Math.sqrt(dr * dr + dg * dg + db * db) }

async function main() {
  const [inP, outP, tw, th] = process.argv.slice(2)
  if (!inP || !outP) { console.error('usage: node scripts/crop-one.mjs <in> <out> [W H]'); process.exit(2) }
  const { data, info } = await sharp(inP).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  // corner bg
  let br = 0, bg = 0, bb = 0, n = 0
  const S = 12
  for (const [ox, oy] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) {
    for (let y = oy; y < oy + S; y++) for (let x = ox; x < ox + S; x++) { const i = (y * W + x) * C; br += data[i]; bg += data[i + 1]; bb += data[i + 2]; n++ }
  }
  br /= n; bg /= n; bb /= n
  const rc = new Int32Array(H), cc = new Int32Array(W)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * C; if (dist(data[i], data[i + 1], data[i + 2], br, bg, bb) > FG_DIFF) { rc[y]++; cc[x]++ } }
  const rt = W * ROW_FRAC, ct = H * ROW_FRAC
  let minY = 0; while (minY < H && rc[minY] < rt) minY++
  let maxY = H - 1; while (maxY > 0 && rc[maxY] < rt) maxY--
  let minX = 0; while (minX < W && cc[minX] < ct) minX++
  let maxX = W - 1; while (maxX > 0 && cc[maxX] < ct) maxX--
  const ow = maxX - minX + 1, oh = maxY - minY + 1
  const radius = Math.round(ow * CORNER_FRAC)
  const maskSvg = Buffer.from(`<svg width="${ow}" height="${oh}"><rect x="${INSET}" y="${INSET}" width="${ow - INSET * 2}" height="${oh - INSET * 2}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`)
  const mask = await sharp(maskSvg).ensureAlpha().extractChannel(3).blur(1.0).raw().toBuffer()
  const rgba = await sharp(inP).ensureAlpha().extract({ left: minX, top: minY, width: ow, height: oh }).raw().toBuffer()
  for (let p = 0; p < ow * oh; p++) rgba[p * 4 + 3] = mask[p]
  let img = sharp(rgba, { raw: { width: ow, height: oh, channels: 4 } })
  if (tw && th) img = img.resize(parseInt(tw, 10), parseInt(th, 10), { fit: 'fill' })
  await img.png().toFile(outP)
  console.log('crop-one', inP.split('/').pop(), `${ow}x${oh}`, tw && th ? `-> ${tw}x${th}` : '', '->', outP.split('/').pop())
}
main()
