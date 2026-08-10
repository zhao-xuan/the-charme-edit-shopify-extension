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
 * Shopify-hosted case photos override bundled art for matching models. Models
 * without a reviewed photo retain the parametric preview until art is supplied.
 */
import CASES_DATA from './cases.json'
import CAMERA_KEEPOUTS from './camera-keepouts.json'
import GENERATED_PHONE_BODY_IMAGES from './generated-phone-body-images.json'
import OFFICIAL_PHONE_CASE_IMAGE_BOUNDS from './official-phone-case-image-bounds.json'
import OFFICIAL_PHONE_CASE_IMAGES from './official-phone-case-images.json'
import BASE_PRODUCT_VARIANTS from '../../shopify/widget/variantmap-products.generated.json'
import { loadAdmin } from '../lib/adminStore'
import { ANDROID_LAUNCH_MODEL_IDS, trustedCaseImages } from '../lib/caseImagePolicy'
import { measuredCameraKeepout } from '../lib/appleCameraKeepouts.js'
import { remoteCatalog } from '../lib/remoteCatalog'
import {
  samsungCameraObstacles,
  samsungCameraObstaclesByCaseColour,
} from '../lib/samsungCameraKeepouts'

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
// layout + footprint for the prebuilt gel overlay assets.
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
  return { white: `/assets/cases/gel-alone/gel-${rep}-white.png`, black: `/assets/cases/gel-alone/gel-${rep}-black.png` }
}

const PLAIN_IPHONE_MODELS = new Set([
  'iphone-7', 'iphone-7-plus', 'iphone-8', 'iphone-8-plus',
  'iphone-x', 'iphone-xs', 'iphone-xs-max',
  'iphone-xr',
  'iphone-11', 'iphone-11-pro', 'iphone-11-pro-max',
  'iphone-12', 'iphone-12-mini', 'iphone-12-pro', 'iphone-12-pro-max',
  'iphone-13', 'iphone-13-mini', 'iphone-13-pro', 'iphone-13-pro-max',
  'iphone-14', 'iphone-14-plus', 'iphone-14-pro', 'iphone-14-pro-max',
  'iphone-15', 'iphone-15-plus', 'iphone-15-pro', 'iphone-15-pro-max',
  'iphone-16', 'iphone-16-plus', 'iphone-16-pro', 'iphone-16-pro-max',
  'iphone-17', 'iphone-17-pro', 'iphone-17-pro-max', 'iphone-air',
])
function applyPlainIphoneCase(product) {
  if (!PLAIN_IPHONE_MODELS.has(product.id)) return product

  // These images are measured case renders even when they are not listed in
  // cases.json. Apply their per-model camera calibration here as well; without
  // this, older models such as iPhone 7 fall back to the generic 27 × 27 mm
  // square-dual obstacle despite having a small horizontal single-camera cutout.
  const camera = measuredCameraKeepout(product, CAMERA_KEEPOUTS[product.id])
  const hasMeasuredCamera = camera !== null

  return {
    ...product,
    gelRender: false,
    blankImage: {
      white: `/assets/cases/case-without-gel/${product.id}-white.png`,
      black: `/assets/cases/case-without-gel/${product.id}-black.png`,
    },
    ...(hasMeasuredCamera ? {
      camera,
      printable: {
        ...product.printable,
        obstacles: [{ type: 'roundedRect', ...camera, label: 'camera' }],
      },
    } : {}),
  }
}

