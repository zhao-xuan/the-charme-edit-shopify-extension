/**
 * segment.js — in-browser charm/piece extractor + auto-sizer (no LLM, no server).
 *
 * The merchant photographs a set of real charms laid out ON a product body (e.g.
 * gold charms on a white phone case, like the reference shots in
 * reference/charms-real-image). This module takes that single photo plus the
 * product's real-world size and:
 *
 *   1. knocks out the DESK / backdrop with a border-seeded flood fill,
 *   2. measures the remaining product silhouette → a px→mm ruler from the real
 *      product size the merchant typed in,
 *   3. removes the PRODUCT-BODY colour so the individual pieces sitting on it
 *      separate cleanly,
 *   4. labels every connected piece, trims it to a tight transparent cut-out,
 *   5. derives each piece's real width/height (mm) from the ruler,
 *
 * and returns the cut-outs + sizes ready to become catalogue items. It mirrors
 * the build-time pipeline (scripts/process-assets.mjs + measure-real-charms.mjs)
 * but runs entirely on a <canvas>.
 *
 * Everything is tunable (background tolerance, piece sensitivity, size limits)
 * and an annotated overlay is produced so the merchant can eyeball the detection
 * before committing.
 */

const sq = (n) => n * n
const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const median = (values) => {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

/** Load an image src (data URL or URL) into an ImageData (+ its canvas ctx). */
export function loadImageData(src, maxDim = 1100) {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * ratio))
      const h = Math.max(1, Math.round(img.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      resolve(ctx.getImageData(0, 0, w, h))
    }
    img.onerror = reject
    img.src = src
  })
}

/** Otsu threshold over a 256-bin luminance histogram. */
function otsuThreshold(hist, total) {
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, best = 0, bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * sq(mB - mF)
    if (between > best) { best = between; bestT = t }
  }
  return bestT
}

/** Fill interior holes of a binary mask (e.g. charm gaps inside the case). */
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

/**
 * Detect the product the pieces sit on (e.g. the phone case) as the largest
 * tonal island that does NOT span the whole frame. The backdrop (desk) and the
 * product separate cleanly by brightness (Otsu); the desk touches every border
 * while the product is an inset island. Returns { mask (hole-filled), bbox } or
 * null if nothing convincing is found.
 */
function detectProductIsland(data, W, H) {
  const n = W * H
  const hist = new Uint32Array(256)
  for (let p = 0; p < n; p++) hist[lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) | 0]++
  const thr = otsuThreshold(hist, n)
  const bright = new Uint8Array(n)
  const dark = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    if (lumOf(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) > thr) bright[p] = 1
    else dark[p] = 1
  }
  const spansFrame = (b) => b.minx <= 1 && b.maxx >= W - 2 && b.miny <= 1 && b.maxy >= H - 2
  const minArea = n * 0.02
  let best = null
  for (const mask of [bright, dark]) {
    const { labels, comps } = connectedComponents(mask, W, H, minArea)
    for (const c of comps) {
      if (spansFrame(c.bbox)) continue // that's the backdrop
      if (!best || c.area > best.area) best = { comp: c, labels }
    }
  }
  if (!best) return null
  const compMask = new Uint8Array(n)
  const L = best.comp.label
  for (let p = 0; p < n; p++) if (best.labels[p] === L) compMask[p] = 1
  return { mask: fillHoles(compMask, W, H), bbox: best.comp.bbox, source: 'island' }
}

function rectangularProduct(bbox, W, H, source) {
  const mask = new Uint8Array(W * H)
  for (let y = bbox.miny; y <= bbox.maxy; y++) {
    mask.fill(1, y * W + bbox.minx, y * W + bbox.maxx + 1)
  }
  return { mask, bbox, source }
}

function plausibleProductBox(box, W, H) {
  if (!box) return false
  const widthFrac = box.w / W
  const heightFrac = box.h / H
  const areaFrac = (box.w * box.h) / (W * H)
  return widthFrac >= 0.28 && widthFrac <= 0.97 && heightFrac >= 0.4 && areaFrac >= 0.14
}

