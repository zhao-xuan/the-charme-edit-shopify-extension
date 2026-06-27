/**
 * extract-precise-pieces.mjs
 * -------------------------------------------------------------------------
 * MOST FAITHFUL reproduction: cut every tracked charm STRAIGHT out of the
 * full-resolution reference photo and drop those exact cut-outs onto the black
 * iPhone 16 Pro Max at their measured position + size. Because the art is the
 * real pixels, the pieces are identical to 1-charms-real-image by construction
 * (no catalogue guessing / identity errors).
 *
 * Ground truth = reference/pieces-tracking.json, the same boxes drawn in
 * reference/5-pieces-bordered/:
 *   pixelBox.{x,y} = TOP-LEFT corner (minx,miny) in the photo's detection space
 *                    (height normalised to 1800; width scaled to match).
 *   caseBoxPx      = case outer in the same space.
 *   pieceCentre    = (x + w/2, y + h/2)
 * Detection→full-res scale is PER PHOTO:  S = fullHeight / 1800  (photos range
 * from 1024×1536 to 4160×6240, so a single constant is wrong).
 *
 * Background removal: border-seeded flood fill. Sample the case colour from the
 * crop's outer ring, then flood inward from every border pixel, clearing pixels
 * within a tolerance of that colour. Enclosed light areas (a pearl centre) are
 * not border-connected, so they survive. Adapts to light (cream/white) and dark
 * (black) cases automatically from the sampled ring luminance.
 *
 * Placement keeps the crop = box + symmetric pad (no trim) so the piece centre
 * equals the box centre; size uses a single width-based scale so the art keeps
 * its true aspect (no stretching).
 *
 * Run: node scripts/extract-precise-pieces.mjs
 * Output: public/_demo/pieces/<base>/<Pid>.png  +  public/_demo/layouts.json
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWork } from './_deskew.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REF = join(ROOT, 'reference')
const PUBLIC = join(ROOT, 'public')

const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166
const PAD = 0.13 // crop margin as a fraction of the box (a reliable case ring to seed from)
const DET_H = 1800 // detection-space height used by track-and-measure-pieces.mjs

const dist = (r, g, b, br, bg, bb) => {
  const dr = r - br, dg = g - bg, db = b - bb
  return Math.sqrt(dr * dr + dg * dg + db * db)
}
const median = (a) => {
  if (!a.length) return 0
  a.sort((p, q) => p - q)
  return a[a.length >> 1]
}

async function caseColorOf(data, W, H, C) {
  const hist = new Map()
  for (let p = 0; p < W * H; p++) {
    const i = p * C
    const key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4)
    let e = hist.get(key)
    if (!e) { e = [0, 0, 0, 0]; hist.set(key, e) }
    e[0] += data[i]; e[1] += data[i + 1]; e[2] += data[i + 2]; e[3]++
  }
  let best = null
  for (const e of hist.values()) if (!best || e[3] > best[3]) best = e
  return [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3])]
}

// The dominant colour inside the whole case = the case background (histogram
// mode), reliable even on densely-packed photos.
async function caseColor(realPath, box, S) {
  const left = Math.round(box.minx * S), top = Math.round(box.miny * S)
  const w = Math.round(box.w * S), h = Math.round(box.h * S)
  const { data, info } = await sharp(realPath).rotate()
    .extract({ left, top, width: w, height: h })
    .resize({ width: 150 }).raw().toBuffer({ resolveWithObject: true })
  return caseColorOf(data, info.width, info.height, info.channels)
}

/**
 * Region-growing background removal for one piece crop. The flood is seeded
 * from the crop border and grows through every pixel that is either close to the
 * case colour OR close to the neighbour it grew from — so it follows the silicone
 * tray's surface and its soft shadow/tint gradients all the way up to each charm,
 * then stops at the charm's sharp edge. This clears the whole connected tray
 * background (no leftover rectangles) while leaving the charm intact. Charms with
 * a soft, low-contrast edge (translucent white crystals) can still be eaten — the
 * caller detects that (low keptFrac) and falls back to the raw crop.
 */
/**
 * Background removal for one piece crop by an ENCLOSURE flood. The flood is
 * seeded from the crop border and spreads only through pixels that are close to
 * the case colour (a plain connected-component fill — NO gradient/region growing).
 * A charm's dark outline is not case-coloured, so the flood cannot cross it; the
 * charm interior is therefore preserved even where a bright metallic highlight
 * happens to match the case colour (it is unreachable, being enclosed). The case
 * and its soft shadow ring around each charm are cleared because the tolerance is
 * set high enough to reach them. Charms with no dark outline at all (translucent
 * white crystals) can still be entered — that is the one inherently hard case.
 */
