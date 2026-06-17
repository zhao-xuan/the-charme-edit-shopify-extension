/**
 * exportImage.js — render the finished design to two PNG proofs.
 *
 *  • "placeholder"  — Statement (type-1) charms rendered faithfully; Feature
 *    (type-2) and Filler (type-3) charms shown as dashed outline zones. This is
 *    the technical proof the maker works from.
 *  • "sample"       — Statement charms faithful; Feature/Filler rendered with a
 *    representative charm image so the customer sees the finished vibe.
 *
 * Everything is drawn in product millimetres × a high DPI factor, mirroring the
 * on-screen coordinate space so the proof matches the live preview exactly.
 */
import { resolveAsset } from './assets'

const DPI = 6 // px per mm
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const imgCache = new Map()
function loadImage(src) {
  if (imgCache.has(src)) return imgCache.get(src)
  const p = new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
  imgCache.set(src, p)
  return p
}

// Reusable glitter-gel sparkle texture (masked to the case silhouette below).
const GLITTER_SRC = resolveAsset('/assets/cases/glitter.png')

/**
 * Composite the glitter-gel sparkle over a real case photo, clipped to the
 * case silhouette using the photo's own alpha (offscreen destination-in), so
 * the on-screen "Glitter" finish is reproduced in the downloaded proof.
 */
async function drawGlitter(ctx, photoImg, W, H) {
  const tex = await loadImage(GLITTER_SRC).catch(() => null)
  if (!tex) return
  const off = document.createElement('canvas')
  off.width = Math.round(W)
  off.height = Math.round(H)
  const octx = off.getContext('2d')
  octx.drawImage(tex, 0, 0, off.width, off.height)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(photoImg, 0, 0, off.width, off.height)
  ctx.save()
  ctx.globalAlpha = 0.9
  ctx.drawImage(off, 0, 0, W, H)
  ctx.restore()
}

async function drawProduct(ctx, product, color, S) {
  const W = product.widthMm * S
  const H = product.heightMm * S
  const r = product.radiusMm * S

  // Real product photo (e.g. the Apple iPhone case render) for this finish.
  const photoSrc = resolveAsset(
    product.blankImage && (product.blankImage[color.id] || product.blankImage.default),
  )
  if (photoSrc) {
    const img = await loadImage(photoSrc).catch(() => null)
    if (img) {
      ctx.drawImage(img, 0, 0, W, H)
      // Glitter-gel finish: sparkle texture masked to the case silhouette.
      if (color.glitter) await drawGlitter(ctx, img, W, H)
      return
    }
  }

  // rim
  roundRect(ctx, 0, 0, W, H, r)
  ctx.fillStyle = color.edge
  ctx.fill()

  // shell
  const inset = 1.4 * S
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, r - inset)
  ctx.fillStyle = color.shell
  ctx.fill()

  if (color.glitter) {
    ctx.save()
    roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, r - inset)
    ctx.clip()
    for (let i = 0; i < 220; i++) {
      ctx.globalAlpha = 0.25 + Math.random() * 0.4
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(Math.random() * W, Math.random() * H, (0.15 + Math.random() * 0.3) * S, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  // camera for phones (gel fallback — photo cases return above)
  if (product.kind === 'phone' && product.camera) {
    drawCamera(ctx, product.camera, color, S)
  }
}

/** Draw a representative camera island for the model's camera kind (gel proof). */
function drawCamera(ctx, cam, color, S) {
  const dark = color.id === 'black'
  const island = dark ? '#0c0c0c' : '#ece5d8'
  const ring = dark ? '#222' : '#cfc4b0'
  const glass = dark ? '#1b1b1b' : '#b9c0c4'
  const flash = dark ? '#d9dde0' : '#b9b09a'
  const x = cam.xMm * S
  const y = cam.yMm * S
  const w = cam.wMm * S
  const h = cam.hMm * S
  const lensAt = (cx, cy, lr) => {
    ctx.beginPath()
    ctx.arc(cx, cy, lr * 1.25, 0, Math.PI * 2)
    ctx.fillStyle = ring
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, lr, 0, Math.PI * 2)
    ctx.fillStyle = glass
    ctx.fill()
  }

  if (cam.kind === 'samsungV3' || cam.kind === 'samsungV4') {
    // floating vertical lenses, no island
    const count = cam.kind === 'samsungV4' ? 4 : 3
    const cx = x + w * 0.5
    const lr = w * 0.36
    const top = y + lr * 1.25
    const span = h - lr * 2.5
    for (let i = 0; i < count; i++) lensAt(cx, top + (span * i) / (count - 1), lr)
    return
  }

  if (cam.kind === 'circle') {
    const ccx = x + w / 2
    const ccy = y + h / 2
    const R = w / 2
    ctx.beginPath()
    ctx.arc(ccx, ccy, R, 0, Math.PI * 2)
    ctx.fillStyle = island
    ctx.fill()
    const lr = R * 0.2
    lensAt(ccx, ccy - R * 0.46, lr)
    lensAt(ccx - R * 0.42, ccy + R * 0.26, lr)
    lensAt(ccx + R * 0.42, ccy + R * 0.26, lr)
    return
  }

  // island-based kinds (iPhone + Xiaomi squareLarge)
  roundRect(ctx, x, y, w, h, cam.rMm * S)
  ctx.fillStyle = island
  ctx.fill()
  if (cam.kind === 'squareLarge') {
    const lr = w * 0.17
    const cxL = x + w * 0.33
    lensAt(cxL, y + h * 0.27, lr)
    lensAt(cxL, y + h * 0.55, lr)
    lensAt(cxL, y + h * 0.82, lr * 0.82)
    ctx.beginPath()
    ctx.arc(x + w * 0.72, y + h * 0.27, w * 0.06, 0, Math.PI * 2)
    ctx.fillStyle = flash
    ctx.fill()
    return
  }
  // iPhone-style: a row of three lenses
  const lensR = Math.min(cam.hMm, cam.wMm / 3) * 0.32 * S
  const cy = (cam.yMm + cam.hMm / 2) * S
  const startX = cam.xMm + cam.wMm * 0.22
  const gap = cam.wMm * 0.28
  for (let i = 0; i < 3; i++) lensAt((startX + i * gap) * S, cy, lensR)
}

