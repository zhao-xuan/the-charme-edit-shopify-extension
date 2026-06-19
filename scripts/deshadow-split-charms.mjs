/**
 * deshadow-split-charms.mjs
 * -------------------------------------------------------------------------
 * Post-processes reference/extracted-charms:
 *   1. removes the soft warm-brown DROP SHADOW around each gold charm (keeps
 *      only the metal: bright OR saturated-gold pixels; the muted mid-tone
 *      shadow is dropped),
 *   2. fills interior crevices back in (so the metal stays solid),
 *   3. re-splits each cut-out into connected components — charms that were only
 *      bridged by their shadows (e.g. the shell + star + bow flat-lay) separate
 *      into individual pieces,
 *   4. re-trims each piece and recomputes its real mm size from the original
 *      file's mm/px scale.
 *
 * Writes the cleaned pieces back to reference/extracted-charms (replacing the
 * shadowed ones) + an updated manifest.json.
 *
 * Run:  node scripts/deshadow-split-charms.mjs
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIR = join(__dirname, '..', 'reference', 'extracted-charms')
const TMP = join(DIR, '_clean')

const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b

// Gold metal is WARM: red noticeably exceeds blue. The cast shadow on the white
// case AND the cream case seen through an open counter are both NEUTRAL (red ≈
// blue) — even when bright — so a brightness test keeps them. We separate purely
// by WARMTH, which drops grey shadow and cream case alike while keeping gold
// (incl. dim gold edges). Bright specular highlights on the gold read neutral
// too, but they sit INSIDE the gold and are recovered later as small holes.
const WARM_MIN = 22 // r - b for plain gold
const DEEP_WARM = 14 // dark warm gold (low light) needs less, gated by darkness

/** Is this pixel warm gold metal (vs neutral grey shadow / cream case)? */
function isMetal(r, g, b) {
  const warm = r - b
  if (warm >= WARM_MIN) return true
  // deep/dim gold in shadow keeps a little warmth while going dark
  if (warm >= DEEP_WARM && lumOf(r, g, b) < 120) return true
  return false
}

/** Legacy loose filter (kept for reference; unused). */
function isMetalLoose(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  const lum = lumOf(r, g, b)
  if (lum > 128) return true
  if (sat > 0.36 && r - b > 26) return true
  return false
}

/** Strict "bright core" test — only the clearly-lit gold body of a piece, used
 *  to SEED the per-piece split. Shadow never qualifies, so distinct charms get
 *  distinct seeds even when their soft shadows bridge them. */
function isCore(r, g, b) {
  const warm = r - b
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  const lum = lumOf(r, g, b)
  if (lum > 138 && warm >= 22) return true
  if (sat > 0.4 && warm >= 34) return true
  return false
}

/** Do two bounding boxes overlap by more than `frac` of the smaller one's area? */
function bboxOverlapsMuch(a, b, frac) {
  const ix = Math.max(0, Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx) + 1)
  const iy = Math.max(0, Math.min(a.maxy, b.maxy) - Math.max(a.miny, b.miny) + 1)
  const inter = ix * iy
  const small = Math.min(a.w * a.h, b.w * b.h)
  return inter > frac * small
}

/** Count of set pixels in a binary mask. */
function metalArea(mask) {
  let n = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++
  return n
}

/** Tight bbox of a binary mask. */
function maskBounds(mask, W, H) {
  let minx = W, miny = H, maxx = -1, maxy = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) {
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
  }
  if (maxx < 0) return null
  return { minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1 }
}

function components(mask, W, H, minArea) {
  const n = W * H
  const labels = new Int32Array(n)
  const stack = new Int32Array(n)
  const comps = []
  let cur = 0
  for (let s = 0; s < n; s++) {
    if (labels[s] || !mask[s]) continue
    cur++
    let sp = 0
    stack[sp++] = s
    labels[s] = cur
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp > 0) {
      const p = stack[--sp]
      area++
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (!labels[q] && mask[q]) { labels[q] = cur; stack[sp++] = q }
      }
    }
    comps.push({ label: cur, bbox: { minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1 }, area })
  }
  return { labels, comps: comps.filter((c) => c.area >= minArea) }
}

