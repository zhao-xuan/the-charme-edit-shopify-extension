/**
 * charmMask.js — per-charm alpha shape masks for shape-accurate collision.
 *
 * Each charm PNG is already an edge-cut cut-out (transparent around the piece).
 * To make boundary/overlap detection follow that real shape instead of the
 * bounding rectangle, we downsample each charm's alpha channel into a small
 * occupancy grid (a "mask") the geometry code samples in millimetre space.
 *
 * Masks are computed lazily in the browser from the already-loaded charm image
 * (no build step, no JSON bloat) and cached by src. While a mask is still
 * loading — or if pixel readback is blocked (CORS) — callers get `null` and
 * fall back to the rectangular OBB. `onMaskReady` lets the UI re-validate once
 * a mask arrives.
 */

const MASK_LONG = 26 // cells along the charm's longer side
const ALPHA_THRESHOLD = 40 // alpha >= this counts as "solid" charm

const cache = new Map() // src -> mask | 'loading' | null
const listeners = new Set()

/** Subscribe to "a new mask finished loading". Returns an unsubscribe fn. */
export function onMaskReady(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) fn()
}

/**
 * Get the cached shape mask for a charm image, kicking off a one-time async
 * computation on first request. Returns:
 *   { w, h, pts }  — grid dims + Float32Array of opaque cell centres as
 *                    normalised local coords (u, v in [-0.5, 0.5]).
 *   null           — still loading, or readback failed → use the OBB fallback.
 */
export function getCharmMask(src) {
  if (!src) return null
  const v = cache.get(src)
  if (v === undefined) {
    cache.set(src, 'loading')
    loadMask(src)
    return null
  }
  return v === 'loading' ? null : v
}

function loadMask(src) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height)
      let mw
      let mh
      if (aspect >= 1) {
        mw = MASK_LONG
        mh = Math.max(1, Math.round(MASK_LONG / aspect))
      } else {
        mh = MASK_LONG
        mw = Math.max(1, Math.round(MASK_LONG * aspect))
      }
      const cv = document.createElement('canvas')
      cv.width = mw
      cv.height = mh
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, mw, mh)
      const data = ctx.getImageData(0, 0, mw, mh).data
      const pts = []
      for (let row = 0; row < mh; row++) {
        for (let col = 0; col < mw; col++) {
          if (data[(row * mw + col) * 4 + 3] >= ALPHA_THRESHOLD) {
            pts.push((col + 0.5) / mw - 0.5, (row + 0.5) / mh - 0.5)
          }
        }
      }
      // Degenerate (fully transparent) → no usable mask, fall back to OBB.
      cache.set(src, pts.length ? { w: mw, h: mh, pts: Float32Array.from(pts) } : null)
    } catch {
      cache.set(src, null) // tainted canvas / readback blocked → OBB fallback
    }
    notify()
  }
  img.onerror = () => {
    cache.set(src, null)
    notify()
  }
  img.src = src
}
