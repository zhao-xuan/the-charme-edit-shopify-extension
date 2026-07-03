/**
 * extract-preset-layouts.mjs
 * -------------------------------------------------------------------------
 * Digitises each of the 15 web "custom phone case" design renders in
 * reference/presets/<handle>.png into a seedable customizer layout:
 *   { productId, caseColourId, gelColourId, charms:[{src,name,category,type,
 *     price,cxMm,cyMm,wMm,hMm,rot}] }
 * writing reference/presets/layouts.json (keyed by handle).
 *
 * The renders are clean, uniform-background flat-lays of ONE upright iPhone 16
 * Pro Max case (white or black) with charms glued on the back, so a
 * background-difference segmentation is reliable:
 *   1. sample the cream background from the 4 corners
 *   2. foreground mask (≠ bg) → largest component bbox = the case outer rect
 *   3. classify case white/black by interior lightness; estimate body colour
 *   4. charm mask = case-interior pixels that differ from the body colour
 *      (colour distance / saturation / lightness), camera island zeroed out
 *   5. connected components → per charm: centre, oriented box (moments angle),
 *      dominant colour → category → nearest catalogue art by long-edge mm
 *   6. map case-box fractions → mm on the 80.6×166 footprint
 *
 * Best-effort by design (positions/size/rotation accurate; charm identity is a
 * nearest-size match within the colour-derived category) — the customer refines
 * in the editor. `--debug` writes overlay images + a montage to /tmp.
 *
 * Run: node scripts/extract-preset-layouts.mjs [--debug]
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESIGNS } from './fetch-preset-renders.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PRESETS = join(ROOT, 'reference', 'presets')
const DEBUG = process.argv.includes('--debug')

const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166
const WORK_H = 1500 // working resolution (case fills most of the frame height)

// ---- small helpers --------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  let h = 0, s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}
const colDist = (r, g, b, R, G, B) => Math.sqrt((r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2)

// 1-D box dilate/erode (separable morphology, square structuring element).
function morph1D(src, W, H, r, mode) {
  const out = new Uint8Array(W * H)
  const pick = mode === 'dilate' ? Math.max : Math.min
  // horizontal
  const tmp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      let v = mode === 'dilate' ? 0 : 255
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= W) continue
        v = pick(v, src[row + xx])
      }
      tmp[row + x] = v
    }
  }
  // vertical
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = mode === 'dilate' ? 0 : 255
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        v = pick(v, tmp[yy * W + x])
      }
      out[y * W + x] = v
    }
  }
  return out
}
const dilate = (m, W, H, r) => morph1D(m, W, H, r, 'dilate')
const erode = (m, W, H, r) => morph1D(m, W, H, r, 'erode')

// Connected components (4/8-conn) on a Uint8 mask → { labels, comps[] }.
function connectedComponents(mask, W, H) {
  const labels = new Int32Array(W * H).fill(0)
  const comps = []
  const stack = new Int32Array(W * H)
  let cur = 0
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || labels[i]) continue
    cur++
    let sp = 0
    stack[sp++] = i
    labels[i] = cur
    let area = 0, sx = 0, sy = 0, minx = W, miny = H, maxx = 0, maxy = 0
    const px = []
    while (sp) {
      const p = stack[--sp]
      const y = (p / W) | 0, x = p - y * W
      area++; sx += x; sy += y; px.push(p)
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const q = yy * W + xx
        if (mask[q] && !labels[q]) { labels[q] = cur; stack[sp++] = q }
      }
    }
    comps.push({ label: cur, area, cx: sx / area, cy: sy / area, minx, miny, maxx, maxy, px })
  }
  return { labels, comps }
}

// Oriented box + angle from second moments of a component's pixels.
function orientedBox(px, W) {
  let n = px.length, sx = 0, sy = 0
  for (const p of px) { const y = (p / W) | 0; sx += p - y * W; sy += y }
  const cx = sx / n, cy = sy / n
  let mxx = 0, myy = 0, mxy = 0
  for (const p of px) { const y = (p / W) | 0, x = p - y * W, dx = x - cx, dy = y - cy; mxx += dx * dx; myy += dy * dy; mxy += dx * dy }
  mxx /= n; myy /= n; mxy /= n
  const theta = 0.5 * Math.atan2(2 * mxy, mxx - myy) // major-axis angle (rad, y-down)
  const c = Math.cos(theta), s = Math.sin(theta)
  let lmin = 1e9, lmax = -1e9, smin = 1e9, smax = -1e9
  for (const p of px) {
    const y = (p / W) | 0, x = p - y * W, dx = x - cx, dy = y - cy
    const u = dx * c + dy * s, v = -dx * s + dy * c
    if (u < lmin) lmin = u; if (u > lmax) lmax = u
    if (v < smin) smin = v; if (v > smax) smax = v
  }
  const long = lmax - lmin, short = smax - smin
  const eig1 = (mxx + myy) / 2 + Math.sqrt(((mxx - myy) / 2) ** 2 + mxy * mxy)
  const eig2 = (mxx + myy) / 2 - Math.sqrt(((mxx - myy) / 2) ** 2 + mxy * mxy)
  const elong = Math.sqrt(Math.max(eig1, 1e-6) / Math.max(eig2, 1e-6))
  return { cx, cy, long: Math.max(long, short), short: Math.min(long, short), thetaDeg: (theta * 180) / Math.PI, elong }
}

function categoryOf(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  if (s > 0.22 && h >= 28 && h <= 62 && l > 0.28 && l < 0.82) return 'gold'
  if (s > 0.34) return 'colourful'
  if (s < 0.14 && l >= 0.42 && l <= 0.86) return 'silver'
  return 'unique'
}

async function processDesign(handle, catalog) {
  const file = join(PRESETS, `${handle}.png`)
  if (!existsSync(file)) return null
  const img = sharp(file).rotate()
  const meta = await img.metadata()
  const scale = WORK_H / meta.height
  const W = Math.round(meta.width * scale), H = WORK_H
  const { data } = await img.resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]] }

  // 1. background from the four corners (median of small patches)
  const corner = (x0, y0) => { const rs = [], gs = [], bs = []; for (let y = y0; y < y0 + 40; y++) for (let x = x0; x < x0 + 40; x++) { const [r, g, b] = at(x, y); rs.push(r); gs.push(g); bs.push(b) }; const md = (a) => a.sort((p, q) => p - q)[a.length >> 1]; return [md(rs), md(gs), md(bs)] }
  const cs = [corner(4, 4), corner(W - 44, 4), corner(4, H - 44), corner(W - 44, H - 44)]
  const bg = [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / cs.length))

  // 2. foreground (≠ bg) → the case. A very white case barely differs from the
  // cream background, but its drop-shadow ring does; a low threshold + heavy
  // close merges shadow + charms + faint body into one case-sized blob. Pick the
  // largest tall component (the case is a tall central object).
  const fg = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) { const j = i * 3; if (colDist(data[j], data[j + 1], data[j + 2], bg[0], bg[1], bg[2]) > 20) fg[i] = 1 }
  const fgClosed = erode(dilate(fg, W, H, 7), W, H, 7)
  const { comps: fgComps } = connectedComponents(fgClosed, W, H)
  if (!fgComps.length) return null
  const tall = fgComps.filter((c) => c.maxy - c.miny > H * 0.45 && c.maxx - c.minx > W * 0.12)
  const pool = tall.length ? tall : fgComps
  const bboxArea = (c) => (c.maxx - c.minx) * (c.maxy - c.miny)
  const caseComp = pool.reduce((a, b) => (bboxArea(b) > bboxArea(a) ? b : a))
  // trim the soft drop-shadow margin (~1.5% each side)
  const mx = Math.round((caseComp.maxx - caseComp.minx) * 0.012)
  const my = Math.round((caseComp.maxy - caseComp.miny) * 0.012)
  const box = { minx: caseComp.minx + mx, miny: caseComp.miny + my, maxx: caseComp.maxx - mx, maxy: caseComp.maxy - my }
  box.w = box.maxx - box.minx; box.h = box.maxy - box.miny

  // 3. case colour + body colour (sampled from the case interior, away from edges)
  const inx0 = box.minx + box.w * 0.15, inx1 = box.maxx - box.w * 0.15
  const iny0 = box.miny + box.h * 0.4, iny1 = box.maxy - box.h * 0.08 // below the camera zone
  const lums = []
  for (let y = iny0; y < iny1; y += 3) for (let x = inx0; x < inx1; x += 3) { const [r, g, b] = at(x | 0, y | 0); lums.push((r + g + b) / 3) }
  lums.sort((a, b) => a - b)
  const medLum = lums[lums.length >> 1]
  const isWhite = medLum > 120
  // body colour = median of the brightest (white case) or darkest (black case) interior pixels
  const bodyPx = []
  for (let y = iny0; y < iny1; y += 2) for (let x = inx0; x < inx1; x += 2) { const [r, g, b] = at(x | 0, y | 0); const L = (r + g + b) / 3; if (isWhite ? L > medLum - 8 : L < medLum + 8) bodyPx.push([r, g, b]) }
  const bodyMed = [0, 1, 2].map((k) => { const a = bodyPx.map((p) => p[k]).sort((p, q) => p - q); return a[a.length >> 1] })

  // 4. charm mask inside the case, camera island zeroed. Marbled/pearlescent
  // white cases have veins whose contrast rivals pale charms, so a fixed
  // threshold either misses charms or bridges them all into one blob. Detect
  // adaptively: tighten until the largest component stops spanning the case.
  const camX0 = box.minx - box.w * 0.02, camX1 = box.minx + box.w * 0.58
  const camY0 = box.miny, camY1 = box.miny + box.h * 0.33
  const pad = 0.035
  const bx0 = box.minx + box.w * pad, bx1 = box.maxx - box.w * pad
  const by0 = box.miny + box.h * pad, by1 = box.maxy - box.h * pad
  const bL = (bodyMed[0] + bodyMed[1] + bodyMed[2]) / 3
  const cr = isWhite ? 1 : 2
  const caseArea = box.w * box.h

  const buildComps = (bump) => {
    const mask = new Uint8Array(W * H)
    for (let y = by0 | 0; y < by1; y++) for (let x = bx0 | 0; x < bx1; x++) {
      if (x >= camX0 && x <= camX1 && y >= camY0 && y <= camY1) continue
      const [r, g, b] = at(x, y)
      if (colDist(r, g, b, bg[0], bg[1], bg[2]) < 24) continue // still background
      const [, s] = rgbToHsl(r, g, b)
      const L = (r + g + b) / 3
      const dBody = colDist(r, g, b, bodyMed[0], bodyMed[1], bodyMed[2])
      let isCharm
      if (isWhite) isCharm = L < bL - (22 + bump) || s > 0.14 + bump / 200 || dBody > 32 + bump
      else isCharm = L > bL + (32 + bump) || s > 0.16 + bump / 200 || dBody > 46 + bump
      if (isCharm) mask[y * W + x] = 1
    }
    const closed = erode(dilate(mask, W, H, cr), W, H, cr)
    const maskClean = dilate(erode(closed, W, H, 1), W, H, 1)
    return connectedComponents(maskClean, W, H).comps
  }

  // 5. components → charms (adaptive)
  let comps = []
  for (const bump of [0, 6, 12, 18, 24, 32, 40]) {
    comps = buildComps(bump)
    const maxArea = comps.reduce((m, c) => Math.max(m, c.area), 0)
    if (!comps.length || maxArea < caseArea * 0.22) break
  }
  const minArea = caseArea * 0.0011
  const charmComps = comps.filter((c) => c.area >= minArea && (c.maxx - c.minx) < box.w * 0.85 && (c.maxy - c.miny) < box.h * 0.55)

  const mmPerPxX = PRODUCT_W / box.w
  const mmPerPxY = PRODUCT_H / box.h
  const mmPerPx = (mmPerPxX + mmPerPxY) / 2

  // catalogue indexed by category, sorted by long-edge mm
  const bySizeCat = {}
  for (const c of catalog.charms) {
    const long = Math.max(c.widthMm, c.heightMm)
    ;(bySizeCat[c.category] ||= []).push({ ...c, long })
  }
  for (const k in bySizeCat) bySizeCat[k].sort((a, b) => a.long - b.long)
  const nearestArt = (cat, mm) => {
    const pool = bySizeCat[cat] && bySizeCat[cat].length ? bySizeCat[cat] : catalog.charms.map((c) => ({ ...c, long: Math.max(c.widthMm, c.heightMm) }))
    return pool.reduce((best, c) => (Math.abs(c.long - mm) < Math.abs(best.long - mm) ? c : best))
  }

  const charms = []
  for (const comp of charmComps) {
    const ob = orientedBox(comp.px, W)
    // dominant colour = median over the component pixels
    const rs = [], gs = [], bs = []
    for (let k = 0; k < comp.px.length; k += 3) { const p = comp.px[k]; const y = (p / W) | 0, x = p - y * W; const [r, g, b] = at(x, y); rs.push(r); gs.push(g); bs.push(b) }
    const md = (a) => a.sort((p, q) => p - q)[a.length >> 1]
    const dom = [md(rs), md(gs), md(bs)]
    const category = categoryOf(dom[0], dom[1], dom[2])

    const longMm = ob.long * mmPerPx
    const shortMm = ob.short * mmPerPx
    const elongated = ob.elong > 1.5 && longMm > 6
    const art = nearestArt(category, longMm)

    const fracX = (ob.cx - box.minx) / box.w
    const fracY = (ob.cy - box.miny) / box.h
    let rot = 0, wMm, hMm
    if (elongated) {
      rot = +ob.thetaDeg.toFixed(1)
      wMm = +longMm.toFixed(2); hMm = +shortMm.toFixed(2)
    } else {
      wMm = +((comp.maxx - comp.minx) * mmPerPx).toFixed(2)
      hMm = +((comp.maxy - comp.miny) * mmPerPx).toFixed(2)
    }
    // keep sane physical bounds
    wMm = clamp(wMm, 4, 46); hMm = clamp(hMm, 4, 46)

    charms.push({
      charmId: art.id,
      src: art.src,
      name: art.name,
      category,
      type: art.type ?? 2,
      price: art.price ?? 3,
      cxMm: +(clamp(fracX, 0.02, 0.98) * PRODUCT_W).toFixed(2),
      cyMm: +(clamp(fracY, 0.02, 0.98) * PRODUCT_H).toFixed(2),
      wMm, hMm, rot,
      _px: { cx: ob.cx, cy: ob.cy, long: ob.long, short: ob.short, theta: ob.thetaDeg, elong: ob.elong, box: [comp.minx, comp.miny, comp.maxx, comp.maxy] },
    })
  }
  charms.sort((a, b) => a.cyMm - b.cyMm || a.cxMm - b.cxMm)

  const layout = {
    productId: PRODUCT_ID,
    caseColourId: isWhite ? 'white' : 'black',
    gelColourId: isWhite ? 'glitter' : 'black',
    charms: charms.map(({ _px, ...c }) => c),
  }
  return { handle, isWhite, box, W, H, bg, layout, charms }
}

// ---- debug overlay --------------------------------------------------------
async function overlay(res) {
  const { handle, box, W, H, charms } = res
  const ow = 560, k = ow / W, oh = Math.round(H * k)
  const r2 = (v) => Math.round(v * k)
  const svgParts = [`<rect x="${r2(box.minx)}" y="${r2(box.miny)}" width="${r2(box.w)}" height="${r2(box.h)}" fill="none" stroke="lime" stroke-width="2"/>`]
  charms.forEach((c, i) => {
    const [x0, y0, x1, y1] = c._px.box
    svgParts.push(`<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(x1 - x0)}" height="${r2(y1 - y0)}" fill="none" stroke="red" stroke-width="1.5"/>`)
    svgParts.push(`<text x="${r2(c._px.cx)}" y="${r2(c._px.cy)}" fill="cyan" font-size="13" font-family="sans-serif">${i}</text>`)
  })
  const svg = `<svg width="${ow}" height="${oh}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`
  const base = await sharp(join(PRESETS, `${handle}.png`)).rotate().resize(ow, oh, { fit: 'fill' }).toBuffer()
  const out = join('/tmp', 'preset-overlays', `${handle}.jpg`)
  await mkdir(dirname(out), { recursive: true })
  await sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 74 }).toFile(out)
  return out
}

async function main() {
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
  const layouts = {}
  const overlays = []
  for (const [handle] of DESIGNS) {
    const res = await processDesign(handle, catalog)
    if (!res) { console.error(`SKIP ${handle} (no render)`); continue } // eslint-disable-line
    layouts[handle] = res.layout
    console.log(`${handle.padEnd(42)} ${res.isWhite ? 'white' : 'black'}  ${res.layout.charms.length} charms`) // eslint-disable-line
    if (DEBUG) overlays.push(await overlay(res))
  }
  await writeFile(join(PRESETS, 'layouts.json'), JSON.stringify(layouts, null, 2))
  console.log(`\nwrote reference/presets/layouts.json (${Object.keys(layouts).length} designs)`) // eslint-disable-line

  if (DEBUG && overlays.length) {
    const cell = 560, cols = 5, rows = Math.ceil(overlays.length / cols), pad = 6
    const Wm = cols * (cell + pad) + pad, Hm = rows * (cell + pad) + pad
    const comps = []
    for (let i = 0; i < overlays.length; i++) {
      const buf = await sharp(overlays[i]).resize(cell, cell, { fit: 'contain', background: { r: 40, g: 40, b: 40 } }).toBuffer()
      comps.push({ input: buf, left: pad + (i % cols) * (cell + pad), top: pad + ((i / cols) | 0) * (cell + pad) })
    }
    await sharp({ create: { width: Wm, height: Hm, channels: 3, background: { r: 90, g: 90, b: 90 } } }).composite(comps).jpeg({ quality: 68 }).toFile('/tmp/preset-extract-montage.jpg')
    console.log('wrote /tmp/preset-extract-montage.jpg') // eslint-disable-line
  }
}

main()
