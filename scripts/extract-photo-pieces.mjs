/**
 * extract-photo-pieces.mjs
 * -------------------------------------------------------------------------
 * Faithful on-case reproduction: cuts each tracked charm straight out of the
 * full-resolution reference photo (gold pieces on a cream case) and writes a
 * seedable layout that drops those exact cut-outs onto the iPhone 16 Pro Max at
 * the same fractional position + real measured size. This sidesteps the weak
 * nearestCutout links so the screenshot matches the photo by construction.
 *
 * Background removal: flood from the crop border, clearing pixels within a
 * colour tolerance of the sampled case colour (enclosed light areas like a
 * pearl centre stay because they aren't border-connected).
 *
 * Run: node scripts/extract-photo-pieces.mjs [photoFileName] [scale]
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')

const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166

const PHOTO = process.argv[2] || 'Image_20260618161922_515_813.jpg'
const S = parseFloat(process.argv[3] || '3.782') // detection->full-res scale
const PAD = 0.12      // small crop margin (fraction of box)

function rgbToSL(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  const s = d < 1e-4 ? 0 : (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn))
  return [s, l]
}

// All-gold-on-cream matte: a pixel is the case (drop it) when it is light AND
// desaturated, or near-white. The kept metal charm is the large connected
// region(s); tiny kept specks (glitter sparkle) are discarded.
async function removeBg(buf, w, h) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const keep = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const [s, l] = rgbToSL(r, g, b)
    const isCase = (l > 0.6 && s < 0.22) || (s < 0.13 && l > 0.4) || (r > 236 && g > 236 && b > 236)
    keep[p] = isCase ? 0 : 1
  }
  // keep only sizeable connected components (4-conn) → removes glitter specks
  const TH = Math.max(160, Math.round(0.004 * w * h))
  const seen = new Uint8Array(w * h)
  const stack = []
  for (let start = 0; start < w * h; start++) {
    if (!keep[start] || seen[start]) continue
    stack.length = 0; stack.push(start); seen[start] = 1
    const comp = [start]
    while (stack.length) {
      const idx = stack.pop()
      const x = idx % w, y = (idx / w) | 0
      const nb = [x > 0 ? idx - 1 : -1, x < w - 1 ? idx + 1 : -1, y > 0 ? idx - w : -1, y < h - 1 ? idx + w : -1]
      for (const n of nb) if (n >= 0 && keep[n] && !seen[n]) { seen[n] = 1; stack.push(n); comp.push(n) }
    }
    if (comp.length < TH) for (const n of comp) keep[n] = 0
  }
  for (let p = 0; p < w * h; p++) if (!keep[p]) data[p * 4 + 3] = 0
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().trim({ threshold: 1 }).toBuffer()
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  const meta = tracking.photos.find((p) => p.photo === PHOTO)
  const pieces = tracking.pieces.filter((p) => p.photo === PHOTO)
  if (!meta) throw new Error(`no photo ${PHOTO}`)
  const box = meta.caseBoxPx
  const realPath = join(REF, '1-charms-real-image', PHOTO)
  const full = await sharp(realPath).metadata()

  const OUT = join(ROOT, 'public', '_demo', 'pieces')
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const charms = []
  for (const p of pieces) {
    // pieces-tracking pixelBox.x/y is the CENTRE of the piece (not top-left).
    const padX = p.pixelBox.w * PAD, padY = p.pixelBox.h * PAD
    let left = Math.round((p.pixelBox.x - p.pixelBox.w / 2 - padX) * S)
    let top = Math.round((p.pixelBox.y - p.pixelBox.h / 2 - padY) * S)
    let cw = Math.round((p.pixelBox.w + 2 * padX) * S)
    let ch = Math.round((p.pixelBox.h + 2 * padY) * S)
    left = Math.max(0, left); top = Math.max(0, top)
    cw = Math.min(full.width - left, cw); ch = Math.min(full.height - top, ch)
    const crop = await sharp(realPath).extract({ left, top, width: cw, height: ch }).toBuffer()
    const cut = await removeBg(crop, cw, ch)
    await writeFile(join(OUT, `${p.id}.png`), cut)

    const cxPx = p.pixelBox.x
    const cyPx = p.pixelBox.y
    charms.push({
      id: p.id,
      src: `/_demo/pieces/${p.id}.png`,
      name: p.categoryName || p.id,
      category: p.category || 'gold',
      cxMm: +(((cxPx - box.minx) / box.w) * PRODUCT_W).toFixed(2),
      cyMm: +(((cyPx - box.miny) / box.h) * PRODUCT_H).toFixed(2),
      wMm: +((p.pctOfCaseW / 100) * PRODUCT_W).toFixed(2),
      hMm: +((p.pctOfCaseH / 100) * PRODUCT_H).toFixed(2),
      rot: 0,
    })
  }

  // Centre the decorated cluster on the case. The detected caseBox edge is a
  // few mm imprecise (white case on a light ground), which otherwise lets the
  // left-most pieces hang off the edge; balancing the margins matches how the
  // real photo sits and keeps every charm on the case.
  const lefts = charms.map((c) => c.cxMm - c.wMm / 2)
  const rights = charms.map((c) => c.cxMm + c.wMm / 2)
  const tops = charms.map((c) => c.cyMm - c.hMm / 2)
  const bots = charms.map((c) => c.cyMm + c.hMm / 2)
  const shiftX = (PRODUCT_W - Math.max(...rights) - Math.min(...lefts)) / 2
  const minTop = Math.min(...tops), maxBot = Math.max(...bots)
  // only nudge vertically if the cluster overflows the case top/bottom
  let shiftY = 0
  if (minTop < 4) shiftY = 4 - minTop
  else if (maxBot > PRODUCT_H - 4) shiftY = (PRODUCT_H - 4) - maxBot
  for (const c of charms) {
    c.cxMm = +(c.cxMm + shiftX).toFixed(2)
    c.cyMm = +(c.cyMm + shiftY).toFixed(2)
  }
  console.log(`centred cluster: shiftX ${shiftX.toFixed(1)}mm shiftY ${shiftY.toFixed(1)}mm`) // eslint-disable-line

  const layout = { productId: PRODUCT_ID, caseColourId: 'white', gelColourId: 'glitter', photo: PHOTO, charms }
  await writeFile(join(ROOT, 'public', '_demo', 'layout.json'), JSON.stringify(layout, null, 2))
  console.log(`extracted ${charms.length} pieces from ${PHOTO} -> public/_demo/pieces, wrote layout.json`) // eslint-disable-line
}
main()
