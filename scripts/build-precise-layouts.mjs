/**
 * build-precise-layouts.mjs
 * -------------------------------------------------------------------------
 * Pixel-accurate reproduction of every reference photo's charm arrangement on a
 * BLACK iPhone 16 Pro Max, for the live customizer (window.__charmeSeedLayout).
 *
 * Position + size come straight from the MEASURED boxes in
 * reference/pieces-tracking.json — the very boxes drawn in reference/5-pieces-
 * bordered/. `pixelBox.{x,y}` is the TOP-LEFT corner (minx,miny) in the photo's
 * downscaled detection space; `caseBoxPx` is the case outer in the same space.
 *   pieceCenter   = (x + w/2, y + h/2)
 *   centreFrac    = (pieceCenter - caseBox.min) / caseBox.size
 *   boxFrac(w,h)  = pixelBox.{w,h} / caseBox.{w,h}
 *
 * Identity comes from reference/piece-identities.json (hand-read off the bordered
 * images — the manifest's categoryName/nearestCutout are unreliable). Each entry
 * maps a photo's P-id to a catalogue charm by full `id`, `n` (suffix of the
 * 7561dd4b gold reference set) or `name`.
 *
 * The catalogue art PNGs carry a few % of transparent padding and may be a touch
 * off-centre, so to make the VISIBLE charm fill the detected box we inflate the
 * placed box by the art's fill factor and nudge the centre by its content offset:
 *   baseWmm = boxMmW * (canvasW / contentW)
 *   cxMm    = boxCentreMmX + (0.5 - contentCentreFracX) * baseWmm
 * which lands each charm's silhouette exactly on its red box.
 *
 * Run: node scripts/build-precise-layouts.mjs
 * Output: public/_demo/layouts.json
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWork } from './_deskew.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')

const PRODUCT_ID = 'iphone-16-pro-max'
const PRODUCT_W = 80.6
const PRODUCT_H = 166
const CASE_COLOUR = 'black'
const DET_H = 1800 // detection space height (case-rects.json + pixelBox are in this space)
const REF = join(ROOT, 'reference')
const exists = async (p) => { try { await access(p, constants.F_OK); return true } catch { return false } }

// cache of art content-bounds + mean colour so each PNG is scanned once
const artCache = new Map()
async function artBounds(src) {
  if (artCache.has(src)) return artCache.get(src)
  const file = join(PUBLIC, src)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  let minx = W, miny = H, maxx = 0, maxy = 0
  let sr = 0, sg = 0, sb = 0, n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * C
      if (data[o + 3] > 60) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
        sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; n++
      }
    }
  }
  const cw = maxx - minx + 1
  const ch = maxy - miny + 1
  const b = {
    W,
    H,
    fillX: cw / W,
    fillY: ch / H,
    // fraction of the canvas at which the content centre sits
    cFracX: (minx + maxx + 1) / 2 / W,
    cFracY: (miny + maxy + 1) / 2 / H,
    // mean opaque colour (for matching a piece's real colour to the best art)
    rgb: n ? [sr / n, sg / n, sb / n] : [128, 128, 128],
    // SHAPE descriptors (to disambiguate same-name metallic arts, where colour
    // is useless): aspect = content w/h; solidity = opaque fill of the content
    // bbox (a spiky sunburst ≈0.4, a solid disc/face ≈0.7).
    aspect: cw / ch,
    solidity: n / (cw * ch),
  }
  artCache.set(src, b)
  return b
}

// median colour of a piece, sampled from the straightened (deskewed) real
// photo over most of its (tight) detection box but EXCLUDING pixels close to the
// case background — so the charm's dominant colour wins (e.g. a frangipani's
// white petals, not just its small yellow centre) without picking up the tray.
// Falls back to a tight central median when almost everything reads as
// background (white-charm-on-white-case), where exclusion would leave nothing.
function samplePieceColour(wpx, W, H, C, map, S, pb, bg) {
  const x0 = pb.x * S, y0 = pb.y * S, bw = pb.w * S, bh = pb.h * S
  const med = (a) => { if (!a.length) return 128; a.sort((p, q) => p - q); return a[a.length >> 1] }
  const grid = (lo, span, useBg) => {
    const rs = [], gs = [], bs = []
    const N = 12
    for (let iy = 0; iy <= N; iy++) {
      for (let ix = 0; ix <= N; ix++) {
        const [mx, my] = map(x0 + (lo + span * ix / N) * bw, y0 + (lo + span * iy / N) * bh)
        const xi = Math.round(mx), yi = Math.round(my)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue
        const o = (yi * W + xi) * C
        if (useBg && bg && Math.hypot(wpx[o] - bg[0], wpx[o + 1] - bg[1], wpx[o + 2] - bg[2]) < 40) continue
        rs.push(wpx[o]); gs.push(wpx[o + 1]); bs.push(wpx[o + 2])
      }
    }
    return rs.length ? [med(rs), med(gs), med(bs), rs.length] : null
  }
  // central tight median (overwhelmingly charm, no background) — the primary,
  // verified-robust estimate used to match a piece to its best-coloured art.
  const tight = grid(0.28, 0.44, false)
  return tight ? [tight[0], tight[1], tight[2]] : [128, 128, 128]
}

// median colour of the whole case rect = the background (cream tray / black
// case), used to tell charm pixels from background when measuring a piece's
// silhouette solidity.
function sampleCaseBg(wpx, W, H, C, map, S, cr) {
  const rs = [], gs = [], bs = []
  const N = 22
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const [mx, my] = map((cr.minx + (cr.maxx - cr.minx) * i / N) * S, (cr.miny + (cr.maxy - cr.miny) * j / N) * S)
      const xi = Math.round(mx), yi = Math.round(my)
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue
      const o = (yi * W + xi) * C
      rs.push(wpx[o]); gs.push(wpx[o + 1]); bs.push(wpx[o + 2])
    }
  }
  const med = (a) => { if (!a.length) return 128; a.sort((p, q) => p - q); return a[a.length >> 1] }
  return [med(rs), med(gs), med(bs)]
}

// fraction of a piece's box that is "charm" (colour far from the case bg) —
// the piece's measured SOLIDITY, comparable to an art's solidity. A spiky
// sunburst comes out low (~0.4), a solid disc high (~0.7). Robust because the
// detection box is tight around the charm.
function samplePieceSolidity(wpx, W, H, C, map, S, pb, bg) {
  const x0 = pb.x * S, y0 = pb.y * S, bw = pb.w * S, bh = pb.h * S
  let charm = 0, tot = 0
  const N = 22
  for (let iy = 0; iy <= N; iy++) {
    for (let ix = 0; ix <= N; ix++) {
      const [mx, my] = map(x0 + bw * ix / N, y0 + bh * iy / N)
      const xi = Math.round(mx), yi = Math.round(my)
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue
      const o = (yi * W + xi) * C
      tot++
      if (Math.hypot(wpx[o] - bg[0], wpx[o + 1] - bg[1], wpx[o + 2] - bg[2]) > 50) charm++
    }
  }
  return tot ? charm / tot : 0.5
}

const colourDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const chroma = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])

async function main() {
  const tracking = JSON.parse(await readFile(join(ROOT, 'reference', 'pieces-tracking.json'), 'utf8'))
  const ids = JSON.parse(await readFile(join(ROOT, 'reference', 'piece-identities.json'), 'utf8'))
  const catalog = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'))
  // Accurate per-photo case rectangle + tilt (DET space) from build-case-rects.mjs.
  const caseRects = JSON.parse(await readFile(join(REF, 'case-rects.json'), 'utf8'))
  const byId = new Map(catalog.charms.map((c) => [c.id, c]))
  const GOLD = ids.GOLD

  // name (lower-case) -> every catalogue art that shares that name. Many names
  // have several distinct arts (Natural Shell x18, Natural Stone x24, Colourful
  // Rose x8, ...); we pick the best-matching one per piece instead of always
  // the first, so a case of 18 shells shows 18 different shells like the photo.
  const byName = new Map()
  for (const c of catalog.charms) {
    const k = c.name.toLowerCase()
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(c)
  }

  const resolve = (ref) => {
    if (!ref) return null
    if (typeof ref === 'string') {
      // "name" or "n:NN" or "id:..."
      if (ref.startsWith('n:')) return byId.get(`${GOLD}-${ref.slice(2)}`)
      if (ref.startsWith('id:')) return byId.get(ref.slice(3))
      return (
        catalog.charms.find((c) => c.name === ref) ||
        catalog.charms.find((c) => c.name.toLowerCase() === ref.toLowerCase())
      )
    }
    if (ref.id) return byId.get(ref.id)
    if (ref.n) return byId.get(`${GOLD}-${ref.n}`)
    if (ref.name) return catalog.charms.find((c) => c.name === ref.name)
    return null
  }

  // Candidate list for a ref: exact (n:/id:) refs stay pinned to one art; a
  // plain name returns every art sharing that name (for colour-matching).
  const candidatesFor = (ref) => {
    if (typeof ref === 'string' && !ref.startsWith('n:') && !ref.startsWith('id:')) {
      const list = byName.get(ref.toLowerCase())
      if (list && list.length) return list
    }
    const one = resolve(ref)
    return one ? [one] : []
  }

  // Score how well an art matches a piece, combining COLOUR and SHAPE:
  //  - metallic charms (gold/silver) are all the same colour, so SHAPE decides
  //    (aspect + solidity: a spiky sunburst vs a solid medallion);
  //  - natural/colourful charms vary in colour, so COLOUR decides, with shape
  //    only breaking near-ties.
  const scoreArt = (feat, art) => {
    const metal = feat.category === 'gold' || feat.category === 'silver'
    const wCol = metal ? 0.15 : 1.0
    const wAsp = metal ? 130 : 60
    const wSol = metal ? 240 : 90
    const a = artCache.get(art.src)
    let s = 0
    if (a) {
      s += wCol * colourDist(feat.rgb, a.rgb)
      s += wAsp * Math.abs(a.aspect - feat.aspect)
      s += wSol * Math.abs(a.solidity - feat.solidity)
      // chroma (saturation) match — a near-grey/white piece (e.g. a translucent
      // MOP flower that samples dark on the black case, or a white shell) must
      // not be handed a vividly-coloured art just because plain RGB distance is
      // ambiguous. Only for non-metals (metallic colour is meaningless noise).
      if (!metal) s += 0.7 * Math.abs(chroma(feat.rgb) - chroma(a.rgb))
    }
    return s
  }
  // per-photo reuse penalty: spreads distinct arts across same-name pieces for
  // photo-like variety (strong for naturals; lighter for metals — but still
  // enough that two near-identical-solidity pieces spread across similar-shape
  // arts rather than collapsing onto one, while too small to jump to a
  // genuinely wrong shape, which sits far away in the shape score).
  const reuseOf = (feat) => (feat.category === 'gold' || feat.category === 'silver' ? 22 : 45)

  // GLOBAL best-first assignment of arts to a group of pieces that share the
  // same candidate set. Instead of a left-to-right greedy (which lets an
  // ambiguous piece grab a distinctive art first, forcing a later well-matched
  // piece onto the wrong art — e.g. a white shell taking the teal art so the
  // real teal shell is left with pink), we repeatedly commit the single
  // (piece, art) pair with the lowest cost across ALL unassigned pieces. The
  // most confident colour/shape matches win first; the reuse penalty then only
  // affects whoever is left, so coloured pieces land on their colour and any
  // unavoidable repeats fall to the least-distinct pieces.
  const assignGroup = (group) => {
    const used = new Map() // art.id -> times used
    const result = new Map() // pid -> art
    const remaining = new Set(group.map((g) => g.pid))
    const byPid = new Map(group.map((g) => [g.pid, g]))
    // Per-piece BEST colour distance. For non-metals we then forbid arts whose
    // colour is much farther than the piece's best match — so the reuse penalty
    // can spread among similarly-coloured arts for variety, but can NEVER push a
    // piece onto a clearly wrong-coloured art (e.g. a white flower onto the one
    // yellow flower art) just to avoid repeating. Each piece's own best art
    // always passes its gate, so nobody is ever stranded.
    const COLOUR_GATE = 40
    const bestCol = new Map()
    for (const g of group) {
      const metal = g.feat.category === 'gold' || g.feat.category === 'silver'
      if (metal) { bestCol.set(g.pid, Infinity); continue }
      let m = Infinity
      for (const art of g.cands) { const a = artCache.get(art.src); if (a) { const d = colourDist(g.feat.rgb, a.rgb); if (d < m) m = d } }
      bestCol.set(g.pid, m)
    }
    while (remaining.size) {
      let bestPid = null, bestArt = null, bestCost = Infinity
      for (const pid of remaining) {
        const g = byPid.get(pid)
        const metal = g.feat.category === 'gold' || g.feat.category === 'silver'
        for (const art of g.cands) {
          const a = artCache.get(art.src)
          let cost = scoreArt(g.feat, art) + reuseOf(g.feat) * (used.get(art.id) || 0)
          if (!metal && a && colourDist(g.feat.rgb, a.rgb) - bestCol.get(pid) > COLOUR_GATE) cost += 1000
          if (cost < bestCost) { bestCost = cost; bestPid = pid; bestArt = art }
        }
      }
      result.set(bestPid, bestArt)
      used.set(bestArt.id, (used.get(bestArt.id) || 0) + 1)
      remaining.delete(bestPid)
    }
    return result
  }

  const photoMeta = new Map(tracking.photos.map((p) => [p.photo, p]))
  const byPhoto = new Map()
  for (const p of tracking.pieces) {
    if (!byPhoto.has(p.photo)) byPhoto.set(p.photo, [])
    byPhoto.get(p.photo).push(p)
  }

  const photos = []
  for (const [photo, idMap] of Object.entries(ids.photos)) {
    const meta = photoMeta.get(photo)
    const pieces = byPhoto.get(photo)
    const base = photo.replace(/\.(jpe?g|png)$/i, '')
    const cr = caseRects[base]
    if (!meta || !cr || !pieces) {
      console.log(`SKIP ${photo}: no tracking/case-rect data`) // eslint-disable-line
      continue
    }
    // accurate case rect (DET space) + tilt
    const box = { minx: cr.minx, miny: cr.miny, maxx: cr.maxx, maxy: cr.maxy, w: cr.maxx - cr.minx, h: cr.maxy - cr.miny }
    const tilt = cr.tilt || 0
    // straighten the photo so positions are computed in the upright frame
    let realPath = join(REF, '1-charms-real-image', base + '.jpg')
    if (!(await exists(realPath))) realPath = realPath.replace(/\.jpg$/i, '.png')
    const full = await sharp(realPath).rotate().metadata()
    const S = full.height / DET_H // detection-space -> full-res
    const work = await makeWork(realPath, tilt)
    // raw pixels of the straightened photo, to sample each piece's real colour
    const { data: wpx, info: winfo } = await sharp(work.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const WW = winfo.width, WH = winfo.height, WC = winfo.channels
    const caseBg = sampleCaseBg(wpx, WW, WH, WC, work.map, S, box) // background colour (for piece solidity)
    const caseCenF = work.map(((box.minx + box.maxx) / 2) * S, ((box.miny + box.maxy) / 2) * S)
    const caseWf = box.w * S, caseHf = box.h * S
    const byPid = new Map(pieces.map((p) => [p.id, p]))
    const charms = []

    // PASS 1 — resolve candidates + measure each piece's colour/shape from the
    // real photo (only for multi-art identities; single-art refs need no feature).
    const entries = [] // { pid, p, cands, feat }
    for (const [pid, ref] of Object.entries(idMap)) {
      const p = byPid.get(pid)
      if (!p) {
        console.log(`  ${photo} ${pid}: no such piece in tracking`) // eslint-disable-line
        continue
      }
      const cands = candidatesFor(ref)
      if (!cands.length) {
        console.log(`  ${photo} ${pid}: unresolved identity ${JSON.stringify(ref)}`) // eslint-disable-line
        continue
      }
      let feat = null
      if (cands.length > 1) {
        for (const c of cands) await artBounds(c.src) // ensure descriptors cached
        const rgb = samplePieceColour(wpx, WW, WH, WC, work.map, S, p.pixelBox, caseBg)
        const solidity = samplePieceSolidity(wpx, WW, WH, WC, work.map, S, p.pixelBox, caseBg)
        const aspect = p.pixelBox.w / p.pixelBox.h
        feat = { rgb, solidity, aspect, category: cands[0].category }
      }
      entries.push({ pid, p, cands, feat })
    }

    // PASS 2 — assign an art to every piece. Pieces sharing a candidate set are
    // assigned together via global best-first matching (so each distinctive art
    // goes to its best-matching piece, with repeats only where unavoidable);
    // single-art identities are assigned directly.
    const pidToArt = new Map()
    const groups = new Map()
    for (const e of entries) {
      if (e.cands.length === 1) { pidToArt.set(e.pid, e.cands[0]); continue }
      const key = e.cands.map((c) => c.id).join(',')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    for (const group of groups.values()) {
      for (const [pid, art] of assignGroup(group)) pidToArt.set(pid, art)
    }

    // PASS 3 — place each piece's chosen art at its measured position/size.
    for (const { pid, p } of entries) {
      const cat = pidToArt.get(pid)
      if (!cat) continue
      // piece centre (full-res EXIF) -> straightened buffer -> case fraction
      const cenF = work.map((p.pixelBox.x + p.pixelBox.w / 2) * S, (p.pixelBox.y + p.pixelBox.h / 2) * S)
      const cxFrac = (cenF[0] - caseCenF[0]) / caseWf + 0.5
      const cyFrac = (cenF[1] - caseCenF[1]) / caseHf + 0.5
      const boxWmm = (p.pixelBox.w / box.w) * PRODUCT_W
      const boxHmm = (p.pixelBox.h / box.h) * PRODUCT_H

      // Size the charm WITHOUT distorting the art: the placed box keeps the art
      // PNG's native aspect (baseHmm = baseWmm * canvasH/canvasW), and we scale
      // it so the visible silhouette's SHORTER edge matches the detected box's
      // shorter edge. Short-edge matching is robust to the occasional merged
      // detection box (a few pieces' boxes run tall where blobs touched), which
      // would otherwise stretch a charm into a giant smear.
      const a = await artBounds(cat.src)
      const canvasAspect = a.H / a.W // h/w of the PNG canvas
      const boxShort = Math.min(boxWmm, boxHmm)
      // visible content edges per 1mm of baseWmm: width = fillX, height = canvasAspect*fillY
      const contentShortPerW = Math.min(a.fillX, canvasAspect * a.fillY)
      const baseWmm = +(boxShort / contentShortPerW).toFixed(2)
      const baseHmm = +(baseWmm * canvasAspect).toFixed(2)
      // place so the art's content centre lands on the box centre
      const cxMm = +(cxFrac * PRODUCT_W + (0.5 - a.cFracX) * baseWmm).toFixed(2)
      const cyMm = +(cyFrac * PRODUCT_H + (0.5 - a.cFracY) * baseHmm).toFixed(2)

      charms.push({
        id: `${photo}-${pid}`,
        pid,
        charmId: cat.id,
        src: cat.src,
        name: cat.name,
        category: cat.category,
        type: cat.type ?? 2,
        cxMm,
        cyMm,
        wMm: baseWmm,
        hMm: baseHmm,
        rot: 0,
      })
    }
    photos.push({ photo, productId: PRODUCT_ID, caseColourId: CASE_COLOUR, charms })
    console.log(`${photo}  ${charms.length} charms`) // eslint-disable-line
  }

  const out = {
    generatedAt: new Date().toISOString(),
    productId: PRODUCT_ID,
    caseColourId: CASE_COLOUR,
    authored: true,
    source: 'pieces-tracking.json (exact boxes) + piece-identities.json (hand-read)',
    photos,
  }
  await mkdir(join(PUBLIC, '_demo'), { recursive: true })
  await writeFile(join(PUBLIC, '_demo', 'layouts.json'), JSON.stringify(out, null, 2))
  console.log(`\nwrote public/_demo/layouts.json with ${photos.length} photos`) // eslint-disable-line
}

main()