// Bright studio photos often have a white/cream product on a backdrop only a
// few luminance points brighter. Scan inward on many rows and use the median
// first sustained step down; charms occur later and cannot move that median.
function detectProductByEdgeDrop(data, W, H) {
  const lum = new Float32Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const o = p * 4
    lum[p] = lumOf(data[o], data[o + 1], data[o + 2])
  }
  const at = (x, y) => lum[y * W + x]
  const border = []
  for (let x = 0; x < W; x += 3) {
    border.push(at(x, 2), at(x, H - 3))
  }
  if (median(border) < 120) return null

  const DROP = 4
  const CONFIRM = 4
  const firstDrop = (start, end, step, level, sample) => {
    for (let v = start; step > 0 ? v <= end : v >= end; v += step) {
      if (sample(v) >= level - DROP) continue
      let confirmed = true
      for (let k = 1; k <= CONFIRM; k++) {
        if (sample(v + step * k) >= level - DROP) { confirmed = false; break }
      }
      if (confirmed) return v
    }
    return -1
  }

  const lefts = []
  const rights = []
  for (let y = Math.round(H * 0.22); y < Math.round(H * 0.78); y += 3) {
    const leftLevel = median([at(1, y), at(3, y), at(5, y), at(7, y)])
    const left = firstDrop(8, Math.round(W * 0.5), 1, leftLevel, (x) => at(x, y))
    if (left > 0) lefts.push(left)
    const rightLevel = median([at(W - 2, y), at(W - 4, y), at(W - 6, y), at(W - 8, y)])
    const right = firstDrop(W - 9, Math.round(W * 0.5), -1, rightLevel, (x) => at(x, y))
    if (right > 0) rights.push(right)
  }
  if (lefts.length < 10 || rights.length < 10) return null

  const minx = median(lefts)
  const maxx = median(rights)
  const width = maxx - minx + 1
  const tops = []
  const bottoms = []
  for (let x = Math.round(minx + width * 0.3); x < Math.round(maxx - width * 0.3); x += 3) {
    const topLevel = median([at(x, 1), at(x, 3), at(x, 5), at(x, 7)])
    const top = firstDrop(8, Math.round(H * 0.45), 1, topLevel, (y) => at(x, y))
    if (top > 0) tops.push(top)
    const bottomLevel = median([at(x, H - 2), at(x, H - 4), at(x, H - 6), at(x, H - 8)])
    const bottom = firstDrop(H - 9, Math.round(H * 0.55), -1, bottomLevel, (y) => at(x, y))
    if (bottom > 0) bottoms.push(bottom)
  }
  const miny = tops.length >= 8 ? median(tops) : 0
  const maxy = bottoms.length >= 8 ? median(bottoms) : H - 1
  const bbox = { minx, miny, maxx, maxy, w: width, h: maxy - miny + 1 }
  return plausibleProductBox(bbox, W, H) ? rectangularProduct(bbox, W, H, 'edge-drop') : null
}

// Dark cases and warmer products separate more clearly in median axis
// profiles than in a single global threshold. This also smooths out charms.
function detectProductByProfile(data, W, H) {
  const profile = (axis) => {
    const length = axis === 'x' ? W : H
    const cross = axis === 'x' ? H : W
    const start = Math.round(cross * 0.3)
    const end = Math.round(cross * 0.7)
    const warmth = new Array(length)
    const luminance = new Array(length)
    for (let v = 0; v < length; v++) {
      const ws = []
      const ls = []
      for (let c = start; c < end; c += 4) {
        const x = axis === 'x' ? v : c
        const y = axis === 'x' ? c : v
        const o = (y * W + x) * 4
        ws.push(data[o] - data[o + 2])
        ls.push(lumOf(data[o], data[o + 1], data[o + 2]))
      }
      warmth[v] = median(ws)
      luminance[v] = median(ls)
    }
    return { warmth, luminance }
  }
  const span = (flags, minRun) => {
    const find = (start, step) => {
      for (let i = start; i >= 0 && i < flags.length; i += step) {
        let count = 0
        for (let k = 0; k < minRun * 2; k++) {
          const j = i + step * k
          if (j < 0 || j >= flags.length) break
          if (flags[j]) count++
        }
        if (count >= minRun) return i
      }
      return -1
    }
    return [find(0, 1), find(flags.length - 1, -1)]
  }
  const classify = ({ warmth, luminance }) => {
    const edgeCount = Math.max(2, Math.round(warmth.length * 0.04))
    const edgeWarmth = median([...warmth.slice(0, edgeCount), ...warmth.slice(-edgeCount)])
    const edgeLum = median([...luminance.slice(0, edgeCount), ...luminance.slice(-edgeCount)])
    return warmth.map((value, i) => value - edgeWarmth > 7 || edgeLum - luminance[i] > 48)
  }
  const xFlags = classify(profile('x'))
  const yFlags = classify(profile('y'))
  const [minx, maxx] = span(xFlags, Math.max(6, Math.round(W * 0.02)))
  const [miny, maxy] = span(yFlags, Math.max(6, Math.round(H * 0.02)))
  if (minx < 0 || miny < 0 || maxx <= minx || maxy <= miny) return null
  const bbox = { minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1 }
  return plausibleProductBox(bbox, W, H) ? rectangularProduct(bbox, W, H, 'profile') : null
}

function detectProduct(data, W, H) {
  const borderLum = []
  for (let x = 0; x < W; x += 3) {
    for (const y of [1, H - 2]) {
      const o = (y * W + x) * 4
      borderLum.push(lumOf(data[o], data[o + 1], data[o + 2]))
    }
  }
  for (let y = 0; y < H; y += 3) {
    for (const x of [1, W - 2]) {
      const o = (y * W + x) * 4
      borderLum.push(lumOf(data[o], data[o + 1], data[o + 2]))
    }
  }
  if (median(borderLum) < 120) return null

  const candidates = [
    detectProductByEdgeDrop(data, W, H),
    detectProductByProfile(data, W, H),
    detectProductIsland(data, W, H),
  ].filter((candidate) => plausibleProductBox(candidate?.bbox, W, H))
  if (!candidates.length) return null
  return candidates.sort((a, b) => (b.bbox.w * b.bbox.h) - (a.bbox.w * a.bbox.h))[0]
}

