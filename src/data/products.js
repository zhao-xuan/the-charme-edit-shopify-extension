/**
 * Product catalogue for the customizer.
 *
 * Every product is described in *real millimetres* so charm sizes (also in mm,
 * derived from the brand size guide) stay physically accurate at any zoom. The
 * on-screen pixel scale is derived at render time from these mm dimensions.
 *
 * `printable` describes the usable design area as an outer rounded rectangle
 * minus optional keep-out obstacles (e.g. the iPhone camera island). Boundary
 * detection uses this region.
 *
 * iPhone models use REAL Apple case product photos where available (codes for
 * older models recovered from the Internet Archive Wayback Machine — see
 * scripts/process-cases.mjs → cases.json). Models without a photo fall back to a
 * parametric gel render in White (Glitter gel) / Black (Black gel).
 */
import CASES_DATA from './cases.json'
import CAMERA_KEEPOUTS from './camera-keepouts.json'
import INTEGRATED_MODELS from './integrated-models.json'
import { loadAdmin } from '../lib/adminStore'
import { remoteCatalog } from '../lib/remoteCatalog'

// A phone case is described by two finish axes:
//   • Case colour — the silicone shell: White or Black. This drives the rendered
//     look (a real Apple photo where one exists, otherwise a parametric gel) and
//     the photo lookup key (cases.json is keyed by `white` / `black`).
//   • Gel colour  — the poured gel finish: Glitter, White or Black. `Glitter`
//     adds the sparkle overlay; the choice is always recorded on the order.
const CASE_COLOURS = [
  { id: 'white', label: 'White', shell: '#f7f0df', edge: '#e7ddc6', glitter: false },
  { id: 'black', label: 'Black', shell: '#1a1614', edge: '#000000', glitter: false },
]
const GEL_COLOURS = [
  { id: 'glitter', label: 'Glitter', shell: '#f7f0df', edge: '#e7ddc6', glitter: true },
  { id: 'white', label: 'White', shell: '#f7f0df', edge: '#e7ddc6', glitter: false },
  { id: 'black', label: 'Black', shell: '#1a1614', edge: '#000000', glitter: false },
]

// The poured gel is a real translucent-liquid-glass overlay laid on top of the
// case photo. Each iPhone maps to a representative gel shape that fits its camera
// layout + footprint (built by scripts/build-gels.mjs from reference/gels-source).
// Every 11–16 iPhone shares the top-left "17" gel; older single/dual-camera models
// and the wide-bar 17 Pro / Pro Max / Air each have their own.
const GEL_REP = {
  'iphone-7': '8', 'iphone-8': '8',
  'iphone-7-plus': '8plus', 'iphone-8-plus': '8plus',
  'iphone-x': 'xs', 'iphone-xs': 'xs', 'iphone-xs-max': 'xs',
  'iphone-17-pro': '17pro', 'iphone-17-pro-max': '17promax', 'iphone-air': 'air',
}
function gelOverlaySrc(id) {
  const rep = GEL_REP[id] || '17'
  return { white: `/assets/cases/gel-${rep}-white.png`, black: `/assets/cases/gel-${rep}-black.png` }
}

// The models with bespoke "integrated gel" renders — a single cohesive product
// photo per finish with the poured gel already fused onto the case
// (public/assets/cases/integrated-<id>-<white|black>.png, produced by
// scripts/crop-integrated-renders.mjs from GPT renders). The list is generated
// by that script (src/data/integrated-models.json) so it stays in sync as more
// models are rendered. For these models the gel colour drives the whole render —
// White/Glitter gel sits on a White case, Black gel on a Black case — so we swap
// the render in as the case photo and mark the product `gelRender` so the
// customizer derives the case finish from the gel and skips the gel overlay.
const INTEGRATED_GEL_MODELS = new Set(INTEGRATED_MODELS)
function applyIntegratedGel(p) {
  if (!INTEGRATED_GEL_MODELS.has(p.id)) return p
  return {
    ...p,
    gelRender: true,
    gelImages: null, // the gel is baked into the render — no separate overlay
    blankImage: {
      white: `/assets/cases/integrated-${p.id}-white.png`,
      black: `/assets/cases/integrated-${p.id}-black.png`,
    },
  }
}

