/**
 * process-patches.mjs
 * -------------------------------------------------------------------------
 * Tote decorations = real embroidered patches (a deliberately different world
 * from the phone-case jewellery charms). Sources are genuine product photos of
 * Oxford Pennant embroidered patches (white studio background, ~2085×2494).
 *
 * For each patch we download, knock out the white background (corner-seeded
 * flood fill), trim to the patch outline, derive a real-world size from the
 * published patch size guide, and write the cut-out + a catalogue entry to
 * /public/assets/patches + /src/data/patches.json.
 *
 * Three tiers map to the three interaction types (same model as the charms):
 *   grande 1 = statement patch (fixed size)
 *   midi   2 = feature patch (resizable)
 *   mini   3 = filler patch — small US-state patches, tap to scatter
 *
 * Run with:  npm run patches
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_IMG = join(ROOT, 'public', 'assets', 'patches')
const OUT_DATA = join(ROOT, 'src', 'data')

const CDN = 'https://cdn.shopify.com/s/files/1/0329/1313/files/'

const TIERS = {
  grande: { longMm: 88, type: 1, price: 10, minScale: 1, maxScale: 1 },
  midi: { longMm: 74, type: 2, price: 8, minScale: 0.7, maxScale: 1.5 },
  mini: { longMm: 58, type: 3, price: 6, minScale: 0.85, maxScale: 1.2 },
}

/** Real Oxford Pennant embroidered patches (public product CDN). */
const SOURCES = [
  // ---- Statement patches (type 1) -------------------------------------
  { id: 'patch-raise-hell', name: 'Raise Hell', collection: 'Statements', tier: 'grande', file: '0006_raisehell.png' },
  { id: 'patch-do-right', name: 'Do Right', collection: 'Statements', tier: 'grande', file: '0023_doright.png' },
  { id: 'patch-give-a-damn', name: 'Give A Damn', collection: 'Statements', tier: 'grande', file: '0018_give-a-damn-patch-1.png' },

  // ---- Feature patches (type 2) ---------------------------------------
  { id: 'patch-pinky-swear', name: 'Pinky Swear', collection: 'Sayings', tier: 'midi', file: 'pinkypromise-patch-full.png' },
  { id: 'patch-gratitude', name: 'Gratitude Sun', collection: 'Sayings', tier: 'midi', file: '0024_Gratitude_Patch_1.png' },
  { id: 'patch-new-york', name: 'New York', collection: 'Sayings', tier: 'midi', file: '23-50states-patch-newyork.png' },
  { id: 'patch-trust-youth', name: 'Trust The Youth', collection: 'Sayings', tier: 'midi', file: '24-Back_to_School-Trust_Your_Youth-Patch-Full.png' },

  // ---- Filler state patches (type 3) ----------------------------------
  { id: 'patch-texas', name: 'Texas', collection: 'State Patches', tier: 'mini', file: '23-50states-patch-texas.png' },
  { id: 'patch-ohio', name: 'Ohio', collection: 'State Patches', tier: 'mini', file: '23-50states-patch-ohio.png' },
  { id: 'patch-florida', name: 'Florida', collection: 'State Patches', tier: 'mini', file: '23-50states-patch-florida.png' },
  { id: 'patch-arizona', name: 'Arizona', collection: 'State Patches', tier: 'mini', file: '23-50states-patch-arizona.png' },
  { id: 'patch-new-jersey', name: 'New Jersey', collection: 'State Patches', tier: 'mini', file: '23-50states-patch-newjersey.png' },
  { id: 'patch-wisconsin', name: 'Wisconsin', collection: 'State Patches', tier: 'mini', file: '50StatesPatches_0002_23-50states-patch-wisconsin-Blue.png' },
]

const TOL = 30
const FEATHER = 36

function knockout(data, w, h) {
  const n = w * h
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (n - 1) * 4]
  let sr = 0, sg = 0, sb = 0
  for (const c of corners) { sr += data[c]; sg += data[c + 1]; sb += data[c + 2] }
  sr /= 4; sg /= 4; sb /= 4
  const tol2 = TOL * TOL
  const fth2 = (TOL + FEATHER) * (TOL + FEATHER)
  for (const c of corners) { const p = c / 4; if (!visited[p]) { visited[p] = 1; stack[sp++] = p } }
  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb
    const d2 = dr * dr + dg * dg + db * db
    if (d2 > fth2) continue
    if (d2 <= tol2) data[i + 3] = 0
    else data[i + 3] = Math.round(((Math.sqrt(d2) - TOL) / FEATHER) * 255)
    const x = p % w, y = (p / w) | 0
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1 }
    if (x < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1 }
    if (y > 0 && !visited[p - w]) { visited[p - w] = 1; stack[sp++] = p - w }
    if (y < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack[sp++] = p + w }
  }
}

function bounds(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 18) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function processOne(src) {
  const res = await fetch(CDN + src.file)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  const pre = sharp(input).resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await pre.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  knockout(data, info.width, info.height)
  const box = bounds(data, info.width, info.height)
  if (!box) throw new Error('no content')
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(OUT_IMG, `${src.id}.png`), buf)

  const tier = TIERS[src.tier]
  const long = Math.max(box.width, box.height)
  return {
    id: src.id,
    name: src.name,
    collection: src.collection,
    tier: src.tier,
    type: tier.type,
    price: tier.price,
    src: `/assets/patches/${src.id}.png`,
    pxW: box.width,
    pxH: box.height,
    widthMm: +((box.width / long) * tier.longMm).toFixed(1),
    heightMm: +((box.height / long) * tier.longMm).toFixed(1),
    minScale: tier.minScale,
    maxScale: tier.maxScale,
  }
}

async function main() {
  await mkdir(OUT_IMG, { recursive: true })
  await mkdir(OUT_DATA, { recursive: true })
  const out = []
  for (const src of SOURCES) {
    try {
      process.stdout.write(`· ${src.id} … `)
      const e = await processOne(src)
      out.push(e)
      console.log(`ok (${e.pxW}×${e.pxH} → ${e.widthMm}×${e.heightMm}mm)`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
  }
  const byTier = (t) => out.filter((c) => c.tier === t).length
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'Oxford Pennant embroidered patches (public catalogue)',
    counts: { grande: byTier('grande'), midi: byTier('midi'), mini: byTier('mini'), total: out.length },
    patches: out,
  }
  await writeFile(join(OUT_DATA, 'patches.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nWrote ${out.length} patches → src/data/patches.json`)
}

main().catch((e) => { console.error(e); process.exit(1) })