/** Dominant (modal) colour of the product body the pieces sit on, found via a
 * coarse RGB histogram over the product silhouette so we can subtract it. Skips
 * very dark / very saturated pixels (those are likely the pieces, not the body).
 */
function dominantColor(data, W, H, onProduct, fgBox) {
  const BIN = 24
  const bins = new Map()
  for (let y = fgBox.miny; y <= fgBox.maxy; y++) {
    for (let x = fgBox.minx; x <= fgBox.maxx; x++) {
      const p = y * W + x
      if (!onProduct(p)) continue
      const o = p * 4
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const sat = mx === 0 ? 0 : (mx - mn) / mx
      if (sat > 0.5) continue // skip clearly-coloured pieces
      const key = ((r / BIN) | 0) * 10000 + ((g / BIN) | 0) * 100 + ((b / BIN) | 0)
      const e = bins.get(key)
      if (e) { e.r += r; e.g += g; e.b += b; e.n++ } else bins.set(key, { r, g, b, n: 1 })
    }
  }
  let best = null
  for (const e of bins.values()) if (!best || e.n > best.n) best = e
  if (!best) return { r: 240, g: 240, b: 240 }
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
}

function medianColorInBox(data, W, box) {
  if (box.minx > box.maxx || box.miny > box.maxy) return null
  const rs = []
  const gs = []
  const bs = []
  for (let y = box.miny; y <= box.maxy; y += 2) {
    for (let x = box.minx; x <= box.maxx; x += 2) {
      const offset = (y * W + x) * 4
      rs.push(data[offset])
      gs.push(data[offset + 1])
      bs.push(data[offset + 2])
    }
  }
  if (rs.length < 12) return null
  return { r: median(rs), g: median(gs), b: median(bs) }
}

function exteriorBackgroundColors(data, W, fgBox, searchBox, fallback) {
  const sample = (box) => medianColorInBox(data, W, box) || fallback
  return {
    left: sample({ minx: searchBox.minx, miny: fgBox.miny, maxx: fgBox.minx - 1, maxy: fgBox.maxy }),
    right: sample({ minx: fgBox.maxx + 1, miny: fgBox.miny, maxx: searchBox.maxx, maxy: fgBox.maxy }),
    top: sample({ minx: fgBox.minx, miny: searchBox.miny, maxx: fgBox.maxx, maxy: fgBox.miny - 1 }),
    bottom: sample({ minx: fgBox.minx, miny: fgBox.maxy + 1, maxx: fgBox.maxx, maxy: searchBox.maxy }),
  }
}

function exteriorBackgroundAt(x, y, fgBox, backgrounds) {
  const choices = []
  if (x < fgBox.minx) choices.push({ distance: fgBox.minx - x, color: backgrounds.left })
  if (x > fgBox.maxx) choices.push({ distance: x - fgBox.maxx, color: backgrounds.right })
  if (y < fgBox.miny) choices.push({ distance: fgBox.miny - y, color: backgrounds.top })
  if (y > fgBox.maxy) choices.push({ distance: y - fgBox.maxy, color: backgrounds.bottom })
  if (!choices.length) {
    choices.push(
      { distance: Math.abs(x - fgBox.minx), color: backgrounds.left },
      { distance: Math.abs(x - fgBox.maxx), color: backgrounds.right },
      { distance: Math.abs(y - fgBox.miny), color: backgrounds.top },
      { distance: Math.abs(y - fgBox.maxy), color: backgrounds.bottom },
    )
  }
  return choices.sort((a, b) => a.distance - b.distance)[0].color
}

/** Morphological dilate (r passes, 4-neighbourhood) of a binary mask. */
function dilate(mask, W, H, r) {
  let m = mask
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        if (m[p]) { out[p] = 1; continue }
        if ((x > 0 && m[p - 1]) || (x < W - 1 && m[p + 1]) ||
            (y > 0 && m[p - W]) || (y < H - 1 && m[p + W])) out[p] = 1
      }
    }
    m = out
  }
  return m
}

/** 8-connected component labelling; returns { labels, comps:[{label,bbox,area}] }. */
function connectedComponents(mask, W, H, minArea) {
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
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const q = ny * W + nx
          if (!labels[q] && mask[q]) { labels[q] = cur; stack[sp++] = q }
        }
      }
    }
    comps.push({ label: cur, bbox: { minx, miny, maxx, maxy, w: maxx - minx + 1, h: maxy - miny + 1 }, area })
  }
  return { labels, comps: comps.filter((c) => c.area >= minArea) }
}