// Single flat base price for every phone case (charms priced on top).
const PHONE_BASE_PRICE = 26

/**
 * Build a phone-case product from its real device footprint (mm) and camera
 * layout. The camera island becomes both a rendered detail and a placement
 * keep-out so charms never cover the lenses.
 *
 * cameraKind:
 *   'squareTriple' — Pro models 13–16: triple-lens square island, top-left
 *   'squareDual'   — non-Pro 13–16: dual-lens square, top-left
 *   'bar'          — 17 series: horizontal camera plateau across the top
 *   'samsungV3' / 'samsungV4' — Samsung Galaxy: floating vertical lens column,
 *                    top-left (no raised island)
 *   'squareLarge'  — Xiaomi: large rounded-square camera island, top-left
 *   'circle'       — Huawei: large circular camera island, top-centre
 */
function buildCamera(cameraKind, widthMm) {
  switch (cameraKind) {
    case 'bar':
      return { kind: 'bar', xMm: 7, yMm: 7, wMm: +(widthMm - 14).toFixed(1), hMm: 22, rMm: 11 }
    case 'squareTriple':
      return { kind: 'squareTriple', xMm: 7, yMm: 7, wMm: 34, hMm: 34, rMm: 12 }
    case 'squareLarge': // Xiaomi big island
      return { kind: 'squareLarge', xMm: 8, yMm: 8, wMm: 40, hMm: 42, rMm: 12 }
    case 'samsungV3': // Samsung S / Plus — 3 vertical lenses, no island
      return { kind: 'samsungV3', xMm: 8, yMm: 8, wMm: 15, hMm: 40, rMm: 7 }
    case 'samsungV4': // Samsung Ultra — taller lens column
      return { kind: 'samsungV4', xMm: 8, yMm: 8, wMm: 16, hMm: 52, rMm: 8 }
    case 'circle': { // Huawei round island, top-centre
      const d = 48
      return { kind: 'circle', xMm: +((widthMm - d) / 2).toFixed(1), yMm: 9, wMm: d, hMm: d, rMm: d / 2 }
    }
    case 'squareDual':
    default:
      return { kind: 'squareDual', xMm: 7, yMm: 7, wMm: 27, hMm: 27, rMm: 12 }
  }
}

function cameraObstacle(camera) {
  if (camera.kind === 'circle') {
    return {
      type: 'circle',
      cxMm: +(camera.xMm + camera.wMm / 2).toFixed(1),
      cyMm: +(camera.yMm + camera.hMm / 2).toFixed(1),
      rMm: camera.rMm,
      label: 'camera',
    }
  }
  return {
    type: 'roundedRect',
    xMm: camera.xMm,
    yMm: camera.yMm,
    wMm: camera.wMm,
    hMm: camera.hMm,
    rMm: camera.rMm,
    label: 'camera',
  }
}

function makePhone(id, name, widthMm, heightMm, cameraKind, basePrice, brand = 'apple') {
  const radiusMm = Math.round(widthMm * 0.16)
  const inset = 4
  const outer = {
    xMm: inset,
    yMm: inset,
    wMm: +(widthMm - inset * 2).toFixed(1),
    hMm: +(heightMm - inset * 2).toFixed(1),
    rMm: radiusMm - inset,
  }

  const camera = buildCamera(cameraKind, widthMm)

  return {
    id,
    group: 'phone',
    brand,
    name,
    kind: 'phone',
    basePrice,
    widthMm,
    heightMm,
    radiusMm,
    colors: CASE_COLOURS,
    caseColours: CASE_COLOURS,
    gelColours: GEL_COLOURS,
    // Poured-gel overlay images (only Apple models have real gel renders).
    gelImages: brand === 'apple' ? gelOverlaySrc(id) : null,
    printable: {
      outer,
      obstacles: [cameraObstacle(camera)],
    },
    camera,
  }
}

