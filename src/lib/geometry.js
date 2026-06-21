/**
 * geometry.js — physical-space (millimetre) collision + boundary maths.
 *
 * Charms are tested against the printable area and each other by their real
 * edge-cut shape (a downsampled alpha mask from charmMask.js) wherever a mask
 * is available, falling back to an oriented bounding box (OBB) otherwise. The
 * OBB also serves as the broad-phase reject before the finer shape test. The
 * same maths drives the on-screen warnings and the exported artwork.
 */
import { getCharmMask } from './charmMask'

const toRad = (deg) => (deg * Math.PI) / 180

/** Point inside an axis-aligned rounded rectangle (elliptical corners). */
export function roundedRectContains(x, y, w, h, r, px, py) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const rx = Math.min(r, w / 2)
  const ry = Math.min(r, h / 2)
  let dx = 0
  let dy = 0
  if (px < x + rx) dx = px - (x + rx)
  else if (px > x + w - rx) dx = px - (x + w - rx)
  if (py < y + ry) dy = py - (y + ry)
  else if (py > y + h - ry) dy = py - (y + h - ry)
  if (dx !== 0 && dy !== 0) {
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1
  }
  return true
}

/** Four corners (mm) of an OBB {cx, cy, w, h, rot}. */
export function obbCorners({ cx, cy, w, h, rot = 0 }) {
  const a = toRad(rot)
  const ux = { x: Math.cos(a), y: Math.sin(a) }
  const uy = { x: -Math.sin(a), y: Math.cos(a) }
  const hw = w / 2
  const hh = h / 2
  return [
    { x: cx + ux.x * hw + uy.x * hh, y: cy + ux.y * hw + uy.y * hh },
    { x: cx - ux.x * hw + uy.x * hh, y: cy - ux.y * hw + uy.y * hh },
    { x: cx - ux.x * hw - uy.x * hh, y: cy - ux.y * hw - uy.y * hh },
    { x: cx + ux.x * hw - uy.x * hh, y: cy + ux.y * hw - uy.y * hh },
  ]
}

/** Midpoints of each OBB edge — extra sample points for boundary testing. */
function obbEdgeMidpoints(box) {
  const c = obbCorners(box)
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return [mid(c[0], c[1]), mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0])]
}

function projectionOverlap(cornersA, cornersB, axis) {
  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (const p of cornersA) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < minA) minA = d
    if (d > maxA) maxA = d
  }
  for (const p of cornersB) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < minB) minB = d
    if (d > maxB) maxB = d
  }
  return minA <= maxB && minB <= maxA
}

/** Separating-axis test between two OBBs, optionally inflated by `padMm`. */
export function obbOverlap(a, b, padMm = 0) {
  const A = padMm ? { ...a, w: a.w + padMm * 2, h: a.h + padMm * 2 } : a
  const B = padMm ? { ...b, w: b.w + padMm * 2, h: b.h + padMm * 2 } : b
  const ca = obbCorners(A)
  const cb = obbCorners(B)
  const axes = []
  for (const corners of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const dx = corners[i + 1].x - corners[i].x
      const dy = corners[i + 1].y - corners[i].y
      const len = Math.hypot(dx, dy) || 1
      axes.push({ x: -dy / len, y: dx / len })
    }
  }
  for (const axis of axes) {
    if (!projectionOverlap(ca, cb, axis)) return false
  }
  return true
}

/** OBB vs circle overlap (for circular keep-outs). */
function obbCircleOverlap(box, cx, cy, r) {
  const a = toRad(box.rot || 0)
  // circle centre in box-local frame
  const dx = cx - box.cx
  const dy = cy - box.cy
  const lx = dx * Math.cos(a) + dy * Math.sin(a)
  const ly = -dx * Math.sin(a) + dy * Math.cos(a)
  const clampedX = Math.max(-box.w / 2, Math.min(box.w / 2, lx))
  const clampedY = Math.max(-box.h / 2, Math.min(box.h / 2, ly))
  const ddx = lx - clampedX
  const ddy = ly - clampedY
  return ddx * ddx + ddy * ddy <= r * r
}

/** Convert a placed charm to its mm footprint OBB. */
export function charmFootprint(c) {
  return {
    cx: c.cxMm,
    cy: c.cyMm,
    w: c.baseWmm * (c.scale || 1),
    h: c.baseHmm * (c.scale || 1),
    rot: c.rot || 0,
  }
}