/** Mean RGB + luminance std-dev of one labelled component (over its bbox). */
function componentStats(data, W, labels, comp) {
  const { minx, miny, maxx, maxy } = comp.bbox
  let r = 0, g = 0, b = 0, sl = 0, sl2 = 0, n = 0
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const p = y * W + x
      if (labels[p] !== comp.label) continue
      const o = p * 4
      r += data[o]; g += data[o + 1]; b += data[o + 2]
      const l = lumOf(data[o], data[o + 1], data[o + 2])
      sl += l; sl2 += l * l; n++
    }
  }
  if (!n) return { r: 0, g: 0, b: 0, lumStd: 0 }
  const ml = sl / n
  return { r: r / n, g: g / n, b: b / n, lumStd: Math.sqrt(Math.max(0, sl2 / n - ml * ml)) }
}

function localBackgroundColor(data, W, H, labels, comp, onProduct, fallback) {
  const { minx, miny, maxx, maxy, w, h } = comp.bbox
  const pad = Math.max(4, Math.round(Math.max(w, h) * 0.06))
  const rs = []
  const gs = []
  const bs = []
  for (let y = Math.max(0, miny - pad); y <= Math.min(H - 1, maxy + pad); y++) {
    for (let x = Math.max(0, minx - pad); x <= Math.min(W - 1, maxx + pad); x++) {
      const p = y * W + x
      if (labels[p] || !onProduct(p)) continue
      const o = p * 4
      rs.push(data[o])
      gs.push(data[o + 1])
      bs.push(data[o + 2])
    }
  }
  if (rs.length < 24) return fallback
  return { r: median(rs), g: median(gs), b: median(bs) }
}

function rgbDistance(r, g, b, color) {
  return Math.sqrt(sq(r - color.r) + sq(g - color.g) + sq(b - color.b))
}

function componentBackgroundColors(data, W, H, labels, comp, onProduct, fallback, pieceTol) {
  const primary = localBackgroundColor(data, W, H, labels, comp, onProduct, fallback)
  const { minx, miny, maxx, maxy, w, h } = comp.bbox
  const cornerW = Math.max(5, Math.round(w * 0.2))
  const cornerH = Math.max(5, Math.round(h * 0.2))
  const corners = [
    [minx, miny, minx + cornerW - 1, miny + cornerH - 1],
    [maxx - cornerW + 1, miny, maxx, miny + cornerH - 1],
    [minx, maxy - cornerH + 1, minx + cornerW - 1, maxy],
    [maxx - cornerW + 1, maxy - cornerH + 1, maxx, maxy],
  ]
  const candidates = []
  for (const [startX, startY, endX, endY] of corners) {
    const rs = []
    const gs = []
    const bs = []
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const p = y * W + x
        if (labels[p] !== comp.label) continue
        const o = p * 4
        const r = data[o], g = data[o + 1], b = data[o + 2]
        const max = Math.max(r, g, b)
        const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max
        if (saturation > 0.22 || rgbDistance(r, g, b, primary) < pieceTol * 0.3) continue
        rs.push(r)
        gs.push(g)
        bs.push(b)
      }
    }
    if (rs.length < Math.max(8, cornerW * cornerH * 0.12)) return [primary]
    candidates.push({ r: median(rs), g: median(gs), b: median(bs) })
  }

  const maxSpread = Math.max(18, pieceTol * 0.45)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (rgbDistance(candidates[i].r, candidates[i].g, candidates[i].b, candidates[j]) > maxSpread) return [primary]
    }
  }
  const secondary = {
    r: median(candidates.map((color) => color.r)),
    g: median(candidates.map((color) => color.g)),
    b: median(candidates.map((color) => color.b)),
  }
  if (rgbDistance(secondary.r, secondary.g, secondary.b, primary) < Math.max(8, pieceTol * 0.25)) return [primary]

  let backingPixels = 0
  let distinctPixels = 0
  const backingTol = Math.max(18, pieceTol * 0.45)
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const p = y * W + x
      if (labels[p] !== comp.label) continue
      const o = p * 4
      const distance = rgbDistance(data[o], data[o + 1], data[o + 2], secondary)
      if (distance <= backingTol) backingPixels++
      if (distance >= Math.max(36, pieceTol * 0.9)) distinctPixels++
    }
  }
  if (backingPixels < comp.area * 0.18 || distinctPixels < comp.area * 0.06) return [primary]
  return [primary, secondary]
}