/** Fill holes in a binary mask not connected to the image border. */
function fillHoles(mask, W, H) {
  const n = W * H
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const seed = (p) => { if (!outside[p] && !mask[p]) { outside[p] = 1; stack[sp++] = p } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (sp > 0) {
    const p = stack[--sp]
    const x = p % W, y = (p / W) | 0
    if (x > 0) seed(p - 1)
    if (x < W - 1) seed(p + 1)
    if (y > 0) seed(p - W)
    if (y < H - 1) seed(p + W)
  }
  const out = new Uint8Array(n)
  for (let p = 0; p < n; p++) out[p] = mask[p] || !outside[p] ? 1 : 0
  return out
}

function erode(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!m[p]) continue
      if (x > 0 && !m[p - 1]) continue
      if (x < W - 1 && !m[p + 1]) continue
      if (y > 0 && !m[p - W]) continue
      if (y < H - 1 && !m[p + W]) continue
      out[p] = 1
    }
    m = out
  }
  return m
}
function dilate(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (m[p]) { out[p] = 1; continue }
      if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) || (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) out[p] = 1
    }
    m = out
  }
  return m
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Cut-outs that are actually several charms photographed touching, so they must
// be split into individual pieces. (The shell + star + bow flat-lay the merchant
// flagged.) Auto-splitting EVERY charm risks shattering delicate matte pieces
// whose lit highlights look like separate cores, so we split only known multis.
const SPLIT_IDS = new Set(['image-20260618161922-515-813-1'])

const manifest = JSON.parse(await readFile(join(DIR, 'manifest.json'), 'utf8'))
const byId = new Map(manifest.charms.map((c) => [c.id, c]))

await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })

const files = (await readdir(DIR)).filter((f) => /\.png$/i.test(f)).sort()
const outCharms = []
let totalIn = 0, totalOut = 0