async function removeBgDepth(buf, _w, _h, caseBg, T) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height
  const [br, bg, bb] = caseBg
  const nearCase = (i) => dist(data[i], data[i + 1], data[i + 2], br, bg, bb) <= T
  const mask = new Uint8Array(w * h)
  const q = []
  let head = 0
  // Seed from border pixels that match the global case colour (the crop pad is a
  // case ring). NB: do NOT seed by the border's own dominant colour — when a
  // charm fills its box the border IS the charm, and that would erase it.
  const seedBorder = (idx) => { if (!mask[idx] && nearCase(idx * 4)) { mask[idx] = 1; q.push(idx) } }
  for (let x = 0; x < w; x++) { seedBorder(x); seedBorder((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seedBorder(y * w); seedBorder(y * w + w - 1) }
  while (head < q.length) {
    const idx = q[head++]
    const x = idx % w, y = (idx / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const nIdx = ny * w + nx
        if (mask[nIdx]) continue
        // spread only through case-coloured pixels (enclosure: a charm's dark
        // edge is not case-coloured and blocks the flood)
        if (nearCase(nIdx * 4)) { mask[nIdx] = 1; q.push(nIdx) }
      }
    }
  }
  // Defringe: grow the bg mask a couple px into the charm so the soft case-colour
  // halo at the charm edge is removed (otherwise a pale rim shows on black).
  const R = Math.max(1, Math.round(Math.min(w, h) * 0.012))
  let cur = mask
  for (let pass = 0; pass < R; pass++) {
    const next = cur.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (cur[idx]) continue
        if ((x > 0 && cur[idx - 1]) || (x < w - 1 && cur[idx + 1]) ||
            (y > 0 && cur[idx - w]) || (y < h - 1 && cur[idx + w])) next[idx] = 1
      }
    }
    cur = next
  }
  let kept = 0
  for (let p = 0; p < w * h; p++) {
    if (cur[p]) data[p * 4 + 3] = 0
    else kept++
  }
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  return { buf: out, keptFrac: kept / (w * h) }
}