/** Refine one coarse component against its local product colour and cut it to alpha bounds. */
function cutComponent(data, W, H, labels, comp, body, exterior, onProduct, pieceTol, renderOutput) {
  const { minx, miny, w, h } = comp.bbox
  const productBackgrounds = componentBackgroundColors(data, W, H, labels, comp, onProduct, body, pieceTol)
  const low = pieceTol * 0.38
  const high = pieceTol * 0.92
  const alpha = new Uint8ClampedArray(w * h)
  let alphaMinX = w, alphaMinY = h, alphaMaxX = -1, alphaMaxY = -1, areaPx = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = (miny + y) * W + (minx + x)
      if (labels[sp] !== comp.label) continue
      const so = sp * 4
      const backgrounds = onProduct(sp)
        ? productBackgrounds
        : [exteriorBackgroundAt(minx + x, miny + y, comp.productBox, exterior)]
      const distance = Math.min(...backgrounds.map((background) => (
        rgbDistance(data[so], data[so + 1], data[so + 2], background)
      )))
      const linear = Math.max(0, Math.min(1, (distance - low) / (high - low)))
      const smooth = linear * linear * (3 - 2 * linear)
      const value = Math.round(smooth * data[so + 3])
      if (value <= 4) continue
      alpha[y * w + x] = value
      alphaMinX = Math.min(alphaMinX, x)
      alphaMinY = Math.min(alphaMinY, y)
      alphaMaxX = Math.max(alphaMaxX, x)
      alphaMaxY = Math.max(alphaMaxY, y)
      if (value >= 128) areaPx++
    }
  }
  if (alphaMaxX < alphaMinX || alphaMaxY < alphaMinY) return null

  const cutMinX = minx + alphaMinX
  const cutMinY = miny + alphaMinY
  const cutW = alphaMaxX - alphaMinX + 1
  const cutH = alphaMaxY - alphaMinY + 1
  const bbox = {
    minx: cutMinX,
    miny: cutMinY,
    maxx: cutMinX + cutW - 1,
    maxy: cutMinY + cutH - 1,
    w: cutW,
    h: cutH,
  }
  if (!renderOutput) return { dataUrl: null, pxW: cutW, pxH: cutH, bbox, areaPx }

  const canvas = document.createElement('canvas')
  canvas.width = cutW
  canvas.height = cutH
  const ctx = canvas.getContext('2d')
  const out = ctx.createImageData(cutW, cutH)
  for (let y = 0; y < cutH; y++) {
    for (let x = 0; x < cutW; x++) {
      const sourceX = alphaMinX + x
      const sourceY = alphaMinY + y
      const value = alpha[sourceY * w + sourceX]
      if (!value) continue
      const sp = (cutMinY + y) * W + cutMinX + x
      const so = sp * 4
      const dp = (y * cutW + x) * 4
      const fraction = value / 255
      const backgrounds = onProduct(sp)
        ? productBackgrounds
        : [exteriorBackgroundAt(cutMinX + x, cutMinY + y, comp.productBox, exterior)]
      const background = backgrounds.reduce((nearest, candidate) => (
        rgbDistance(data[so], data[so + 1], data[so + 2], candidate)
          < rgbDistance(data[so], data[so + 1], data[so + 2], nearest)
          ? candidate
          : nearest
      ))
      const unmix = (channel, backdrop) => Math.max(0, Math.min(255, Math.round(
        (channel - backdrop * (1 - fraction)) / Math.max(0.08, fraction),
      )))
      out.data[dp] = fraction < 0.98 ? unmix(data[so], background.r) : data[so]
      out.data[dp + 1] = fraction < 0.98 ? unmix(data[so + 1], background.g) : data[so + 1]
      out.data[dp + 2] = fraction < 0.98 ? unmix(data[so + 2], background.b) : data[so + 2]
      out.data[dp + 3] = value
    }
  }
  ctx.putImageData(out, 0, 0)
  return { dataUrl: canvas.toDataURL('image/png'), pxW: cutW, pxH: cutH, bbox, areaPx }
}