/**
 * Real Apple case photos are layered in per finish wherever Apple actually made
 * that colour. `blankImage` may hold a `black` photo, a `white` photo, both, or
 * neither — any finish without a photo renders as gel. Apple part-codes for the
 * older models were recovered from the Internet Archive Wayback Machine and
 * fetched fresh from Apple's CDN; the 17 family is from the live store (see
 * scripts/process-cases.mjs → cases.json).
 *
 * Every Apple case photo shares the same framing, so the camera keep-out is one
 * calibration per camera kind, expressed as fractions of the case footprint.
 */
const CAMERA_KEEPOUT = {
  // {x, y, w, h} as fractions of the case width / height — positioned to match
  // the real Apple camera island so the photo and gel-render finishes align.
  squareTriple: { x: 0.06, y: 0.03, w: 0.5, h: 0.3 }, // Pro triple-lens island, top-left
  squareDual: { x: 0.06, y: 0.03, w: 0.42, h: 0.26 }, // non-Pro dual-lens island, top-left
  bar: { x: 0.06, y: 0.03, w: 0.88, h: 0.3 }, // 17-series wide plateau
}

/**
 * Give every iPhone a White + Black case finish. Where Apple made a real silicone
 * in that colour we layer in its product photo (calibrating the footprint + camera
 * keep-out to the shared Apple framing); finishes without a real photo render as
 * gel using the CASE_COLOURS shell values.
 */
function applyPhotoCase(p) {
  const entry = CASES_DATA.cases[p.id]
  if (!entry || !entry.images || !Object.keys(entry.images).length) {
    // No Apple photo for this model → White + Black both render as gel.
    return { ...p, colors: CASE_COLOURS, caseColours: CASE_COLOURS, gelColours: GEL_COLOURS }
  }

  // Per-model camera keep-out. Where we have a real case photo we use the camera
  // region MEASURED straight from that photo (src/data/camera-keepouts.json —
  // see scripts/measure-camera-keepouts.mjs), which captures each model's true
  // lens layout (single / vertical-dual / square-dual / Pro triple island /
  // 17-series plateau). Models without a measured value fall back to the coarse
  // per-camera-kind fractions.
  const kf = CAMERA_KEEPOUTS[p.id] || CAMERA_KEEPOUT[p.camera.kind] || CAMERA_KEEPOUT.bar
  const camera = {
    kind: p.camera.kind,
    xMm: +(p.widthMm * kf.x).toFixed(1),
    yMm: +(p.heightMm * kf.y).toFixed(1),
    wMm: +(p.widthMm * kf.w).toFixed(1),
    hMm: +(p.heightMm * kf.h).toFixed(1),
    rMm: 13,
  }
  const inset = 3
  const outer = {
    xMm: inset,
    yMm: inset + 2,
    wMm: +(p.widthMm - inset * 2).toFixed(1),
    hMm: +(p.heightMm - inset * 2 - 2).toFixed(1),
    rMm: Math.round(p.widthMm * 0.16) - inset,
  }

  return {
    ...p,
    colors: CASE_COLOURS, // White + Black; a finish renders gel if it has no photo
    caseColours: CASE_COLOURS,
    gelColours: GEL_COLOURS,
    blankImage: entry.images, // { black?, white? } — real Apple photos
    printable: {
      outer,
      obstacles: [{ type: 'roundedRect', ...camera, label: 'camera' }],
    },
    camera,
  }
}

/**
 * Every iPhone from 7 → 17 (plus iPhone Air), with real case footprints and the
 * correct camera layout per generation. Models with a real Apple-photo case (see
 * cases.json) are swapped in by `applyPhotoCase`; the rest keep the parametric
 * gel render (which in black already reads as a black silicone case).
 */
