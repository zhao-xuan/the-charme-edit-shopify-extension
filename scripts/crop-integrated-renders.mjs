// Neither a colour key on white (near-white gel ≈ light background) nor a
// flood-fill on black (near-white specular highlights bleed through) can cut
// these glossy renders cleanly. But the case is simply a rounded rectangle, so we
// cut it geometrically: find the true case rectangle from a row/column density
// profile (black uses a high threshold to ignore its soft shadow; white a low one
// to catch its faint edges), then apply a rounded-rectangle alpha mask sized to
// the iPhone case corner radius. The black render gives the shared rectangle size
// (reliable); each finish is centred on its own render so the two never drift.
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CASES = path.join(__dirname, '..', 'public', 'assets', 'cases')
const TMP = '/tmp'

// Every iPhone model. Each is keyed from its raw GPT renders at
// /tmp/gen-<id>-<white|black>.png (produced by the ChatGPT generation run); a
// model is only processed once BOTH colour raws exist, so this script can be
// re-run at any point and it keys whatever is ready.
const ALL_MODELS = [
  'iphone-7', 'iphone-8', 'iphone-7-plus', 'iphone-8-plus',
  'iphone-x', 'iphone-xs', 'iphone-xs-max',
  'iphone-11', 'iphone-11-pro', 'iphone-11-pro-max',
  'iphone-12-mini', 'iphone-12', 'iphone-12-pro', 'iphone-12-pro-max',
  'iphone-13-mini', 'iphone-13', 'iphone-13-pro', 'iphone-13-pro-max',
  'iphone-14', 'iphone-14-plus', 'iphone-14-pro', 'iphone-14-pro-max',
  'iphone-15', 'iphone-15-plus', 'iphone-15-pro', 'iphone-15-pro-max',
  'iphone-16', 'iphone-16-plus', 'iphone-16-pro', 'iphone-16-pro-max',
  'iphone-17', 'iphone-17-pro', 'iphone-17-pro-max', 'iphone-air',
  // Android — Samsung Galaxy, Xiaomi, Huawei
  'galaxy-s24-ultra', 'galaxy-s24-plus', 'galaxy-s24',
  'galaxy-s23-ultra', 'galaxy-s23-plus', 'galaxy-s23',
  'galaxy-s22-ultra', 'galaxy-s22-plus', 'galaxy-s22',
  'xiaomi-14-pro', 'xiaomi-14', 'xiaomi-13-pro', 'xiaomi-13',
  'huawei-mate-60-pro', 'huawei-mate-50-pro', 'huawei-p60-pro',
]
const MODELS = ALL_MODELS
  .map((id) => ({ id, white: `${TMP}/gen-${id}-white.png`, black: `${TMP}/gen-${id}-black.png` }))
  .filter((m) => fs.existsSync(m.white) && fs.existsSync(m.black))

// Density-profile thresholds: a pixel counts as "case" when it differs from the
// corner background by more than this. Black is far from the light background
// (high threshold ignores the soft shadow); the near-white case needs a low one.
const FG_DIFF = { white: 10, black: 36 }
// A row/column belongs to the case when at least this fraction of it is case px.
const ROW_FRAC = 0.12
// Case corner radius as a fraction of the case WIDTH (iPhone silicone cases are
// ~0.15·width). Erring a touch large rounds the corner rather than leaving a
// background sliver.
const CORNER_FRAC = 0.15
// Pull the mask a hair inside the detected rectangle so no background fringe
// survives along the straight edges.
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

// Locate the case rectangle via a row/column density profile.
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

// Extract a (left,top,ow,oh) window from a render (clamped) and stamp in the mask.
async function cutout(src, W, H, left, top, ow, oh, mask) {
  const L = Math.max(0, Math.min(W - ow, Math.round(left)))
  const T = Math.max(0, Math.min(H - oh, Math.round(top)))
  const rgba = await sharp(src).ensureAlpha().extract({ left: L, top: T, width: ow, height: oh }).raw().toBuffer()
  for (let p = 0; p < ow * oh; p++) rgba[p * 4 + 3] = mask[p]
  return sharp(rgba, { raw: { width: ow, height: oh, channels: 4 } }).png().toBuffer()
}

async function processModel(m) {
  // The black render keys reliably (black case is far from the light background);
  // the white render's near-white case can blend into a soft background gradient
  // and mis-detect. Since the black is a recolour of the white, both finishes
  // share the same phone position — so we take the case rectangle (size + centre)
  // from the black render and crop BOTH finishes to it. Identical window => the
  // phone never shifts or resizes when the customer toggles the gel colour.
  const blk = await measure(m.black, FG_DIFF.black)
  const ow = blk.w, oh = blk.h
  const left = blk.cx - ow / 2, top = blk.cy - oh / 2
  const radius = Math.round(ow * CORNER_FRAC)
  const maskSvg = Buffer.from(
    `<svg width="${ow}" height="${oh}"><rect x="${INSET}" y="${INSET}" width="${ow - INSET * 2}" height="${oh - INSET * 2}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  )
  const mask = await sharp(maskSvg).ensureAlpha().extractChannel(3).blur(1.0).raw().toBuffer()

  const blackPng = await cutout(m.black, blk.W, blk.H, left, top, ow, oh, mask)
  const whitePng = await cutout(m.white, blk.W, blk.H, left, top, ow, oh, mask)
  await sharp(blackPng).toFile(path.join(CASES, `integrated-${m.id}-black.png`))
  await sharp(whitePng).toFile(path.join(CASES, `integrated-${m.id}-white.png`))
  return { id: m.id, size: `${ow}x${oh}`, aspect: (ow / oh).toFixed(3), r: radius }
}

const results = []
for (const m of MODELS) results.push(await processModel(m))
for (const r of results) console.log(r.id.padEnd(18), r.size, 'aspect', r.aspect, 'r', r.r)

// Emit a manifest of every model that now has a keyed integrated render so the
// app (src/data/products.js) can wire them up without a hand-maintained list.
const manifest = results.map((r) => r.id).sort()
fs.writeFileSync(
  path.join(__dirname, '..', 'src', 'data', 'integrated-models.json'),
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(`\nwrote src/data/integrated-models.json (${manifest.length} models)`)