/** Cut an alpha-labelled component while preserving its original soft edge. */
function cutAlphaComponent(data, W, labels, comp, alphaThreshold) {
  const { minx, miny, w, h } = comp.bbox
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const out = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = (miny + y) * W + (minx + x)
      const so = sp * 4
      if (labels[sp] !== comp.label || data[so + 3] <= alphaThreshold) continue
      const dp = (y * w + x) * 4
      out.data[dp] = data[so]
      out.data[dp + 1] = data[so + 1]
      out.data[dp + 2] = data[so + 2]
      out.data[dp + 3] = data[so + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
  return { dataUrl: canvas.toDataURL('image/png'), pxW: w, pxH: h }
}

/** Tier (and default price) auto-classified from a piece's real long side (mm). */
export function tierFromMm(longMm) {
  if (longMm >= 23) return { tier: 'grande', type: 1, price: 3 }
  if (longMm <= 11.5) return { tier: 'mini', type: 3, price: 2 }
  return { tier: 'midi', type: 2, price: 2 }
}

/**
 * Import a GPT-assisted transparent PNG. The image must retain the source
 * photo's canvas/aspect and charm positions. Product-photo imports use a
 * caller-calibrated `mmPerPx`; single-charm imports derive it by mapping the
 * transparent subject's long side to `standaloneLongMm`.
 */
export function extractTransparentPieces(imageData, opts) {
  const { data, width: W, height: H } = imageData
  let mmPerPx = Number(opts.mmPerPx) || 0
  const standaloneLongMm = Number(opts.standaloneLongMm) || 0
  const minPieceMm = opts.minPieceMm ?? 3
  const maxPieceMm = opts.maxPieceMm ?? 55
  const alphaThreshold = opts.alphaThreshold ?? 16
  const renderOutput = opts.renderOutput !== false
  const n = W * H
  const mask = new Uint8Array(n)
  let foreground = 0
  let foregroundMinX = W, foregroundMinY = H, foregroundMaxX = -1, foregroundMaxY = -1
  let transparent = 0
  let borderSamples = 0
  let transparentBorder = 0
  for (let p = 0; p < n; p++) {
    const alpha = data[p * 4 + 3]
    if (alpha < 250) transparent++
    const x = p % W
    const y = (p / W) | 0
    if (alpha > alphaThreshold) {
      mask[p] = 1
      foreground++
      foregroundMinX = Math.min(foregroundMinX, x)
      foregroundMinY = Math.min(foregroundMinY, y)
      foregroundMaxX = Math.max(foregroundMaxX, x)
      foregroundMaxY = Math.max(foregroundMaxY, y)
    }
    if (x < 2 || x >= W - 2 || y < 2 || y >= H - 2) {
      borderSamples++
      if (alpha <= alphaThreshold) transparentBorder++
    }
  }
  if (transparent < n * 0.05 || transparentBorder < borderSamples * 0.8) {
    throw new Error('The GPT result has no transparent background. Ask GPT for a transparent PNG and upload the downloaded PNG, not a screenshot.')
  }
  if (!foreground) {
    return { mmPerPx, pieces: [], overlay: renderOutput ? buildOverlay(imageData, null, []) : null }
  }

  if (standaloneLongMm > 0) {
    const bbox = {
      minx: foregroundMinX,
      miny: foregroundMinY,
      maxx: foregroundMaxX,
      maxy: foregroundMaxY,
      w: foregroundMaxX - foregroundMinX + 1,
      h: foregroundMaxY - foregroundMinY + 1,
    }
    mmPerPx = standaloneLongMm / Math.max(bbox.w, bbox.h)
    const widthMm = +(bbox.w * mmPerPx).toFixed(1)
    const heightMm = +(bbox.h * mmPerPx).toFixed(1)
    const longMm = Math.max(widthMm, heightMm)
    const comp = { label: 1, bbox, area: foreground }
    const cut = renderOutput
      ? cutAlphaComponent(data, W, mask, comp, alphaThreshold)
      : { dataUrl: null, pxW: bbox.w, pxH: bbox.h }
    const piece = {
      ...cut,
      widthMm,
      heightMm,
      longMm,
      areaPx: foreground,
      bbox,
      source: 'gpt',
      ...tierFromMm(longMm),
    }
    return { mmPerPx, pieces: [piece], overlay: renderOutput ? buildOverlay(imageData, null, [piece]) : null }
  }

  if (!mmPerPx) {
    return { mmPerPx, pieces: [], overlay: renderOutput ? buildOverlay(imageData, null, []) : null }
  }

  const minArea = Math.max(8, Math.round(sq(minPieceMm / mmPerPx) * 0.35))
  const { labels, comps } = connectedComponents(mask, W, H, minArea)
  const pieces = []
  for (const comp of comps.sort((a, b) => (a.bbox.miny - b.bbox.miny) || (a.bbox.minx - b.bbox.minx))) {
    const widthMm = +(comp.bbox.w * mmPerPx).toFixed(1)
    const heightMm = +(comp.bbox.h * mmPerPx).toFixed(1)
    const longMm = Math.max(widthMm, heightMm)
    if (longMm < minPieceMm || longMm > maxPieceMm) continue
    const cut = renderOutput
      ? cutAlphaComponent(data, W, labels, comp, alphaThreshold)
      : { dataUrl: null, pxW: comp.bbox.w, pxH: comp.bbox.h }
    pieces.push({
      ...cut,
      widthMm,
      heightMm,
      longMm,
      areaPx: comp.area,
      bbox: comp.bbox,
      source: 'gpt',
      ...tierFromMm(longMm),
    })
  }
  return { mmPerPx, pieces, overlay: renderOutput ? buildOverlay(imageData, null, pieces) : null }
}

function borderBackground(data, W, H) {
  const rs = []
  const gs = []
  const bs = []
  const inset = Math.max(2, Math.round(Math.min(W, H) * 0.025))
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (x >= inset && x < W - inset && y >= inset && y < H - inset) continue
      const offset = (y * W + x) * 4
      rs.push(data[offset])
      gs.push(data[offset + 1])
      bs.push(data[offset + 2])
    }
  }
  const color = { r: median(rs), g: median(gs), b: median(bs) }
  const deviations = rs.map((r, index) => rgbDistance(r, gs[index], bs[index], color))
  return { color, noise: median(deviations) }
}