const IPHONES = [
  // id, name, widthMm, heightMm, cameraKind, basePrice
  ['iphone-7', 'iPhone 7', 67.1, 138.3, 'squareDual', 26],
  ['iphone-8', 'iPhone 8', 67.3, 138.4, 'squareDual', 26],
  ['iphone-7-plus', 'iPhone 7 Plus', 77.9, 158.2, 'squareDual', 26],
  ['iphone-8-plus', 'iPhone 8 Plus', 78.1, 158.4, 'squareDual', 26],
  ['iphone-x', 'iPhone X', 70.9, 143.6, 'squareDual', 26],
  ['iphone-xs', 'iPhone XS', 70.9, 143.6, 'squareDual', 26],
  ['iphone-xs-max', 'iPhone XS Max', 77.4, 157.5, 'squareDual', 26],
  ['iphone-11', 'iPhone 11', 75.7, 150.9, 'squareDual', 26],
  ['iphone-11-pro', 'iPhone 11 Pro', 71.4, 144, 'squareTriple', 26],
  ['iphone-11-pro-max', 'iPhone 11 Pro Max', 77.8, 158, 'squareTriple', 26],
  ['iphone-12-mini', 'iPhone 12 mini', 64.2, 131.5, 'squareDual', 26],
  ['iphone-12', 'iPhone 12', 71.5, 146.7, 'squareDual', 26],
  ['iphone-12-pro', 'iPhone 12 Pro', 71.5, 146.7, 'squareTriple', 26],
  ['iphone-12-pro-max', 'iPhone 12 Pro Max', 78.1, 160.8, 'squareTriple', 26],
  ['iphone-13-mini', 'iPhone 13 mini', 67.5, 134.5, 'squareDual', 44],
  ['iphone-13', 'iPhone 13', 74.9, 149.7, 'squareDual', 46],
  ['iphone-13-pro', 'iPhone 13 Pro', 74.9, 149.7, 'squareTriple', 48],
  ['iphone-13-pro-max', 'iPhone 13 Pro Max', 81.4, 163.8, 'squareTriple', 50],
  ['iphone-14', 'iPhone 14', 74.9, 149.7, 'squareDual', 46],
  ['iphone-14-plus', 'iPhone 14 Plus', 81.4, 163.8, 'squareDual', 48],
  ['iphone-14-pro', 'iPhone 14 Pro', 74.9, 150.5, 'squareTriple', 48],
  ['iphone-14-pro-max', 'iPhone 14 Pro Max', 81, 163.7, 'squareTriple', 50],
  ['iphone-15', 'iPhone 15', 74.6, 150.6, 'squareDual', 46],
  ['iphone-15-plus', 'iPhone 15 Plus', 80.8, 163.9, 'squareDual', 48],
  ['iphone-15-pro', 'iPhone 15 Pro', 73.6, 149.6, 'squareTriple', 48],
  ['iphone-15-pro-max', 'iPhone 15 Pro Max', 79.7, 162.9, 'squareTriple', 50],
  ['iphone-16', 'iPhone 16', 74.6, 150.6, 'squareDual', 46],
  ['iphone-16-plus', 'iPhone 16 Plus', 80.8, 163.9, 'squareDual', 48],
  ['iphone-16-pro', 'iPhone 16 Pro', 74.5, 152.6, 'squareTriple', 48],
  ['iphone-16-pro-max', 'iPhone 16 Pro Max', 80.6, 166, 'squareTriple', 50],
  ['iphone-17', 'iPhone 17', 74.5, 152.6, 'bar', 46],
  ['iphone-17-pro', 'iPhone 17 Pro', 76, 153, 'bar', 48],
  ['iphone-17-pro-max', 'iPhone 17 Pro Max', 80.6, 166, 'bar', 50],
  // Case-outer footprint (bare 74.7×156.2 + ~3mm silicone wall) to match the
  // case-outer basis used by the rest of the line, so charms stay the same real
  // size across every model.
  ['iphone-air', 'iPhone Air', 77.7, 159.2, 'bar', 50],
]
  .map((a) => makePhone(...a))
  .map(applyPhotoCase)
  .map(applyIntegratedGel)
  // Every phone case shares one base price; charms are added on top.
  .map((p) => ({ ...p, basePrice: PHONE_BASE_PRICE, brand: 'apple' }))

