/**
 * process-cases.mjs
 * -------------------------------------------------------------------------
 * Downloads the REAL Apple iPhone case product renders (straight-on back view,
 * transparent PNG) from Apple's image CDN and trims them to a tight bounding box
 * so they can be used as the customizer's case base layer.
 *
 * The catalogue offers two finishes — BLACK and WHITE. Apple only ever made
 * black-family silicone (Midnight / Black) for the 13, 14 and 17 generations and
 * white-family silicone (Vanilla) for the 17 generation, so those finishes use
 * the real Apple product photo. Every other (model, finish) has no Apple photo
 * and falls back to the parametric gel render in products.js.
 *
 * Apple's live store only lists current models, but its image CDN still serves
 * every render by permanent part-code forever. The older codes here were
 * recovered from the Internet Archive Wayback Machine snapshots of
 * apple.com/shop/iphone/accessories/cases-protection (product-page URLs encode
 * the colour + SKU); the 17 family comes from the live store. Every image below
 * is fetched fresh from Apple's CDN at full resolution.
 *
 * All Apple case photos share the same framing (~0.50 aspect, camera island
 * top-left), so a single per-camera-kind keep-out calibration (in products.js)
 * covers them all.
 *
 * Run with:  npm run cases
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_IMG = join(ROOT, 'public', 'assets', 'cases')
const OUT_DATA = join(ROOT, 'src', 'data')

const cdn = (code) =>
  `https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/${code}?wid=2000&hei=2000&fmt=png-alpha`

/**
 * Real Apple case image part-codes per model. Only the BLACK (Midnight / Black)
 * silicone render is fetched per model; the WHITE finish is derived from it by a
 * clean pure-white recolour (see recolorBlackToWhite) so every model gets a
 * consistent, model-matched PURE WHITE silicone case — Apple never sold white
 * silicone for most of these, but its own black render gives the exact correct
 * silhouette, camera island, logo and lighting to recolour.
 * Codes recovered from the Wayback Machine + Apple's live store; fetched fresh.
 */
const CASES = {
  // iPhone 7 / 8 share one case (single camera) — Apple "Black".
  'iphone-7': { black: 'MQGK2' },
  'iphone-8': { black: 'MQGK2' },
  // iPhone 7 Plus / 8 Plus share one case (horizontal dual camera) — "Black".
  'iphone-7-plus': { black: 'MMQR2' },
  'iphone-8-plus': { black: 'MMQR2' },
  // iPhone X / Xs / Xs Max — Black silicone.
  'iphone-x': { black: 'MQT12' },
  'iphone-xs': { black: 'MRW72' },
  'iphone-xs-max': { black: 'MRWE2' },
  // iPhone 11 family — Black silicone.
  'iphone-11': { black: 'MWVU2' },
  'iphone-11-pro': { black: 'MWYN2' },
  'iphone-11-pro-max': { black: 'MX002' },
  // iPhone 12 family — Black silicone (12 & 12 Pro share one case).
  'iphone-12-mini': { black: 'MHKX3' },
  'iphone-12': { black: 'MHL73' },
  'iphone-12-pro': { black: 'MHL73' },
  'iphone-12-pro-max': { black: 'MHLG3' },
  // iPhone 13 family — Black silicone.
  'iphone-13-mini': { black: 'MM223' },
  'iphone-13': { black: 'MM2A3' },
  'iphone-13-pro': { black: 'MM2K3' },
  'iphone-13-pro-max': { black: 'MM2U3' },
  // iPhone 14 family — Midnight silicone.
  'iphone-14': { black: 'MPRU3' },
  'iphone-14-plus': { black: 'MPT33' },
  'iphone-14-pro': { black: 'MPTE3' },
  'iphone-14-pro-max': { black: 'MPTP3' },
  // iPhone 15 family — Black silicone.
  'iphone-15': { black: 'MT0J3' },
  'iphone-15-plus': { black: 'MT103' },
  'iphone-15-pro': { black: 'MT1A3' },
  'iphone-15-pro-max': { black: 'MT1M3' },
  // iPhone 16 — only the Pro Max black silicone render is confirmed; the rest of
  // the 16 line falls back to the parametric gel (black gel = black case).
  'iphone-16-pro-max': { black: 'MYYT3' },
  // iPhone 17 family — Black silicone (live store).
  'iphone-17': { black: 'MGF14' },
  'iphone-17-pro': { black: 'MGFK4' },
  'iphone-17-pro-max': { black: 'MGFR4' },
}

/**
 * Recolour an Apple BLACK silicone render into a clean PURE WHITE silicone case.
 * The black body (luminance ~30–70) is lifted to bright white while the darkest
 * pixels — the camera lens glass — stay a soft grey, so the camera island reads
 * as a real white silicone surround with visible lenses (no flat slab, no hard
 * rectangle). A smooth control-point curve does the tone mapping; colour is
 * fully desaturated to luminance for a neutral pure white (a whisper of warmth
 * so it isn't clinical). Soft alpha at the silhouette edge is preserved.
 */
const WHITE_PTS = [[0, 120], [16, 168], [30, 226], [48, 246], [66, 255], [255, 255]]
const WHITE_LUT = (() => {
  const f = (l) => {
    for (let i = 1; i < WHITE_PTS.length; i++) {
      const [x0, y0] = WHITE_PTS[i - 1]
      const [x1, y1] = WHITE_PTS[i]
      if (l <= x1) return Math.round(y0 + ((y1 - y0) * (l - x0)) / (x1 - x0))
    }
    return 255
  }
  return Array.from({ length: 256 }, (_, l) => f(l))
})()

async function recolorBlackToWhite(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 8) continue
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    const v = WHITE_LUT[Math.round(lum)]
    data[o] = v
    data[o + 1] = v
    data[o + 2] = Math.round(v * 0.992) // whisper of warmth
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Fetch + trim the Apple BLACK render, save it, then derive the PURE WHITE
 *  recolour. Returns the geometry + the list of finishes written. */
async function processModel(model, code) {
  const res = await fetch(cdn(code))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  const black = await sharp(input).trim({ threshold: 12 }).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(join(OUT_IMG, `${model}-black.png`), black)
  const white = await recolorBlackToWhite(black)
  await writeFile(join(OUT_IMG, `${model}-white.png`), white)
  const meta = await sharp(black).metadata()
  return { w: meta.width, h: meta.height, aspect: +(meta.width / meta.height).toFixed(4) }
}

async function main() {
  await mkdir(OUT_IMG, { recursive: true })
  await mkdir(OUT_DATA, { recursive: true })

  const cases = {}
  let ok = 0
  let fail = 0
  for (const [model, finishes] of Object.entries(CASES)) {
    try {
      process.stdout.write(`· ${model} (${finishes.black}) … `)
      const r = await processModel(model, finishes.black)
      cases[model] = {
        aspect: r.aspect,
        images: {
          black: `/assets/cases/${model}-black.png`,
          white: `/assets/cases/${model}-white.png`,
        },
      }
      ok += 2
      console.log(`ok ${r.w}×${r.h} (${r.aspect}) — black + pure-white`)
    } catch (err) {
      fail++
      console.log(`skip: ${err.message}`)
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'apple.com black silicone renders (Wayback Machine + live store); white = clean pure-white recolour of each black render',
    cases,
  }
  await writeFile(join(OUT_DATA, 'cases.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nWrote ${Object.keys(cases).length} models (${ok} images, ${fail} skipped) → src/data/cases.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