function drawCharmImage(ctx, img, charm, S) {
  const w = charm.baseWmm * (charm.scale || 1) * S
  const h = charm.baseHmm * (charm.scale || 1) * S
  ctx.save()
  ctx.translate(charm.cxMm * S, charm.cyMm * S)
  ctx.rotate(((charm.rot || 0) * Math.PI) / 180)
  ctx.shadowColor = 'rgba(46,42,38,0.28)'
  ctx.shadowBlur = 3 * S * 0.4
  ctx.shadowOffsetY = 1.4 * S * 0.4
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}

function drawPlaceholder(ctx, charm, S) {
  const w = charm.baseWmm * (charm.scale || 1) * S
  const h = charm.baseHmm * (charm.scale || 1) * S
  ctx.save()
  ctx.translate(charm.cxMm * S, charm.cyMm * S)
  ctx.rotate(((charm.rot || 0) * Math.PI) / 180)
  ctx.setLineDash([4 * S * 0.4, 3 * S * 0.4])
  ctx.lineWidth = Math.max(1, 0.4 * S)
  ctx.strokeStyle = charm.type === 2 ? '#bfa15f' : '#a8524c'
  ctx.fillStyle = charm.type === 2 ? 'rgba(191,161,95,0.12)' : 'rgba(168,82,76,0.10)'
  roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.3)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Red dashed "indicative" outline around a charm whose final look may vary
 *  (fillers are arranged by hand; unique charms vary in size/shape/colour). */
function drawVariableOutline(ctx, charm, S) {
  const w = charm.baseWmm * (charm.scale || 1) * S
  const h = charm.baseHmm * (charm.scale || 1) * S
  const pad = 0.9 * S
  ctx.save()
  ctx.translate(charm.cxMm * S, charm.cyMm * S)
  ctx.rotate(((charm.rot || 0) * Math.PI) / 180)
  ctx.setLineDash([3.2 * S * 0.5, 2.2 * S * 0.5])
  ctx.lineWidth = Math.max(1.2, 0.5 * S)
  ctx.strokeStyle = '#d4380d'
  roundRect(ctx, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, Math.min(w, h) * 0.32)
  ctx.stroke()
  ctx.restore()
}

async function renderVersion(product, color, placed, mode) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(product.widthMm * DPI)
  canvas.height = Math.round(product.heightMm * DPI)
  const ctx = canvas.getContext('2d')

  // preload all charm images we will need
  await Promise.all(
    placed
      .filter((c) => mode === 'sample' || c.type === 1)
      .map((c) => loadImage(c.src).catch(() => null)),
  )

  await drawProduct(ctx, product, color, DPI)

  for (const charm of placed) {
    const faithful = mode === 'sample' || charm.type === 1
    if (faithful) {
      const img = await loadImage(charm.src).catch(() => null)
      if (img) drawCharmImage(ctx, img, charm, DPI)
      else drawPlaceholder(ctx, charm, DPI)
    } else {
      drawPlaceholder(ctx, charm, DPI)
    }
  }

  return canvas.toDataURL('image/png')
}

export async function renderBothVersions(product, color, placed) {
  const [placeholderUrl, sampleUrl] = await Promise.all([
    renderVersion(product, color, placed, 'placeholder'),
    renderVersion(product, color, placed, 'sample'),
  ])
  return { placeholderUrl, sampleUrl }
}

/**
 * Render a single illustrative preview: every charm drawn with its real image
 * so the customer sees the finished vibe, with a red dashed outline around any
 * charm whose final look is only indicative — fillers (arranged by hand) and
 * unique charms (which vary in size, shape, colour & pattern). `variableUids`
 * is the set of placed-charm uids to mark.
 */
export async function renderPreview(product, color, placed, variableUids = []) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(product.widthMm * DPI)
  canvas.height = Math.round(product.heightMm * DPI)
  const ctx = canvas.getContext('2d')

  await Promise.all(placed.map((c) => loadImage(c.src).catch(() => null)))
  await drawProduct(ctx, product, color, DPI)

  const variable = new Set(variableUids)
  for (const charm of placed) {
    const img = await loadImage(charm.src).catch(() => null)
    if (img) drawCharmImage(ctx, img, charm, DPI)
    else drawPlaceholder(ctx, charm, DPI)
    if (variable.has(charm.uid)) drawVariableOutline(ctx, charm, DPI)
  }

  return canvas.toDataURL('image/png')
}