/**
 * Mainstream Android flagships (Samsung / Xiaomi / Huawei), last few generations.
 * No reliable transparent official case render exists for these, so every finish
 * uses the parametric gel render — a black gel = black case, white gel = white
 * case — matched to each device's real footprint + camera layout.
 */
const ANDROIDS = [
  // id, name, widthMm, heightMm, cameraKind, basePrice, brand
  // — Samsung Galaxy S (floating vertical lens column) —
  ['galaxy-s24-ultra', 'Galaxy S24 Ultra', 79.0, 162.3, 'samsungV4', 26, 'samsung'],
  ['galaxy-s24-plus', 'Galaxy S24+', 75.9, 158.5, 'samsungV3', 26, 'samsung'],
  ['galaxy-s24', 'Galaxy S24', 70.6, 147.0, 'samsungV3', 26, 'samsung'],
  ['galaxy-s23-ultra', 'Galaxy S23 Ultra', 78.1, 163.4, 'samsungV4', 26, 'samsung'],
  ['galaxy-s23-plus', 'Galaxy S23+', 76.2, 157.8, 'samsungV3', 26, 'samsung'],
  ['galaxy-s23', 'Galaxy S23', 70.9, 146.3, 'samsungV3', 26, 'samsung'],
  ['galaxy-s22-ultra', 'Galaxy S22 Ultra', 77.9, 163.3, 'samsungV4', 26, 'samsung'],
  ['galaxy-s22-plus', 'Galaxy S22+', 75.8, 157.4, 'samsungV3', 26, 'samsung'],
  ['galaxy-s22', 'Galaxy S22', 70.6, 146.0, 'samsungV3', 26, 'samsung'],
  // — Xiaomi (large square Leica island) —
  ['xiaomi-14-pro', 'Xiaomi 14 Pro', 75.3, 161.4, 'squareLarge', 26, 'xiaomi'],
  ['xiaomi-14', 'Xiaomi 14', 71.5, 152.8, 'squareLarge', 26, 'xiaomi'],
  ['xiaomi-13-pro', 'Xiaomi 13 Pro', 74.6, 162.9, 'squareLarge', 26, 'xiaomi'],
  ['xiaomi-13', 'Xiaomi 13', 71.5, 152.8, 'squareLarge', 26, 'xiaomi'],
  // — Huawei (round camera island) —
  ['huawei-mate-60-pro', 'Huawei Mate 60 Pro', 75.9, 163.7, 'circle', 26, 'huawei'],
  ['huawei-mate-50-pro', 'Huawei Mate 50 Pro', 75.5, 162.1, 'circle', 26, 'huawei'],
  ['huawei-p60-pro', 'Huawei P60 Pro', 74.5, 161.0, 'circle', 26, 'huawei'],
]
  .map((a) => makePhone(...a))
  .map(applyIntegratedGel)
  // Only surface Android models that already have a generated integrated-gel
  // render. Models still awaiting a render are hidden for now; each reappears
  // automatically once its render lands in integrated-models.json.
  .filter((p) => INTEGRATED_GEL_MODELS.has(p.id))
  .map((p) => ({ ...p, basePrice: PHONE_BASE_PRICE }))

/** Sub-brand display labels (used to group the Android model dropdown). */
export const BRAND_LABELS = {
  apple: 'Apple',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
  huawei: 'Huawei',
}

// ---- Photo frames ----------------------------------------------------------
// A tabletop photo frame, decorated on its moulding (the border ring between the
// outer edge and the photo opening). Unlike cases/totes, charms may OVERHANG the
// frame — the boundary rule only needs ≥ `minCoverage` (60%) of each charm to
// stay on the moulding (see geometry.js charmShapeInside frame branch). The
// canvas carries a `margin` of clear space around the frame so an overhanging
// charm still renders inside the artwork (and the export PNG).
const FRAME_COLOURS = [
  { id: 'black', label: 'Black', shell: '#1c1c1c', edge: '#050505', glitter: false },
  { id: 'white', label: 'White', shell: '#fbfbf9', edge: '#e7e4dd', glitter: false },
]
const FRAME_BASE_PRICE = 24