/** Extract one isolated charm photographed on a clean, plain backdrop. */
function extractStandalonePiece(imageData, opts) {
  const { data, width: W, height: H } = imageData
  const renderOutput = opts.renderOutput !== false
  const { color: background, noise } = borderBackground(data, W, H)
  const pieceTol = opts.pieceTol ?? 58
  const coarseTolerance = Math.max(10, noise * 5, Math.min(28, pieceTol * 0.35))
  const raw = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const offset = p * 4
    if (data[offset + 3] > 8 && rgbDistance(data[offset], data[offset + 1], data[offset + 2], background) >= coarseTolerance) {
      raw[p] = 1
    }
  }

  const grouped = fillHoles(dilate(raw, W, H, 2), W, H)
  const { labels, comps } = connectedComponents(grouped, W, H, Math.max(16, Math.round(W * H * 0.0004)))
  const candidates = comps.filter((comp) => {
    const { bbox } = comp
    const touchesFrame = bbox.minx <= 1 || bbox.miny <= 1 || bbox.maxx >= W - 2 || bbox.maxy >= H - 2
    const boxFraction = (bbox.w * bbox.h) / (W * H)
    return !touchesFrame && boxFraction >= 0.005 && boxFraction <= 0.85
  }).sort((a, b) => b.area - a.area)

  const comp = candidates[0]
  if (!comp) {
    const product = { detected: false, mode: 'standalone', pxW: 0, pxH: 0, longMm: 0, detector: 'border-background' }
    return { mmPerPx: 0, product, pieces: [], overlay: renderOutput ? buildOverlay(imageData, null, []) : null }
  }

  const fullFrame = { minx: 0, miny: 0, maxx: W - 1, maxy: H - 1, w: W, h: H }
  comp.productBox = fullFrame
  const onImage = () => true
  const exterior = { left: background, right: background, top: background, bottom: background }
  const matteTolerance = Math.max(14, noise * 6, Math.min(32, pieceTol * 0.55))
  const cut = cutComponent(data, W, H, labels, comp, background, exterior, onImage, matteTolerance, renderOutput)
  if (!cut) {
    const product = { detected: false, mode: 'standalone', pxW: 0, pxH: 0, longMm: 0, detector: 'border-background' }
    return { mmPerPx: 0, product, pieces: [], overlay: renderOutput ? buildOverlay(imageData, null, []) : null }
  }

  const subjectLongPx = Math.max(cut.pxW, cut.pxH)
  const standaloneLongMm = Math.max(0.1, Number(opts.standaloneLongMm) || 15)
  const mmPerPx = standaloneLongMm / subjectLongPx
  const widthMm = +(cut.pxW * mmPerPx).toFixed(1)
  const heightMm = +(cut.pxH * mmPerPx).toFixed(1)
  const longMm = Math.max(widthMm, heightMm)
  const piece = {
    ...cut,
    widthMm,
    heightMm,
    longMm,
    source: 'standalone',
    ...tierFromMm(longMm),
  }
  const product = {
    detected: false,
    mode: 'standalone',
    pxW: 0,
    pxH: 0,
    longMm: 0,
    detector: 'border-background',
  }
  return {
    mmPerPx,
    product,
    pieces: [piece],
    overlay: renderOutput ? buildOverlay(imageData, null, [piece]) : null,
  }
}

/**
 * Full extraction. Returns:
 *   { mmPerPx, product:{pxW,pxH,longMm}, overlay:dataURL,
 *     pieces:[{ dataUrl, pxW, pxH, widthMm, heightMm, longMm, areaPx, ...tier }] }
 *
 * opts: { productLongMm, pieceTol=58, minPieceMm=4, maxPieceMm=55,
 *         warmOnly=false }
 */
