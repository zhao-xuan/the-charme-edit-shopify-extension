// Recolor a white/neutral phone-case render to 米白色 (warm cream), changing ONLY
// the colour: each opaque pixel is multiplied by a per-channel factor that maps
// the image's own light "white point" onto the cream target, preserving all
// shading, texture, highlights and the phone/gel/camera detail.
//
// Usage: node scripts/recolor-mibai.mjs <in.png> [out.png]
//        (out defaults to in — in-place). Target defaults to 220,216,204.
import sharp from 'sharp'

const TARGET = (process.env.MIBAI || '220,216,204').split(',').map(Number)

async function recolor(inPath, outPath) {
  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  // modal light colour (the case body): most common opaque, fairly-bright pixel
  const bins = {}
  for (let p = 0; p < W * H; p++) {
    const a = data[p * 4 + 3]; if (a < 250) continue
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2]
    const lum = (r + g + b) / 3
    if (lum > 205 && lum < 250) { const k = ((r >> 3) << 3) + ',' + ((g >> 3) << 3) + ',' + ((b >> 3) << 3); bins[k] = (bins[k] || 0) + 1 }
  }
  const top = Object.entries(bins).sort((a, b) => b[1] - a[1])[0]
  if (!top) { console.log('  no light case pixels found in', inPath, '- skipped'); return }
  const [wr, wg, wb] = top[0].split(',').map(Number)
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v
  let fR = clamp(TARGET[0] / wr, 0.6, 1.1)
  let fG = clamp(TARGET[1] / wg, 0.6, 1.1)
  let fB = clamp(TARGET[2] / wb, 0.6, 1.1)
  // Enforce a WARM, monotonic tint (fR >= fG >= fB) so a non-neutral source
  // white can never invert into a green/cool cast — only cream.
  fG = Math.min(fG, fR)
  fB = Math.min(fB, fG)
  const out = Buffer.from(data)
  for (let p = 0; p < W * H; p++) {
    if (out[p * 4 + 3] === 0) continue
    out[p * 4] = clamp(Math.round(data[p * 4] * fR), 0, 255)
    out[p * 4 + 1] = clamp(Math.round(data[p * 4 + 1] * fG), 0, 255)
    out[p * 4 + 2] = clamp(Math.round(data[p * 4 + 2] * fB), 0, 255)
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outPath)
  console.log(`  recolored ${inPath.split('/').pop()}  whitePoint=(${wr},${wg},${wb}) f=(${fR.toFixed(3)},${fG.toFixed(3)},${fB.toFixed(3)}) -> ${outPath.split('/').pop()}`)
}

const [inP, outP] = process.argv.slice(2)
if (!inP) { console.error('usage: node scripts/recolor-mibai.mjs <in.png> [out.png]'); process.exit(2) }
recolor(inP, outP || inP)