/**
 * Build the photo-frame product. Real-ish 5×7" tabletop frame: a 152×216mm
 * outer moulding with a 22mm border around a 108×172mm photo opening, sat on a
 * 16mm margin so overhanging charms have room to render.
 */
function makeFrame() {
  const margin = 16
  const outerW = 152
  const outerH = 216
  const border = 22
  const widthMm = outerW + margin * 2
  const heightMm = outerH + margin * 2
  const outer = { xMm: margin, yMm: margin, wMm: outerW, hMm: outerH, rMm: 4 }
  const opening = {
    xMm: margin + border,
    yMm: margin + border,
    wMm: outerW - border * 2,
    hMm: outerH - border * 2,
    rMm: 3,
  }
  return {
    id: 'frame-5x7',
    group: 'frame',
    name: 'Photo Frame · 5×7”',
    kind: 'frame',
    basePrice: FRAME_BASE_PRICE,
    widthMm,
    heightMm,
    radiusMm: 4,
    colors: FRAME_COLOURS,
    caseColours: FRAME_COLOURS,
    // Border-ring placement: charms sit on the moulding and may overhang as long
    // as ≥60% of each stays on it.
    printable: {
      kind: 'frame',
      minCoverage: 0.6,
      outer,
      opening,
    },
  }
}

const BASE_PRODUCT_GROUPS = [
  {
    key: 'apple',
    label: 'Apple',
    platform: 'apple',
    blurb: 'Real Apple silicone cases (iPhone 7 → 17 + Air) with matched gel for every finish.',
    products: IPHONES,
  },
  {
    key: 'android',
    label: 'Android',
    platform: 'android',
    blurb: 'Samsung, Xiaomi & Huawei flagships in matched black or white gel.',
    products: ANDROIDS,
  },
  {
    key: 'tote',
    label: 'Totes',
    platform: 'tote',
    blurb: 'The classic Trader Joe’s cotton canvas tote.',
    products: [
      {
        id: 'tote-tj',
        group: 'tote',
        name: "Trader Joe's Tote",
        kind: 'tote',
        basePrice: 16,
        // Matches the trimmed photo aspect (450×683 ≈ 0.659) so patch sizes
        // stay physically accurate on the real bag image.
        widthMm: 400,
        heightMm: 607,
        radiusMm: 8,
        // Real Trader Joe's cotton canvas tote (see scripts/process-tote.mjs).
        blankImage: {
          natural: '/assets/totes/tj-natural.png',
        },
        colors: [
          { id: 'natural', label: "Natural canvas", shell: '#e9dec6', edge: '#1c2740', glitter: false },
        ],
        // Calibrated to the photo: cream front panel below the top hem (≈47%),
        // above the navy base (≈88%), clear of the red Trader Joe's crest.
        printable: {
          outer: { xMm: 40, yMm: 285, wMm: 320, hMm: 249, rMm: 8 },
          obstacles: [
            { type: 'circle', cxMm: 180, cyMm: 476, rMm: 44, label: 'logo' },
          ],
        },
      },
    ],
  },
  {
    key: 'frame',
    label: 'Frames',
    platform: 'frame',
    blurb: 'A classic tabletop photo frame in black or white — trim the moulding with charms.',
    products: [makeFrame()],
  },
]

/**
 * Turn a merchant's raw custom-product entry (name + uploaded body photo + real
 * width/height in mm + price) into a render-ready product. The whole panel minus
 * a small inset is craftable; charms place straight onto the uploaded artwork.
 */