/** Does an OBB collide with a printable-area obstacle? */
function hitsObstacle(box, obstacle) {
  if (obstacle.type === 'circle') {
    return obbCircleOverlap(box, obstacle.cxMm, obstacle.cyMm, obstacle.rMm)
  }
  // rounded rect obstacle — approximate as a plain rect OBB (slightly cautious)
  const rectObb = {
    cx: obstacle.xMm + obstacle.wMm / 2,
    cy: obstacle.yMm + obstacle.hMm / 2,
    w: obstacle.wMm,
    h: obstacle.hMm,
    rot: 0,
  }
  return obbOverlap(box, rectObb)
}

/** Is the whole charm footprint (OBB) inside the printable region and clear of
 *  keep-outs? Used as the conservative fallback + the scatter packer. */
function boxFullyInside(box, printable) {
  const { outer, obstacles = [] } = printable
  const pts = [...obbCorners(box), ...obbEdgeMidpoints(box), { x: box.cx, y: box.cy }]
  for (const p of pts) {
    if (!roundedRectContains(outer.xMm, outer.yMm, outer.wMm, outer.hMm, outer.rMm, p.x, p.y)) {
      return false
    }
  }
  for (const ob of obstacles) {
    if (hitsObstacle(box, ob)) return false
  }
  return true
}

/* ---- shape (alpha-mask) collision ---------------------------------------- */

/** World-space (mm) position of a charm-local normalised point (u, v ∈ [-0.5,0.5]). */
function localToWorld(u, v, box) {
  const a = toRad(box.rot || 0)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const lx = u * box.w
  const ly = v * box.h
  return { x: box.cx + lx * cos - ly * sin, y: box.cy + lx * sin + ly * cos }
}

/** Is a world-space point inside a charm's shape mask? */
function maskHasWorldPoint(box, mask, wx, wy) {
  const a = toRad(box.rot || 0)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = wx - box.cx
  const dy = wy - box.cy
  const lx = dx * cos + dy * sin // inverse rotation
  const ly = -dx * sin + dy * cos
  const u = lx / box.w + 0.5
  const v = ly / box.h + 0.5
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false
  const col = Math.min(mask.w - 1, (u * mask.w) | 0)
  const row = Math.min(mask.h - 1, (v * mask.h) | 0)
  return mask.pts.length > 0 && maskBit(mask, col, row)
}

/** Fast occupancy lookup: a mask cell is "solid" if any opaque point falls in it.
 *  We rebuild a lazy boolean grid from `pts` on first use and cache it. */
function maskBit(mask, col, row) {
  let grid = mask.grid
  if (!grid) {
    grid = new Uint8Array(mask.w * mask.h)
    for (let k = 0; k < mask.pts.length; k += 2) {
      const c = Math.min(mask.w - 1, ((mask.pts[k] + 0.5) * mask.w) | 0)
      const r = Math.min(mask.h - 1, ((mask.pts[k + 1] + 0.5) * mask.h) | 0)
      grid[r * mask.w + c] = 1
    }
    mask.grid = grid
  }
  return grid[row * mask.w + col] === 1
}

/** mm size of one mask cell (used to pick the finer mask to iterate). */
function cellSize(box, mask) {
  return Math.max(box.w / mask.w, box.h / mask.h)
}

/** Is the charm's real cut-out shape fully inside the printable area and clear
 *  of keep-outs? Falls back to the OBB test until the mask has loaded. */
export function charmShapeInside(charm, printable) {
  const box = charmFootprint(charm)
  const mask = getCharmMask(charm.src)
  if (!mask) return boxFullyInside(box, printable)
  const { outer, obstacles = [] } = printable
  for (let k = 0; k < mask.pts.length; k += 2) {
    const w = localToWorld(mask.pts[k], mask.pts[k + 1], box)
    if (!roundedRectContains(outer.xMm, outer.yMm, outer.wMm, outer.hMm, outer.rMm, w.x, w.y)) {
      return false
    }
    for (const ob of obstacles) {
      if (pointInObstacle(w.x, w.y, ob)) return false
    }
  }
  return true
}

/** Point-in-keep-out test (circle or rounded rect). */
function pointInObstacle(px, py, ob) {
  if (ob.type === 'circle') {
    const dx = px - ob.cxMm
    const dy = py - ob.cyMm
    return dx * dx + dy * dy <= ob.rMm * ob.rMm
  }
  return roundedRectContains(ob.xMm, ob.yMm, ob.wMm, ob.hMm, ob.rMm || 0, px, py)
}

