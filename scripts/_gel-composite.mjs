// Composite the "gel" onto a REAL Apple case photo so the phone stays pixel-perfect
// (correct proportions, camera untouched) and we control the gel precisely:
//   - flat straight top border (only the gel surface undulates, the boundary is level)
//   - position (how close to the camera)
//   - colour (whiter)
//   - follows the phone's rounded bottom + inset from the case rim
//
// Usage: node scripts/_gel-composite.mjs <basePhoto> <gelSrc> <out> [yTopFrac] [rim] [whiteR,whiteG,whiteB]
import sharp from 'sharp'

const BASE = process.argv[2] || 'public/assets/cases/iphone-17-pro-white.png'
const GEL = process.argv[3] || '/tmp/gen-17pro-white-v7.png'
const OUT = process.argv[4] || '/tmp/composite-17pro-white.png'
const YTOP = parseFloat(process.argv[5] || '0.30')   // gel top as fraction of phone height
const RIM = parseInt(process.argv[6] || '12', 10)    // inset from phone edge (px)
const WHITE = (process.argv[7] || '236,236,234').split(',').map(Number) // target gel mean colour

const erode1 = (m, W, H) => {
  const o = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (!m[p]) continue
    let k = 1
    for (let dy = -1; dy <= 1 && k; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !m[ny * W + nx]) { k = 0; break }
    }
    o[p] = k
  }
  return o
}

async function main() {
  const { data: bd, info: bi } = await sharp(BASE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = bi.width, H = bi.height, N = W * H

  // phone mask + bbox
  const phone = new Uint8Array(N)
  let minx = W, miny = H, maxx = 0, maxy = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x
    if (bd[p * 4 + 3] > 128) { phone[p] = 1; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y }
  }
  const Hp = maxy - miny, Wp = maxx - minx
  const yTop = Math.round(miny + YTOP * Hp)

  // inset (erode) so a rim of bare case shows around the gel
  let inset = phone
  for (let i = 0; i < RIM; i++) inset = erode1(inset, W, H)

  // gel mask = inset phone below yTop (flat top edge)
  const gel = new Uint8Array(N)
  for (let y = yTop; y <= maxy; y++) for (let x = minx; x <= maxx; x++) { const p = y * W + x; if (inset[p]) gel[p] = 1 }

  // gel texture: crop the molten region from the GEL render, resize to the gel bbox
  const gm = await sharp(GEL).metadata()
  const cropL = Math.round(gm.width * 0.12), cropR = Math.round(gm.width * 0.88)
  const cropT = Math.round(gm.height * 0.36), cropB = Math.round(gm.height * 0.92)
  const regW = maxx - minx + 1, regH = maxy - yTop + 1
  const { data: td, info: ti } = await sharp(GEL)
    .extract({ left: cropL, top: cropT, width: cropR - cropL, height: cropB - cropT })
    .resize(regW, regH, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const tW = ti.width

  // recolour texture: shift its mean to WHITE (keeps molten highlight/shadow variation)
  let mr = 0, mg = 0, mb = 0
  for (let p = 0; p < regW * regH; p++) { mr += td[p * 3]; mg += td[p * 3 + 1]; mb += td[p * 3 + 2] }
  const n = regW * regH; mr /= n; mg /= n; mb /= n
  const sr = WHITE[0] - mr, sg = WHITE[1] - mg, sb = WHITE[2] - mb

  // build output = base, with gel composited in the gel mask
  const out = Buffer.from(bd) // RGBA copy
  const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v
  for (let y = yTop; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const p = y * W + x
    if (!gel[p]) continue
    const tp = ((y - yTop) * tW + (x - minx)) * 3
    let r = clamp(td[tp] + sr), g = clamp(td[tp + 1] + sg), b = clamp(td[tp + 2] + sb)
    // subtle inner shadow just under the flat top edge -> reads as a raised gel lip
    const dTop = y - yTop
    if (dTop < 10) { const f = (10 - dTop) / 10 * 0.28; r = clamp(r * (1 - f)); g = clamp(g * (1 - f)); b = clamp(b * (1 - f)) }
    const i = p * 4
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255
  }

  // a thin bright highlight line on the bare case just above the gel top edge (gel thickness)
  for (let y = Math.max(miny, yTop - 3); y < yTop; y++) for (let x = minx; x <= maxx; x++) {
    const p = y * W + x; if (!inset[p]) continue
    const i = p * 4; out[i] = clamp(out[i] + 8); out[i + 1] = clamp(out[i + 1] + 8); out[i + 2] = clamp(out[i + 2] + 8)
  }

  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(OUT)
  console.log('wrote', OUT, W + 'x' + H, 'gelTop y=' + yTop, '(' + (YTOP * 100 | 0) + '%) rim=' + RIM, 'white=' + WHITE, 'texMean=[' + [mr, mg, mb].map(v => v | 0) + ']')
}
main()