function buildCustomProduct(raw) {
  const widthMm = Number(raw.widthMm) || 75
  const heightMm = Number(raw.heightMm) || 150
  const radiusMm = Math.max(2, Math.round(widthMm * 0.12))
  const inset = Math.max(4, Math.round(widthMm * 0.06))
  const colour = {
    id: 'default',
    label: raw.colourLabel || 'Default',
    shell: raw.shell || '#f2ece1',
    edge: '#d9cfbe',
    glitter: false,
  }
  return {
    id: raw.id,
    group: 'custom',
    name: raw.name || 'Custom product',
    kind: raw.kind === 'tote' ? 'tote' : 'phone',
    custom: true,
    basePrice: Number(raw.basePrice) || 0,
    widthMm,
    heightMm,
    radiusMm,
    colors: [colour],
    caseColours: [colour],
    blankImage: { default: raw.src },
    printable: {
      outer: {
        xMm: inset,
        yMm: inset,
        wMm: +(widthMm - inset * 2).toFixed(1),
        hMm: +(heightMm - inset * 2).toFixed(1),
        rMm: Math.max(2, radiusMm - inset),
      },
      obstacles: [],
    },
  }
}

/**
 * Fold the merchant overrides into the catalogue: apply per-model price
 * overrides (from the Cloudflare API + local admin), then append a "Custom"
 * group holding the merchant's own uploaded products (remote DB first, then any
 * local-only drafts).
 *
 * ⚠️ Built LAZILY + memoised (see the identical reasoning in lib/catalog.js): in
 * the Shopify IIFE widget build (inlineDynamicImports) this module evaluates the
 * moment the bundle script loads — BEFORE entry.jsx `await loadRemoteCatalog()`
 * populates the remote cache. Reading `remoteCatalog()` at module-eval would miss
 * the live catalogue (stale product prices / missing custom products). Building on
 * first ACCESS — which only happens during React render, after the await — folds
 * the live Shopify catalogue in reliably.
 */
function applyAdminOverrides(groups) {
  const admin = loadAdmin()
  const remote = remoteCatalog() || {}
  const remotePrices = (remote.overrides && remote.overrides.productPrices) || {}
  // A merchant product edited in Shopify (charme_product) carries its own
  // base_price; apply it to the matching model by id so admin re-pricing shows
  // up on the storefront.
  const remoteProductPrice = {}
  for (const p of remote.products || []) if (p.basePrice != null) remoteProductPrice[p.id] = p.basePrice
  const priceOf = (id, fallback) =>
    admin.productPrices[id] ?? remoteProductPrice[id] ?? remotePrices[id] ?? fallback
  const priced = groups.map((g) => ({
    ...g,
    products: g.products.map((p) => ({
      ...p,
      basePrice: priceOf(p.id, p.basePrice),
    })),
  }))
  // remote DB products first, then local-only drafts; de-dup by id. Skip any
  // whose id matches a built-in model (those are the migrated bodies — they keep
  // the bundled geometry/renders and only contribute their price above).
  const bundledIds = new Set(groups.flatMap((g) => g.products.map((p) => p.id)))
  const seen = new Set()
  const customRaw = []
  for (const p of remote.products || []) { if (!bundledIds.has(p.id) && !seen.has(p.id)) { seen.add(p.id); customRaw.push(p) } }
  for (const p of admin.customProducts || []) { if (!bundledIds.has(p.id) && !seen.has(p.id)) { seen.add(p.id); customRaw.push(p) } }
  const custom = customRaw.map(buildCustomProduct)
  if (custom.length) {
    priced.push({
      key: 'custom',
      label: 'Custom',
      platform: 'custom',
      blurb: 'Your own uploaded products.',
      products: custom,
    })
  }
  return priced
}

let _productCatalog = null
function productCatalog() {
  if (!_productCatalog) {
    const groups = applyAdminOverrides(BASE_PRODUCT_GROUPS)
    _productCatalog = { groups, all: groups.flatMap((g) => g.products) }
  }
  return _productCatalog
}

/** All product groups (bundled + merchant overrides), built on first access. */
export function productGroups() {
  return productCatalog().groups
}

/** Flat list of every product across all groups. */
export function allProducts() {
  return productCatalog().all
}

export function findProduct(id) {
  return productCatalog().all.find((p) => p.id === id)
}