export function extractPieces(imageData, opts) {
  if (opts.mode === 'standalone') return extractStandalonePiece(imageData, opts)

  const { data, width: W, height: H } = imageData
  const pieceTol = opts.pieceTol ?? 58
  const minPieceMm = opts.minPieceMm ?? 4
  const maxPieceMm = opts.maxPieceMm ?? 55
  const warmOnly = !!opts.warmOnly
  const renderOutput = opts.renderOutput !== false

  // 1. detect the product (the case the charms sit on) → px→mm ruler. It is the
  // largest tonal island that doesn't span the whole frame; its hole-filled
  // silhouette also bounds where we look for pieces.
  const prod = detectProduct(data, W, H)
  if (!prod) {
    return {
      mmPerPx: 0,
      product: { detected: false, pxW: 0, pxH: 0, longMm: 0, detector: null },
      pieces: [],
      overlay: renderOutput ? buildOverlay(imageData, null, []) : null,
    }
  }
  const fgBox = prod.bbox
  const onProduct = (p) => prod.mask[p] === 1
  const productLongPx = Math.max(fgBox.w, fgBox.h)
  const mmPerPx = (opts.productLongMm || productLongPx) / productLongPx

  // 2. product-body colour → piece mask (pixels on the product that differ from
  // the body it sits on).
  const body = dominantColor(data, W, H, onProduct, fgBox)
  const pieceTol2 = pieceTol * pieceTol
  const searchPad = Math.max(4, Math.round(fgBox.w * 0.2))
  const searchBox = {
    minx: Math.max(0, fgBox.minx - searchPad),
    miny: Math.max(0, fgBox.miny - searchPad),
    maxx: Math.min(W - 1, fgBox.maxx + searchPad),
    maxy: Math.min(H - 1, fgBox.maxy + searchPad),
  }
  const exterior = exteriorBackgroundColors(data, W, fgBox, searchBox, body)
  const raw = new Uint8Array(W * H)
  const seeds = new Uint8Array(W * H)
  for (let y = searchBox.miny; y <= searchBox.maxy; y++) {
    for (let x = searchBox.minx; x <= searchBox.maxx; x++) {
      const p = y * W + x
      const o = p * 4
      const r = data[o], g = data[o + 1], b = data[o + 2]
      const background = onProduct(p) ? body : exteriorBackgroundAt(x, y, fgBox, exterior)
      if (sq(r - background.r) + sq(g - background.g) + sq(b - background.b) <= pieceTol2) continue
      if (warmOnly) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const sat = mx === 0 ? 0 : (mx - mn) / mx
        if (!(r - b > 12 && sat > 0.15)) continue // keep only warm/metallic pieces
      }
      raw[p] = 1
      if (onProduct(p)) seeds[p] = 1
    }
  }

  // 3. bridge tiny gaps within a piece, then label
  const grouped = dilate(raw, W, H, 2)
  const minArea = Math.max(8, Math.round(sq(minPieceMm / mmPerPx) * 0.55))
  const { labels, comps } = connectedComponents(grouped, W, H, minArea)
  const seededLabels = new Set()
  for (let p = 0; p < seeds.length; p++) {
    if (seeds[p] && labels[p]) seededLabels.add(labels[p])
  }

  // 4. cut + size each piece (reject implausible blobs)
  const pieces = []
  for (const c of comps.sort((a, b) => b.area - a.area)) {
    if (!seededLabels.has(c.label)) continue
    c.productBox = fgBox
    const coarseLongMm = Math.max(c.bbox.w, c.bbox.h) * mmPerPx
    if (coarseLongMm < minPieceMm || coarseLongMm > maxPieceMm) continue
    const boxAreaFrac = (c.bbox.w * c.bbox.h) / (fgBox.w * fgBox.h)
    const boxAspect = c.bbox.w / c.bbox.h
    const nearTop = c.bbox.miny < fgBox.miny + fgBox.h * 0.38
    const nearSide = c.bbox.minx < fgBox.minx + fgBox.w * 0.18 || c.bbox.maxx > fgBox.maxx - fgBox.w * 0.18
    const cameraScale = Math.max(c.bbox.w, c.bbox.h) / fgBox.w
    if (boxAreaFrac > 0.035 && cameraScale > 0.36 && boxAspect > 0.65 && boxAspect < 1.55 && nearTop && nearSide) continue
    // reject non-charm blobs by colour + texture. Real charms read bright and/or
    // warm and are metallic (high internal contrast); a camera cut-out or deep
    // shadow is dark-neutral or large & flat.
    const st = componentStats(data, W, labels, c)
    const lum = (st.r + st.g + st.b) / 3
    const mx = Math.max(st.r, st.g, st.b), mn = Math.min(st.r, st.g, st.b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (lum < 70 && sat < 0.18) continue // dark neutral (hole / shadow)
    if (coarseLongMm > 13 && st.lumStd < 14 && sat < 0.22) continue // large flat patch (e.g. camera window)
    const cut = cutComponent(data, W, H, labels, c, body, exterior, onProduct, pieceTol, renderOutput)
    if (!cut) continue
    const wMm = +(cut.pxW * mmPerPx).toFixed(1)
    const hMm = +(cut.pxH * mmPerPx).toFixed(1)
    const longMm = Math.max(wMm, hMm)
    if (longMm < minPieceMm || longMm > maxPieceMm) continue
    pieces.push({ ...cut, widthMm: wMm, heightMm: hMm, longMm, ...tierFromMm(longMm) })
  }

  // 5. annotated overlay (product box = cyan, pieces = magenta) for review
  const overlay = renderOutput ? buildOverlay(imageData, fgBox, pieces) : null

  return {
    mmPerPx,
    product: {
      detected: true,
      pxW: fgBox.w,
      pxH: fgBox.h,
      longMm: +(productLongPx * mmPerPx).toFixed(1),
      detector: prod.source,
    },
    pieces,
    overlay,
  }
}

function buildOverlay(imageData, fgBox, pieces) {
  const { data, width: W, height: H } = imageData
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const copy = ctx.createImageData(W, H)
  copy.data.set(data)
  ctx.putImageData(copy, 0, 0)
  // product silhouette
  ctx.lineWidth = Math.max(2, Math.round(W / 320))
  ctx.strokeStyle = 'rgba(0,190,255,0.95)'
  if (fgBox) ctx.strokeRect(fgBox.minx, fgBox.miny, fgBox.w, fgBox.h)
  // each detected piece
  ctx.strokeStyle = 'rgba(214,48,160,0.95)'
  ctx.fillStyle = 'rgba(214,48,160,0.16)'
  for (const pc of pieces) {
    const b = pc.bbox
    ctx.fillRect(b.minx, b.miny, b.w, b.h)
    ctx.strokeRect(b.minx, b.miny, b.w, b.h)
  }
  return canvas.toDataURL('image/png')
}
