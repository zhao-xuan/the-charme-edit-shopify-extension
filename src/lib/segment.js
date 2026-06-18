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
function detectProduct(data, W, H) {
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
  return { mask: fillHoles(compMask, W, H), bbox: best.comp.bbox }
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

/** Cut one labelled component to a tight transparent PNG data URL. */
function cutComponent(data, W, labels, comp) {
  const { minx, miny, w, h } = comp.bbox
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const out = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sp = (miny + y) * W + (minx + x)
      const dp = (y * w + x) * 4
      if (labels[sp] === comp.label) {
        const so = sp * 4
        out.data[dp] = data[so]
        out.data[dp + 1] = data[so + 1]
        out.data[dp + 2] = data[so + 2]
        out.data[dp + 3] = 255
      } else {
        out.data[dp + 3] = 0
      }
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
 * Full extraction. Returns:
 *   { mmPerPx, product:{pxW,pxH,longMm}, overlay:dataURL,
 *     pieces:[{ dataUrl, pxW, pxH, widthMm, heightMm, longMm, areaPx, ...tier }] }
 *
 * opts: { productLongMm, pieceTol=58, minPieceMm=4, maxPieceMm=55,
 *         warmOnly=false }
 */
export function extractPieces(imageData, opts) {
  const { data, width: W, height: H } = imageData
  const pieceTol = opts.pieceTol ?? 58
  const minPieceMm = opts.minPieceMm ?? 4
  const maxPieceMm = opts.maxPieceMm ?? 55
  const warmOnly = !!opts.warmOnly

  // 1. detect the product (the case the charms sit on) → px→mm ruler. It is the
  // largest tonal island that doesn't span the whole frame; its hole-filled
  // silhouette also bounds where we look for pieces.
  const prod = detectProduct(data, W, H)
  const fgBox = prod ? prod.bbox : { minx: 0, miny: 0, maxx: W - 1, maxy: H - 1, w: W, h: H }
  const onProduct = prod ? (p) => prod.mask[p] === 1 : () => true
  const productLongPx = Math.max(fgBox.w, fgBox.h)
  const mmPerPx = (opts.productLongMm || productLongPx) / productLongPx

  // 2. product-body colour → piece mask (pixels on the product that differ from
  // the body it sits on).
  const body = dominantColor(data, W, H, onProduct, fgBox)
  const pieceTol2 = pieceTol * pieceTol
  const raw = new Uint8Array(W * H)
  for (let y = fgBox.miny; y <= fgBox.maxy; y++) {
    for (let x = fgBox.minx; x <= fgBox.maxx; x++) {
      const p = y * W + x
      if (!onProduct(p)) continue
      const o = p * 4
      const r = data[o], g = data[o + 1], b = data[o + 2]
      if (sq(r - body.r) + sq(g - body.g) + sq(b - body.b) <= pieceTol2) continue // it's the body
      if (warmOnly) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const sat = mx === 0 ? 0 : (mx - mn) / mx
        if (!(r - b > 12 && sat > 0.15)) continue // keep only warm/metallic pieces
      }
      raw[p] = 1
    }
  }

  // 3. bridge tiny gaps within a piece, then label
  const grouped = dilate(raw, W, H, 2)
  const minArea = Math.max(8, Math.round(sq(minPieceMm / mmPerPx) * 0.55))
  const { labels, comps } = connectedComponents(grouped, W, H, minArea)

  // 4. cut + size each piece (reject implausible blobs)
  const pieces = []
  for (const c of comps.sort((a, b) => b.area - a.area)) {
    const wMm = +(c.bbox.w * mmPerPx).toFixed(1)
    const hMm = +(c.bbox.h * mmPerPx).toFixed(1)
    const longMm = Math.max(wMm, hMm)
    if (longMm < minPieceMm || longMm > maxPieceMm) continue
    // reject non-charm blobs by colour + texture. Real charms read bright and/or
    // warm and are metallic (high internal contrast); a camera cut-out or deep
    // shadow is dark-neutral or large & flat.
    const st = componentStats(data, W, labels, c)
    const lum = (st.r + st.g + st.b) / 3
    const mx = Math.max(st.r, st.g, st.b), mn = Math.min(st.r, st.g, st.b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    if (lum < 70 && sat < 0.18) continue // dark neutral (hole / shadow)
    if (longMm > 13 && st.lumStd < 14 && sat < 0.22) continue // large flat patch (e.g. camera window)
    const cut = cutComponent(data, W, labels, c)
    pieces.push({ ...cut, widthMm: wMm, heightMm: hMm, longMm, areaPx: c.area, bbox: c.bbox, ...tierFromMm(longMm) })
  }

  // 5. annotated overlay (product box = cyan, pieces = magenta) for review
  const overlay = buildOverlay(imageData, fgBox, pieces)

  return { mmPerPx, product: { pxW: fgBox.w, pxH: fgBox.h, longMm: +(productLongPx * mmPerPx).toFixed(1) }, pieces, overlay }
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
  ctx.strokeRect(fgBox.minx, fgBox.miny, fgBox.w, fgBox.h)
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
