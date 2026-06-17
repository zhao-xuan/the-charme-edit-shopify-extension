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
import { loadAdmin } from '../lib/adminStore'

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

  const kf = CAMERA_KEEPOUT[p.camera.kind] || CAMERA_KEEPOUT.bar
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
  ['iphone-air', 'iPhone Air', 74.7, 156.2, 'bar', 50],
]
  .map((a) => makePhone(...a))
  .map(applyPhotoCase)
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
  .map((p) => ({ ...p, basePrice: PHONE_BASE_PRICE }))

/** Sub-brand display labels (used to group the Android model dropdown). */
export const BRAND_LABELS = {
  apple: 'Apple',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
  huawei: 'Huawei',
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
 * Fold the merchant overrides (lib/adminStore.js) into the catalogue: apply any
 * per-model price overrides, then append a "Custom" group holding the merchant's
 * own uploaded products. Runs once at module load, so the storefront reflects
 * saved admin changes on its next load.
 */
function applyAdminOverrides(groups) {
  const admin = loadAdmin()
  const priced = groups.map((g) => ({
    ...g,
    products: g.products.map((p) => ({
      ...p,
      basePrice: admin.productPrices[p.id] ?? p.basePrice,
    })),
  }))
  const custom = (admin.customProducts || []).map(buildCustomProduct)
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

export const PRODUCT_GROUPS = applyAdminOverrides(BASE_PRODUCT_GROUPS)

export const ALL_PRODUCTS = PRODUCT_GROUPS.flatMap((g) => g.products)

export function findProduct(id) {
  return ALL_PRODUCTS.find((p) => p.id === id)
}