// Android blank-case art must never contain poured gel. Use only verified files
// from case-without-gel; models and finishes without one stay out of the editor.
const PLAIN_CASE_IMAGES = {
  'pixel-6-pro': ['black', 'white'],
  'pixel-7-pro': ['black', 'white'],
  'pixel-8-pro': ['black', 'white'],
  'pixel-9-pro': ['black', 'white'],
  'pixel-10-pro': ['black', 'white'],
  'galaxy-s22': ['black'],
  'galaxy-s22-plus': ['black', 'white'],
  'galaxy-s22-ultra': ['black'],
  'galaxy-s23-ultra': ['black', 'white'],
  'galaxy-s24': ['white'],
  'galaxy-s24-plus': ['white'],
  'galaxy-s24-ultra': ['black', 'white'],
  'galaxy-s25-ultra': ['black', 'white'],
  'galaxy-s26-ultra': ['black', 'white'],
}
function applyPlainCase(p) {
  const colours = PLAIN_CASE_IMAGES[p.id] || []
  const blankImage = Object.fromEntries(
    colours.map((colour) => [colour, `/assets/cases/case-without-gel/${p.id}-${colour}.png`]),
  )
  const caseColours = CASE_COLOURS.filter((colour) => colours.includes(colour.id))
  const gelColours = GEL_COLOURS.filter((gel) =>
    colours.includes(gel.id === 'black' ? 'black' : 'white'),
  )
  return {
    ...p,
    gelRender: false,
    gelImages: null,
    plainCaseOnly: true,
    linkedFinish: true,
    ...(colours.length ? {
      blankImage,
      colors: caseColours,
      caseColours,
      gelColours,
    } : {}),
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
 *   'single'       — iPhone 16e / 17e: single lens with flash, top-left
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
    case 'pixelBar':
      return { kind: 'bar', xMm: 5, yMm: 8, wMm: +(widthMm - 10).toFixed(1), hMm: 20, rMm: 10 }
    case 'pixelPill':
      return { kind: 'bar', xMm: 9, yMm: 8, wMm: +(widthMm - 18).toFixed(1), hMm: 20, rMm: 10 }
    case 'pixelOval':
      return { kind: 'bar', xMm: 8, yMm: 8, wMm: 27, hMm: 17, rMm: 8.5 }
    case 'single':
      return { kind: 'single', xMm: 7, yMm: 7, wMm: 22, hMm: 22, rMm: 11 }
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
  const calibratedCameraObstacles = samsungCameraObstacles(id, widthMm, heightMm)
  const cameraObstaclesByCaseColour = samsungCameraObstaclesByCaseColour(id, widthMm, heightMm)

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
      obstacles: calibratedCameraObstacles || [cameraObstacle(camera)],
      ...(cameraObstaclesByCaseColour ? { obstaclesByCaseColour: cameraObstaclesByCaseColour } : {}),
    },
    camera,
  }
}

/**
 * Real Apple case photos are layered in per finish wherever Apple actually made
 * that colour. `blankImage` may hold a `black` photo, a `white` photo, both, or
 * neither — any finish without a photo renders as gel. Apple part-codes for the
 * older models were recovered from the Internet Archive Wayback Machine and
 * fetched from Apple's CDN; the 17 family is from the live store.
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

  // The plain (gel-free) Apple case photos live under case-without-gel/ (they
  // were moved into that subfolder by the "organize case files" commit while
  // cases.json still records the old flat /assets/cases/<id>.png paths), so
  // rewrite each recorded path into the subfolder it is actually served from.
  const blankImage = {}
  for (const [colour, path] of Object.entries(entry.images)) {
    blankImage[colour] = path.replace('/assets/cases/', '/assets/cases/case-without-gel/')
  }

  return {
    ...p,
    colors: CASE_COLOURS, // White + Black; a finish renders gel if it has no photo
    caseColours: CASE_COLOURS,
    gelColours: GEL_COLOURS,
    blankImage, // { black?, white? } — real Apple photos (case-without-gel/)
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
  ['iphone-xr', 'iPhone XR', 75.7, 150.9, 'squareDual', 26],
  ['iphone-se-2020', 'iPhone SE (2020)', 67.3, 138.4, 'squareDual', 26],
  ['iphone-se-2022', 'iPhone SE (2022)', 67.3, 138.4, 'squareDual', 26],
  ['iphone-6-6s', 'iPhone 6 / 6s', 67.1, 138.3, 'squareDual', 26],
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
  ['iphone-16e', 'iPhone 16e', 71.5, 146.7, 'single', 46],
  ['iphone-17', 'iPhone 17', 74.5, 152.6, 'bar', 46],
  ['iphone-17-pro', 'iPhone 17 Pro', 76, 153, 'bar', 48],
  ['iphone-17-pro-max', 'iPhone 17 Pro Max', 80.6, 166, 'bar', 50],
  ['iphone-17e', 'iPhone 17e', 71.5, 146.7, 'single', 46],
  // Case-outer footprint (bare 74.7×156.2 + ~3mm silicone wall) to match the
  // case-outer basis used by the rest of the line, so charms stay the same real
  // size across every model.
  ['iphone-air', 'iPhone Air', 77.7, 159.2, 'bar', 50],
]
  .map((a) => makePhone(...a))
  .map(applyPhotoCase)
  .map(applyPlainIphoneCase)
  // Every phone case shares one base price; charms are added on top.
  .map((p) => ({ ...p, basePrice: PHONE_BASE_PRICE, brand: 'apple' }))

/**
 * Mainstream Android flagships (Samsung / Xiaomi / Huawei), last few generations.
 * No reliable transparent official case render exists for these, so every finish
 * uses the parametric gel render — a black gel = black case, white gel = white
 * case — matched to each device's real footprint + camera layout.
 */