for (const file of files) {
  const id = file.replace(/\.png$/i, '')
  const meta = byId.get(id)
  if (!meta) continue
  totalIn++
  const mmPerPx = meta.widthMm / meta.pxW

  const { data, info } = await sharp(join(DIR, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height

  // metal mask from opaque pixels
  let metal = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    if (data[p * 4 + 3] < 40) continue
    if (isMetal(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])) metal[p] = 1
  }
  // Interior regions enclosed by the gold outline are one of three things:
  //   • a small specular highlight / tiny gap in the metal  → fill (keep solid),
  //   • a warm-gold sheen patch on the body                 → fill (keep),
  //   • anything else (the cream/grey CASE through an OPEN COUNTER, a recessed
  //     shadow, a dark centre) → leave TRANSPARENT so hollows read as empty.
  // Letter/number counters (the holes in 9 / Q / O) and key-bow / clover / oval
  // openings all fall in the last bucket and become see-through.
  const enclosed = fillHoles(metal, W, H)
  const holeMask = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (enclosed[p] && !metal[p]) holeMask[p] = 1
  const holes = components(holeMask, W, H, 1)
  const pieceArea = W * H
  const fillLabel = new Uint8Array(holes.comps.length + 1)
  for (const c of holes.comps) {
    let sw = 0, n = 0
    for (let y = c.bbox.miny; y <= c.bbox.maxy; y++) for (let x = c.bbox.minx; x <= c.bbox.maxx; x++) {
      const p = y * W + x
      if (holes.labels[p] !== c.label) continue
      sw += data[p * 4] - data[p * 4 + 2]
      n++
    }
    const meanWarm = n ? sw / n : 0
    const small = c.area < Math.max(36, pieceArea * 0.0012)
    if (small || meanWarm >= 20) fillLabel[c.label] = 1
  }
  const keep = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    if (metal[p]) keep[p] = 1
    else if (holeMask[p] && fillLabel[holes.labels[p]]) keep[p] = 1
  }
  metal = keep

  // FINAL COLOUR PASS — knock out any remaining NEUTRAL-GREY pixels by colour
  // (the desaturated edge halo where gold meets the removed background, plus the
  // cream case seen through a loop/oval that stayed connected to the gold). Gold
  // and brass are warm (r noticeably > b); grey shadow / cream case is neutral.
  // This is the "remove pixels whose colour is grey" pass requested directly.
  const GREY_WARM = 18 // r - b below this is neutral
  const GREY_SAT = 0.24
  for (let p = 0; p < W * H; p++) {
    if (!metal[p]) continue
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (r - b < GREY_WARM && sat < GREY_SAT) metal[p] = 0
  }
  // refill only TINY enclosed gaps this pass may have punched in solid gold
  // (specular highlights), without re-filling the large open counters/centres.
  {
    const enc2 = fillHoles(metal, W, H)
    const hm2 = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) if (enc2[p] && !metal[p]) hm2[p] = 1
    const h2 = components(hm2, W, H, 1)
    const tiny = Math.max(20, Math.round(W * H * 0.0006))
    for (const c of h2.comps) if (c.area <= tiny) for (let y = c.bbox.miny; y <= c.bbox.maxy; y++) for (let x = c.bbox.minx; x <= c.bbox.maxx; x++) { const p = y * W + x; if (h2.labels[p] === c.label) metal[p] = 1 }
  }

  const minArea = Math.max(120, Math.round((W * H) * 0.02))
  const naturally = components(metal, W, H, minArea)
  let labels = naturally.labels
  let compList = naturally.comps

  // Per-piece split: seed from strict bright cores (shadow can't seed), grow each
  // seed over the full metal mask, and only ACCEPT the split when the resulting
  // pieces sit in clearly distinct regions (their boxes barely overlap). A solid
  // single charm yields cores that all fall inside one region → never split; the
  // shell+star+bow flat-lay yields 3 well-separated pieces → split into 3.
  const core = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    if (!metal[p]) continue
    if (isCore(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])) core[p] = 1
  }
  const seedCC = SPLIT_IDS.has(id)
    ? components(erode(core, W, H, 1), W, H, Math.max(120, Math.round(W * H * 0.004)))
    : { labels: new Int32Array(W * H), comps: [] }
  if (seedCC.comps.length >= 2) {
    // Seed centroids; cluster ones that are close together (multiple highlights of
    // one charm, e.g. a bow's two loops) into a single charm centroid.
    const cent = seedCC.comps.map((c) => {
      let sx = 0, sy = 0, n = 0
      for (let p = 0; p < W * H; p++) if (seedCC.labels[p] === c.label) { sx += p % W; sy += (p / W) | 0; n++ }
      return { x: sx / n, y: sy / n, n }
    })
    const CLUSTER_D = 95
    const root = cent.map((_, i) => i)
    const find = (a) => { while (root[a] !== a) { root[a] = root[root[a]]; a = root[a] } return a }
    for (let i = 0; i < cent.length; i++) for (let j = i + 1; j < cent.length; j++) {
      if (Math.hypot(cent[i].x - cent[j].x, cent[i].y - cent[j].y) < CLUSTER_D) root[find(i)] = find(j)
    }
    const groups = new Map()
    for (let i = 0; i < cent.length; i++) {
      const r = find(i)
      let g = groups.get(r)
      if (!g) { g = { sx: 0, sy: 0, n: 0 }; groups.set(r, g) }
      g.sx += cent[i].x * cent[i].n; g.sy += cent[i].y * cent[i].n; g.n += cent[i].n
    }
    const centroids = [...groups.values()].map((g) => ({ x: g.sx / g.n, y: g.sy / g.n }))
    if (centroids.length >= 2) {
      // assign every metal pixel to its nearest charm centroid (Euclidean Voronoi)
      const grown = new Int32Array(W * H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x
        if (!metal[p]) continue
        let best = 0, bd = Infinity
        for (let k = 0; k < centroids.length; k++) {
          const d = (x - centroids[k].x) ** 2 + (y - centroids[k].y) ** 2
          if (d < bd) { bd = d; best = k + 1 }
        }
        grown[p] = best
      }
      // Clean Voronoi-boundary crumbs: within each charm's cell keep only its
      // largest blob (break any hair-thin thread to a stray crumb first so the
      // crumb separates and is dropped).
      for (let k = 1; k <= centroids.length; k++) {
        const sub = new Uint8Array(W * H)
        for (let p = 0; p < W * H; p++) if (grown[p] === k) sub[p] = 1
        const cc = components(erode(sub, W, H, 2), W, H, 1)
        if (!cc.comps.length) continue
        cc.comps.sort((a, b) => b.area - a.area)
        const keep = cc.comps[0].label
        const keepMask = new Uint8Array(W * H)
        for (let p = 0; p < W * H; p++) if (cc.labels[p] === keep) keepMask[p] = 1
        const grownBack = dilate(keepMask, W, H, 3)
        for (let p = 0; p < W * H; p++) if (grown[p] === k && !grownBack[p]) grown[p] = 0
      }
      const acc = new Map()
      for (let p = 0; p < W * H; p++) {
        const L = grown[p]
        if (!L) continue
        const x = p % W, y = (p / W) | 0
        let e = acc.get(L)
        if (!e) { e = { label: L, minx: W, miny: H, maxx: 0, maxy: 0, area: 0 }; acc.set(L, e) }
        if (x < e.minx) e.minx = x
        if (x > e.maxx) e.maxx = x
        if (y < e.miny) e.miny = y
        if (y > e.maxy) e.maxy = y
        e.area++
      }
      const pieces = [...acc.values()].filter((e) => e.area >= minArea).map((e) => ({
        label: e.label, area: e.area,
        bbox: { minx: e.minx, miny: e.miny, maxx: e.maxx, maxy: e.maxy, w: e.maxx - e.minx + 1, h: e.maxy - e.miny + 1 },
      }))
      if (pieces.length >= 2) { labels = grown; compList = pieces }
    }
  }
  const comps = compList
  if (!comps.length) { // no warm gold at all → this cut-out was pure shadow; drop it
    totalIn--
    continue
  }

  comps.sort((a, b) => b.area - a.area)
  // drop thin-line slivers (a real charm fills a fair share of its own bbox; a
  // stray diagonal shadow line barely does, and is very thin on its short side)
  const notSliver = (c) =>
    c.area / (c.bbox.w * c.bbox.h) >= 0.12 &&
    Math.min(c.bbox.w, c.bbox.h) >= 0.12 * Math.max(c.bbox.w, c.bbox.h)
  const finalComps = comps.filter(notSliver)
  if (!finalComps.length) { // whole cut-out was a noise sliver → drop it
    totalIn-- // don't count it as an input we kept
    continue
  }
  const multi = finalComps.length > 1
  let idx = 0
  for (const c of finalComps) {
    // Keep only the LARGEST connected blob of this piece, dropping any stray bit
    // of an ADJACENT charm that came along in the cut-out (e.g. a corner clasp).
    const sub = new Uint8Array(W * H)
    for (let p = 0; p < W * H; p++) if (labels[p] === c.label) sub[p] = 1
    const cc = components(sub, W, H, 1)
    if (!cc.comps.length) continue
    cc.comps.sort((a, b) => b.area - a.area)
    const main = cc.comps[0]
    const { minx, miny, w, h } = main.bbox
    const out = Buffer.alloc(w * h * 4)
    let warmPx = 0, opPx = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sp = (miny + y) * W + (minx + x)
      const dp = (y * w + x) * 4
      if (cc.labels[sp] === main.label) {
        const so = sp * 4
        out[dp] = data[so]; out[dp + 1] = data[so + 1]; out[dp + 2] = data[so + 2]; out[dp + 3] = data[so + 3] || 255
        opPx++
        if (data[so] - data[so + 2] >= 26) warmPx++
      }
    }
    // a real gold charm is mostly warm; a leftover grey shadow blob is ~0% warm.
    if (opPx === 0 || warmPx / opPx < 0.25) continue
    idx++
    const newId = multi ? `${id}-${idx}` : id
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(TMP, `${newId}.png`))
    const widthMm = +(w * mmPerPx).toFixed(1)
    const heightMm = +(h * mmPerPx).toFixed(1)
    const longMm = Math.max(widthMm, heightMm)
    const tier = longMm >= 23 ? { tier: 'grande', type: 1, price: 3 } : longMm <= 11.5 ? { tier: 'mini', type: 3, price: 2 } : { tier: 'midi', type: 2, price: 2 }
    outCharms.push({ id: newId, src: `${newId}.png`, fromPhoto: meta.fromPhoto, widthMm, heightMm, ...tier, pxW: w, pxH: h })
    totalOut++
  }
  if (multi) console.log(`${id}: split into ${finalComps.length}`) // eslint-disable-line
}

// swap cleaned files in
for (const f of await readdir(DIR)) {
  if (/\.png$/i.test(f)) await rm(join(DIR, f))
}
for (const f of await readdir(TMP)) {
  await writeFile(join(DIR, f), await readFile(join(TMP, f)))
}
await rm(TMP, { recursive: true, force: true })
await writeFile(join(DIR, 'manifest.json'), JSON.stringify({ ...manifest, deshadowedAt: new Date().toISOString(), count: outCharms.length, charms: outCharms }, null, 2) + '\n')
console.log(`\nDe-shadowed ${totalIn} -> ${totalOut} charms.`) // eslint-disable-line