async function main() {
  const tracking = JSON.parse(await readFile(join(REF, 'pieces-tracking.json'), 'utf8'))
  // Accurate per-photo phone-case rectangle (DET_H space) from build-case-rects.mjs.
  // This REPLACES the imprecise caseBoxPx (whose right edge ran into the desk,
  // compressing every charm leftwards). Positions + size scale derive from it.
  const caseRects = JSON.parse(await readFile(join(REF, 'case-rects.json'), 'utf8'))
  const byPhoto = new Map()
  for (const p of tracking.pieces) {
    if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, [])
    byPhoto.get(p.photo).push(p)
  }

  const OUT = join(PUBLIC, '_demo', 'pieces')
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const photos = []
  for (const meta of tracking.photos) {
    if (!meta.caseBoxPx) continue
    const photo = meta.photo
    const pieces = byPhoto.get(photo)
    if (!pieces || !pieces.length) continue
    const base = photo.replace(/\.(jpe?g|png)$/i, '')
    // accurate case rect (DET space); fall back to tracking's caseBoxPx if absent
    const cr = caseRects[base]
    const box = cr
      ? { minx: cr.minx, miny: cr.miny, maxx: cr.maxx, maxy: cr.maxy, w: cr.maxx - cr.minx, h: cr.maxy - cr.miny }
      : meta.caseBoxPx
    let realPath = join(REF, '1-charms-real-image', photo)
    try {
      await access(realPath, constants.F_OK)
    } catch {
      // tracking lists the photo as .jpg but some sources are .png (or vice-versa)
      realPath = realPath.replace(/\.jpg$/i, '.png')
    }
    const src = sharp(realPath).rotate()
    const full = await src.metadata()
    const S = full.height / DET_H // detection-space -> full-res
    const uniformMmPerDetPx = PRODUCT_W / box.w // width-based, preserves aspect
    const caseBg = await caseColor(realPath, box, S)
    const lum = 0.299 * caseBg[0] + 0.587 * caseBg[1] + 0.114 * caseBg[2]
    // "Is this pixel the case?" tolerance — set high so the flood clears the case
    // AND the soft shadow ring around each charm. Charm interiors are safe via
    // enclosure (their dark outline blocks the flood), so a high tolerance does
    // not eat them; it only removes more of the reachable background.
    const T = lum < 70 ? 95 : 90

    // Deskew: when the case is slightly tilted, work on a straightened copy so
    // the extracted pieces sit upright on the straight app case and the crop
    // frame is axis-aligned. `work.map` sends a full-res EXIF point into the
    // straightened buffer; with tilt≈0 it is identity (original behaviour).
    const tilt = (cr && cr.tilt) || 0
    const work = await makeWork(realPath, tilt)
    const caseCenF = work.map(((box.minx + box.maxx) / 2) * S, ((box.miny + box.maxy) / 2) * S)
    const caseWf = box.w * S, caseHf = box.h * S

    await mkdir(join(OUT, base), { recursive: true })
    const charms = []
    for (const p of pieces) {
      const padFracX = p.pixelBox.w * PAD, padFracY = p.pixelBox.h * PAD
      const dW = p.pixelBox.w + 2 * padFracX
      const dH = p.pixelBox.h + 2 * padFracY
      // piece centre in full-res EXIF coords -> straightened buffer coords
      const cenF = work.map((p.pixelBox.x + p.pixelBox.w / 2) * S, (p.pixelBox.y + p.pixelBox.h / 2) * S)
      let cw = Math.round(dW * S)
      let ch = Math.round(dH * S)
      let left = Math.round(cenF[0] - cw / 2)
      let top = Math.round(cenF[1] - ch / 2)
      left = Math.max(0, left); top = Math.max(0, top)
      cw = Math.min(work.W - left, cw); ch = Math.min(work.H - top, ch)
      if (cw < 4 || ch < 4) continue
      // cap processing size for speed; the saved PNG only needs display res
      const procW = Math.min(cw, 560)
      const procScale = procW / cw
      const crop = await sharp(work.buf).extract({ left, top, width: cw, height: ch })
        .resize({ width: procW }).png().toBuffer()
      const pw = procW, ph = Math.round(ch * procScale)
      const res = await removeBgDepth(crop, pw, ph, caseBg, T)

      // size of the real charm — distinguishes a genuine piece from detection
      // noise (case-coloured specks/slivers the detector over-segmented, which
      // extract to almost nothing)
      const longMm = Math.max(p.mmW || 0, p.mmH || 0)
      const minMm = Math.min(p.mmW || 0, p.mmH || 0)
      const realCharm = minMm >= 4 && longMm >= 7
      if (!realCharm && res.keptFrac < 0.04) continue
      await writeFile(join(OUT, base, `${p.id}.png`), res.buf)

      // centre of the box -> case fraction (computed in the straightened frame)
      const cxFrac = (cenF[0] - caseCenF[0]) / caseWf + 0.5
      const cyFrac = (cenF[1] - caseCenF[1]) / caseHf + 0.5
      charms.push({
        id: `${base}-${p.id}`,
        pid: p.id,
        src: `/_demo/pieces/${base}/${p.id}.png`,
        name: p.id,
        category: p.category || 'gold',
        type: 2,
        cxMm: +(cxFrac * PRODUCT_W).toFixed(2),
        cyMm: +(cyFrac * PRODUCT_H).toFixed(2),
        // crop size in mm at a single uniform scale (no aspect distortion)
        wMm: +(dW * uniformMmPerDetPx).toFixed(2),
        hMm: +(dH * uniformMmPerDetPx).toFixed(2),
        rot: 0,
      })
    }
    photos.push({ photo, productId: PRODUCT_ID, caseColourId: 'black', charms })
    console.log(`${base}  ${charms.length} pieces  (S=${S.toFixed(3)}, caseBg=${caseBg.join(',')}, T=${T})`) // eslint-disable-line
  }

  const out = {
    generatedAt: new Date().toISOString(),
    productId: PRODUCT_ID,
    caseColourId: 'black',
    authored: true,
    source: 'extract-precise-pieces.mjs — real pixels cut from 1-charms-real-image',
    photos,
  }
  await mkdir(join(PUBLIC, '_demo'), { recursive: true })
  await writeFile(join(PUBLIC, '_demo', 'layouts.json'), JSON.stringify(out, null, 2))
  console.log(`\nwrote public/_demo/layouts.json with ${photos.length} photos`) // eslint-disable-line
}

main()