const LEGACY_ANDROIDS = [
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
  // Every Android model is surfaced. Models with a generated integrated-gel
  // render use that baked photo; the rest fall back to the parametric gel render
  // (a black gel = black case, white gel = white case) drawn by ProductCanvas,
  // whose PhoneShell already knows each brand's camera layout (Samsung vertical
  // column, Huawei round island, Xiaomi square island), so no model is hidden
  // just for lacking a render.
  .map((p) => ({ ...applyPlainCase(p), basePrice: PHONE_BASE_PRICE }))

const LIVE_MODEL_IDS = [...new Set(Object.keys(BASE_PRODUCT_VARIANTS).map((key) => key.split(':')[0]))]
const titleToken = (token) => {
  if (token === 'plus') return '+'
  if (/^[as]\d+s?$/i.test(token)) return token.toUpperCase()
  if (/^\d+g$/i.test(token) || token === 'fe' || token === 'xl') return token.toUpperCase()
  if (token === 'z') return 'Z'
  return token.charAt(0).toUpperCase() + token.slice(1)
}
function liveModelName(id) {
  const isPixel = id.startsWith('pixel-')
  const prefix = isPixel ? 'Pixel ' : 'Galaxy '
  let name = id.replace(isPixel ? /^pixel-/ : /^galaxy-/, '').split('-').map(titleToken).join(' ')
  name = name.replace(/ (4G) (5G)$/, ' $1 / $2').replace(/^(A52) (A52S)/, '$1 / $2')
  return prefix + name
}

const PIXEL_SPECS = {
  'pixel-5': [70.4, 144.7, 'squareDual'],
  'pixel-6': [74.8, 158.6, 'pixelBar'],
  'pixel-6-pro': [75.9, 163.9, 'pixelBar'],
  'pixel-6a': [71.8, 152.2, 'pixelBar'],
  'pixel-7': [73.2, 155.6, 'pixelBar'],
  'pixel-7-pro': [76.6, 162.9, 'pixelBar'],
  'pixel-7a': [72.9, 152, 'pixelBar'],
  'pixel-8': [70.8, 150.5, 'pixelBar'],
  'pixel-8-pro': [76.5, 162.6, 'pixelBar'],
  'pixel-8a': [72.7, 152.1, 'pixelBar'],
  'pixel-9': [72, 152.8, 'pixelPill'],
  'pixel-9-pro': [72, 152.8, 'pixelPill'],
  'pixel-9-pro-xl': [76.6, 162.8, 'pixelPill'],
  'pixel-9a': [73.3, 154.7, 'pixelOval'],
  'pixel-10': [72, 152.8, 'pixelPill'],
  'pixel-10-pro': [72, 152.8, 'pixelPill'],
  'pixel-10-pro-xl': [76.6, 162.8, 'pixelPill'],
}

const SAMSUNG_SPECS = {
  'galaxy-a72-4g': [77.4, 165, 'samsungV3'],
  'galaxy-s9': [68.7, 147.7, 'samsungV3'],
  'galaxy-s9-plus': [73.8, 158.1, 'samsungV3'],
  'galaxy-s10-plus': [74.1, 157.6, 'samsungV3'],
  'galaxy-note-20-4g-5g': [75.2, 161.6, 'samsungV4'],
  'galaxy-note-20-ultra-4g-5g': [77.2, 164.8, 'samsungV4'],
}

function samsungSpec(id) {
  if (SAMSUNG_SPECS[id]) return SAMSUNG_SPECS[id]
  if (/z-fold/.test(id)) return [68, 155, 'samsungV3']
  if (/z-flip/.test(id)) return [72, 165, 'squareDual']
  if (/ultra|note/.test(id)) return [78, 163, 'samsungV4']
  if (/plus/.test(id)) return [76, 158, 'samsungV3']
  if (/^galaxy-s\d+-fe/.test(id)) return [77, 160, 'samsungV3']
  if (/^galaxy-s/.test(id)) return [71, 148, 'samsungV3']
  return [77, 164, 'samsungV3']
}

const LIVE_ANDROIDS = LIVE_MODEL_IDS
  .filter((id) => id.startsWith('galaxy-') || id.startsWith('pixel-'))
  .map((id) => {
    const brand = id.startsWith('pixel-') ? 'google' : 'samsung'
    const [widthMm, heightMm, cameraKind] = brand === 'google' ? PIXEL_SPECS[id] : samsungSpec(id)
    return applyPlainCase(makePhone(id, liveModelName(id), widthMm, heightMm, cameraKind, PHONE_BASE_PRICE, brand))
  })

const liveAndroidIds = new Set(LIVE_ANDROIDS.map((product) => product.id))
const ANDROIDS = [
  ...LIVE_ANDROIDS,
  ...LEGACY_ANDROIDS.filter((product) => !liveAndroidIds.has(product.id)),
]

const BUILT_IN_PRODUCT_IDS = new Set([
  ...IPHONES.map((product) => product.id),
  ...ANDROIDS.map((product) => product.id),
])

/** Sub-brand display labels (used to group the Android model dropdown). */
export const BRAND_LABELS = {
  apple: 'Apple',
  google: 'Google',
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
 * Build the measured 4×6" tabletop frame: a 122×170mm outer moulding around a
 * 90×140mm visible photo opening. The measured rails are 16mm left/right and
 * 15mm top/bottom. A 16mm canvas margin leaves room for overhanging charms.
 */
function makeFrame() {
  const margin = 16
  const outerW = 122
  const outerH = 170
  const openingW = 90
  const openingH = 140
  const insetX = (outerW - openingW) / 2
  const insetY = (outerH - openingH) / 2
  const widthMm = outerW + margin * 2
  const heightMm = outerH + margin * 2
  const outer = { xMm: margin, yMm: margin, wMm: outerW, hMm: outerH, rMm: 4 }
  const opening = {
    xMm: margin + insetX,
    yMm: margin + insetY,
    wMm: openingW,
    hMm: openingH,
    rMm: 3,
  }
  return {
    // Stable legacy key used by saved cross-sell settings and variant maps.
    id: 'frame-5x7',
    group: 'frame',
    name: 'Photo Frame · 4×6”',
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
    blurb: 'Google Pixel, Samsung, Xiaomi & Huawei cases in black or white.',
    products: ANDROIDS,
  },
  {
    key: 'tote',
    label: 'Totes',
    platform: 'tote',
    blurb: 'The Charmé Edit natural canvas tote.',
    products: [
      {
        id: 'tote-tj',
        group: 'tote',
        name: 'The Charmé Edit Tote',
        kind: 'tote',
        basePrice: 16,
        // The canvas includes the handles. The bag body itself is 420 x 360mm;
        // its photo is normalized to this shared physical coordinate space.
        widthMm: 420,
        heightMm: 630.7,
        radiusMm: 8,
        blankImage: {
          natural: '/assets/totes/charme-natural.png',
        },
        colors: [
          { id: 'natural', label: "Natural canvas", shell: '#e9dec6', edge: '#1c2740', glitter: false },
        ],
        printable: {
          outer: { xMm: 21, yMm: 270.7, wMm: 378, hMm: 304, rMm: 8 },
          obstacles: [
            { type: 'rect', xMm: 114, yMm: 270.7, wMm: 32.3, hMm: 304, label: 'left strap' },
            { type: 'rect', xMm: 275, yMm: 270.7, wMm: 32.3, hMm: 304, label: 'right strap' },
            { type: 'rect', xMm: 157, yMm: 501.8, wMm: 114, hMm: 46.2, label: 'logo' },
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

function scalePrintable(printable, scaleX, scaleY) {
  if (!printable || (scaleX === 1 && scaleY === 1)) return printable
  const scaleRadius = Math.min(scaleX, scaleY)
  const scaleRect = (rect) => ({
    ...rect,
    xMm: rect.xMm == null ? rect.xMm : +(rect.xMm * scaleX).toFixed(2),
    yMm: rect.yMm == null ? rect.yMm : +(rect.yMm * scaleY).toFixed(2),
    wMm: rect.wMm == null ? rect.wMm : +(rect.wMm * scaleX).toFixed(2),
    hMm: rect.hMm == null ? rect.hMm : +(rect.hMm * scaleY).toFixed(2),
    rMm: rect.rMm == null ? rect.rMm : +(rect.rMm * scaleRadius).toFixed(2),
  })
  const scaleObstacle = (obstacle) => obstacle.type === 'circle'
    ? {
        ...obstacle,
        cxMm: +(obstacle.cxMm * scaleX).toFixed(2),
        cyMm: +(obstacle.cyMm * scaleY).toFixed(2),
        rMm: +(obstacle.rMm * scaleRadius).toFixed(2),
      }
    : scaleRect(obstacle)
  return {
    ...printable,
    outer: scaleRect(printable.outer),
    ...(printable.opening ? { opening: scaleRect(printable.opening) } : {}),
    obstacles: (printable.obstacles || []).map(scaleObstacle),
  }
}

/**
 * Fold the merchant overrides into the catalogue: apply per-model price
 * overrides (from the Cloudflare API + local admin), then append a "Custom"
 * group holding the merchant's own uploaded products (remote DB first, then any
 * local-only drafts). Runs once at module load.
 */
function applyAdminOverrides(groups) {
  const admin = loadAdmin()
  const remote = remoteCatalog() || {}
  const remotePrices = (remote.overrides && remote.overrides.productPrices) || {}
  const remoteProducts = new Map((remote.products || []).map((product) => [product.id, product]))
  const remoteProductPrice = {}
  for (const p of remote.products || []) {
    if (p.basePrice != null) remoteProductPrice[p.id] = p.basePrice
  }
  const priceOf = (id, fallback) =>
    admin.productPrices[id] ?? remoteProductPrice[id] ?? remotePrices[id] ?? fallback
  const withRemoteImage = (product) => {
    const remoteProduct = remoteProducts.get(product.id)
    if (product.kind !== 'phone') {
      if (!remoteProduct) return product
      const isLegacyToteReference =
        product.id === 'tote-tj' &&
        Number(remoteProduct.widthMm) === 400 &&
        Number(remoteProduct.heightMm) === 607 &&
        /\/tote-tj-white\.png(?:\?|$)/.test(remoteProduct.src || '')
      if (isLegacyToteReference) return product
      const widthMm = Number(remoteProduct.widthMm) || product.widthMm
      const heightMm = Number(remoteProduct.heightMm) || product.heightMm
      const scaleX = widthMm / product.widthMm
      const scaleY = heightMm / product.heightMm
      const remoteImage = remoteProduct.src
      const blankImage = remoteImage
        ? Object.fromEntries(['default', ...(product.colors || []).map((color) => color.id)].map((key) => [key, remoteImage]))
        : product.blankImage
      return {
        ...product,
        ...(remoteProduct.name ? { name: remoteProduct.name } : {}),
        widthMm,
        heightMm,
        blankImage,
        printable: scalePrintable(product.printable, scaleX, scaleY),
      }
    }
    const blankImage = trustedCaseImages(product, {
      remoteProduct,
      generatedImages: GENERATED_PHONE_BODY_IMAGES[product.id],
      officialImages: OFFICIAL_PHONE_CASE_IMAGES[product.id],
    })
    const caseImageAvailability = {
      white: !!blankImage.white,
      black: !!blankImage.black,
    }
    const caseColours = CASE_COLOURS.map((colour) => ({
      ...colour,
      disabled: !caseImageAvailability[colour.id],
    }))
    const gelColours = GEL_COLOURS.map((gel) => ({
      ...gel,
      disabled: !caseImageAvailability[gel.id === 'black' ? 'black' : 'white'],
    }))
    return {
      ...product,
      blankImage,
      caseImageBounds: OFFICIAL_PHONE_CASE_IMAGE_BOUNDS[product.id] || {},
      caseImageAvailability,
      colors: caseColours,
      caseColours,
      gelColours,
      gelRender: false,
      linkedFinish: true,
    }
  }
  const priced = groups.map((g) => ({
    ...g,
    products: g.products.map((p) => {
      const product = withRemoteImage(p)
      return { ...product, basePrice: priceOf(product.id, product.basePrice) }
    }),
  }))
  // Remote DB products first, then local-only drafts; de-dup by id. Migrated
  // built-in models contribute price/images above and must not become duplicate
  // custom products.
  const bundledIds = new Set([
    ...BUILT_IN_PRODUCT_IDS,
    ...groups.flatMap((group) => group.products.map((product) => product.id)),
  ])
  const seen = new Set()
  const customRaw = []
  for (const product of remote.products || []) {
    if (!bundledIds.has(product.id) && !seen.has(product.id)) {
      seen.add(product.id)
      customRaw.push(product)
    }
  }
  for (const product of admin.customProducts || []) {
    if (!bundledIds.has(product.id) && !seen.has(product.id)) {
      seen.add(product.id)
      customRaw.push(product)
    }
  }
  const custom = customRaw.filter((product) => product.src).map(buildCustomProduct)
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

let productCatalogCache = null
function productCatalog() {
  if (!productCatalogCache) {
    const allGroups = applyAdminOverrides(BASE_PRODUCT_GROUPS)
    const groups = allGroups.filter((group) => group.key !== 'custom')
    productCatalogCache = { groups, all: allGroups.flatMap((group) => group.products) }
  }
  return productCatalogCache
}

export function productGroups() {
  return productCatalog().groups
}

export function allProducts() {
  return productCatalog().all
}

export function findProduct(id) {
  return productCatalog().all.find((product) => product.id === id)
}

export function hasCaseImage(product, finish) {
  if (!product) return false
  if (product.kind !== 'phone') return true
  if (product.caseImageAvailability) {
    return finish
      ? !!product.caseImageAvailability[finish]
      : Object.values(product.caseImageAvailability).some(Boolean)
  }
  const images = product.blankImage || {}
  return finish ? !!(images[finish] || images.default) : Object.values(images).some(Boolean)
}

const ANDROID_LAUNCH_RANK = new Map(
  ANDROID_LAUNCH_MODEL_IDS.map((modelId, index) => [modelId, index]),
)

export function productsByAvailability(products) {
  const available = products
    .filter((product) => hasCaseImage(product))
    .sort((left, right) => (
      (ANDROID_LAUNCH_RANK.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (ANDROID_LAUNCH_RANK.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ))
  const comingSoon = products
    .filter((product) => !hasCaseImage(product))
    .sort((left, right) => (
      (ANDROID_LAUNCH_RANK.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (ANDROID_LAUNCH_RANK.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ))
  return { available, comingSoon }
}