/** Do two charms' real cut-out shapes overlap? OBB broad-phase first, then a
 *  mask sample; conservatively treats an OBB hit with no masks yet as overlap. */
export function charmShapeOverlap(a, b) {
  const ba = charmFootprint(a)
  const bb = charmFootprint(b)
  if (!obbOverlap(ba, bb)) return false // broad-phase reject
  const ma = getCharmMask(a.src)
  const mb = getCharmMask(b.src)
  if (!ma || !mb) return true // overlapping boxes, shape unknown → cautious
  // Iterate the finer mask (smaller mm cell) and sample the other.
  let box1 = ba
  let m1 = ma
  let box2 = bb
  let m2 = mb
  if (cellSize(bb, mb) < cellSize(ba, ma)) {
    box1 = bb; m1 = mb; box2 = ba; m2 = ma
  }
  for (let k = 0; k < m1.pts.length; k += 2) {
    const w = localToWorld(m1.pts[k], m1.pts[k + 1], box1)
    if (maskHasWorldPoint(box2, m2, w.x, w.y)) return true
  }
  return false
}

/**
 * Validate a whole layout.
 * Returns per-charm flags { inside, overlap }, geometry/count breakdown and an
 * overall `ok`. `opts.minCharms` / `opts.maxCharms` gate the order on the piece
 * count (too few to craft, or so many the layout overcrowds).
 */
export function validateLayout(charms, product, opts = {}) {
  const { minCharms = 1, maxCharms = Infinity } = opts
  const flags = {}
  for (const c of charms) flags[c.uid] = { inside: true, overlap: false }

  for (const c of charms) {
    flags[c.uid].inside = charmShapeInside(c, product.printable)
  }
  for (let i = 0; i < charms.length; i++) {
    for (let j = i + 1; j < charms.length; j++) {
      if (charmShapeOverlap(charms[i], charms[j])) {
        flags[charms[i].uid].overlap = true
        flags[charms[j].uid].overlap = true
      }
    }
  }

  const geometryOk = charms.every((c) => flags[c.uid].inside && !flags[c.uid].overlap)
  const count = charms.length
  const tooFew = count < minCharms
  const tooMany = count > maxCharms
  const ok = geometryOk && !tooFew && !tooMany

  const problems = charms.filter(
    (c) => !flags[c.uid].inside || flags[c.uid].overlap,
  ).length

  return { flags, ok, problems, count, tooFew, tooMany, geometryOk }
}

/**
 * Find a free spot to scatter a (type-3) charm into the gaps.
 * Returns { cxMm, cyMm, rot } or null when the area is too full.
 */
export function findScatterSpot(product, placedCharms, charm, opts = {}) {
  const gapMm = opts.gapMm ?? 1.2
  const tries = opts.tries ?? 600
  // Max random rotation (deg) applied to the candidate spot. Scatter fillers
  // tumble (±20°); fixed/size charms are dropped upright (0).
  const rotMaxDeg = opts.rotMaxDeg ?? 20
  const { outer } = product.printable
  const placedBoxes = placedCharms.map(charmFootprint)
  const w = charm.widthMm
  const h = charm.heightMm

  for (let t = 0; t < tries; t++) {
    const rot = rotMaxDeg ? Math.random() * rotMaxDeg * 2 - rotMaxDeg : 0
    // bias toward later (looser) attempts using smaller rotation
    const cx = outer.xMm + Math.random() * outer.wMm
    const cy = outer.yMm + Math.random() * outer.hMm
    const box = { cx, cy, w, h, rot }
    if (!boxFullyInside(box, product.printable)) continue
    let clash = false
    for (const pb of placedBoxes) {
      if (obbOverlap(box, pb, gapMm)) {
        clash = true
        break
      }
    }
    if (!clash) return { cxMm: +cx.toFixed(2), cyMm: +cy.toFixed(2), rot: +rot.toFixed(1) }
  }
  return null
}

/** Clamp a charm centre so its footprint stays inside the printable outer rect. */
export function clampCenter(box, printable) {
  const { outer } = printable
  // half-extent of the rotated box on each axis
  const corners = obbCorners(box)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of corners) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const halfW = (maxX - minX) / 2
  const halfH = (maxY - minY) / 2
  const cx = Math.max(outer.xMm + halfW, Math.min(outer.xMm + outer.wMm - halfW, box.cx))
  const cy = Math.max(outer.yMm + halfH, Math.min(outer.yMm + outer.hMm - halfH, box.cy))
  return { cx, cy }
}
