/**
 * process-assets.mjs
 * -------------------------------------------------------------------------
 * Merchant-side asset pipeline (build-time version).
 *
 * For each real charm product photo (shot on a near-white background) this:
 *   1. downloads the high-res image,
 *   2. removes the background with a corner-seeded flood fill (keeps white
 *      highlights *inside* the object, only erases the connected backdrop),
 *   3. trims to the tight bounding box of the remaining pixels,
 *   4. records the cut-out pixel size + derives a real-world (mm) size from
 *      the brand's published size guide (Grande 2-4cm, Midi 1-2cm, Mini 0-1cm),
 *   5. writes the cut-out PNG to /public/assets/charms and a manifest to
 *      /src/data/catalog.json that the customizer consumes.
 *
 * This is the "analyse the artwork, measure it relative to the product, cut it
 * out and store the cut-out + relative size" step, run over real catalogue
 * imagery instead of mock data.
 *
 * Run with:  npm run assets
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_IMG = join(ROOT, 'public', 'assets', 'charms')
const OUT_DATA = join(ROOT, 'src', 'data')

/**
 * Tier definitions. `longMm` is the real-world length of the charm's longest
 * side, taken from the published size guide. Type maps the merchant tier to the
 * three user-facing interaction categories:
 *   type 1 = fixed-size statement charm (Grande)
 *   type 2 = resizable charm, bounded max (Midi)
 *   type 3 = scatter / filler charm placed by tapping gaps (Mini)
 */
const TIERS = {
  grande: { longMm: 32, type: 1, price: 3, minScale: 1, maxScale: 1 },
  midi: { longMm: 17, type: 2, price: 2, minScale: 0.75, maxScale: 1.6 },
  mini: { longMm: 11, type: 3, price: 2, minScale: 0.9, maxScale: 1.25 },
}

/** Storefront collection feed — the full Add-On Charms catalogue. */
const COLLECTION = 'https://thecharmeedit.com/collections/add-on-charms/products.json'

/**
 * Tier classification. The brand encodes the size tier (Grande / Midi / Mini)
 * in the product-title suffix ("… - Grande Charm", "… - Grande / Midi Charm")
 * and, for multi-size styles, in each variant's parenthetical "(Grande)" etc.
 * A few families are pinned explicitly:
 *   • Zodiac signs, Letters, Numbers, Tiles → Midi (resizable "Feature" charms)
 *   • Mini-filler crystals                  → Mini  (scatter "Filler" charms)
 * This is the "judge each charm's category from the charms page" step.
 */
const TIER_PINS = [
  { re: /zodiac/, tier: 'midi' },
  { re: /letters|initials|numbers/, tier: 'midi' },
  { re: /\btile\b|tiles/, tier: 'midi' }, // tiles are random-size feature charms
  { re: /mini filler/, tier: 'mini' },
]

function tierFromToken(t) {
  if (t.includes('grande')) return 'grande'
  if (t.includes('midi')) return 'midi'
  if (t.includes('mini')) return 'mini'
  return null
}

function classifyTier(productTitle, variantTitle) {
  const p = (productTitle || '').toLowerCase()
  const v = (variantTitle || '').toLowerCase()
  for (const pin of TIER_PINS) if (pin.re.test(p)) return pin.tier
  // a variant's own "(Grande)" / "(Midi)" / "(Mini)" marker is the most specific
  const vm = v.match(/\((grande|midi|mini)\)/)
  if (vm) return vm[1]
  // parse the "… - <tier>[ / <tier>] Charm" suffix from the product title
  const m = p.match(/-\s*([a-z\s/]+?)\s*charm\s*$/)
  if (m) {
    const tiers = m[1].split('/').map((s) => tierFromToken(s.trim())).filter(Boolean)
    if (tiers.length === 1) return tiers[0]
    if (tiers.length > 1) return 'midi' // multi-size styles default to Midi (most common)
  }
  // bare keyword anywhere, else Midi
  return tierFromToken(p) || 'midi'
}

/** Charm families whose photo is a flat-lay of several loose pieces but you only
 *  receive ONE — show a single piece by keeping the largest cut-out blob. */
const SINGLE_PIECE = /\btile\b|tiles/


const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

function variantName(productTitle, variantTitle) {
  const v = (variantTitle || '').trim()
  if (!v || /^default title$/i.test(v)) return productTitle
  // strip the size tier from the label — it's shown separately via the tier tab
  const clean = v.replace(/\((grande|midi|mini)\)/gi, '').replace(/\s{2,}/g, ' ').trim()
  return clean ? `${productTitle} · ${clean}` : productTitle
}

/** Fetch every product in the collection (paginated). */
async function fetchCollection() {
  const out = []
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(`${COLLECTION}?limit=250&page=${page}`)
    if (!res.ok) break
    const json = await res.json()
    const products = json.products || []
    if (products.length === 0) break
    out.push(...products)
    if (products.length < 250) break
  }
  return out
}

/**
 * Flatten the collection into one cut-out source per *unique* charm image.
 * Variants that share an image are de-duplicated; styles whose variants carry
 * no image fall back to the main product photo.
 */
function buildSources(products) {
  const sources = []
  const seenImg = new Set()
  const seenId = new Set()
  const uniqueId = (base) => {
    let id = base || 'charm'
    let n = 2
    while (seenId.has(id)) id = `${base}-${n++}`
    seenId.add(id)
    return id
  }

  for (const p of products) {
    const collection = p.title
    const titleLc = (p.title || '').toLowerCase()
    // Letters / Initials / Numbers have no per-character imagery on the store
    // (just one flat-lay sample), so we render individual glyph charms instead.
    if (/letters|initials|numbers/.test(titleLc)) continue
    const singlePiece = SINGLE_PIECE.test(titleLc)
    let added = 0
    for (const v of p.variants || []) {
      const img = v.featured_image
      const src = img && img.src
      if (!src) continue
      const key = src.split('?')[0]
      if (seenImg.has(key)) continue
      seenImg.add(key)
      sources.push({
        id: uniqueId(slug(`${p.title}-${v.title}`)),
        name: variantName(p.title, v.title),
        collection,
        tier: classifyTier(p.title, v.title),
        url: key,
        singlePiece,
      })
      added++
    }
    // Style with no per-variant imagery: fall back to the main product photo.
    if (added === 0 && Array.isArray(p.images) && p.images.length) {
      const key = p.images[0].src.split('?')[0]
      if (!seenImg.has(key)) {
        seenImg.add(key)
        sources.push({
          id: uniqueId(slug(p.title)),
          name: p.title,
          collection,
          tier: classifyTier(p.title, ''),
          url: key,
          singlePiece,
        })
      }
    }
  }
  return sources
}

const TOLERANCE = 38 // colour distance from the white backdrop seed
const FEATHER = 60 // soft edge band above tolerance

/** squared euclidean distance in RGB */
function dist2(data, i, r, g, b) {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  return dr * dr + dg * dg + db * db
}

/**
 * Remove the connected background via flood fill from the four corners.
 * Returns the same raw buffer with alpha zeroed (and feathered) on background.
 */
function knockoutBackground(data, width, height) {
  const n = width * height
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0

  // Seed colour = average of the four corners (assumed backdrop).
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, (n - 1) * 4]
  let sr = 0, sg = 0, sb = 0
  for (const c of corners) {
    sr += data[c]; sg += data[c + 1]; sb += data[c + 2]
  }
  sr /= 4; sg /= 4; sb /= 4

  const tol2 = TOLERANCE * TOLERANCE
  const feather2 = (TOLERANCE + FEATHER) * (TOLERANCE + FEATHER)

  for (const c of corners) {
    const p = c / 4
    if (!visited[p]) {
      visited[p] = 1
      stack[sp++] = p
    }
  }

  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const d2 = dist2(data, i, sr, sg, sb)
    if (d2 > feather2) continue // clearly part of the object, stop here

    if (d2 <= tol2) {
      data[i + 3] = 0 // solid background -> transparent
    } else {
      // edge band: ramp alpha so we don't leave a hard white halo
      const t = (Math.sqrt(d2) - TOLERANCE) / FEATHER
      data[i + 3] = Math.max(0, Math.min(255, Math.round(t * 255)))
    }

    const x = p % width
    const y = (p / width) | 0
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1 }
    if (x < width - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1 }
    if (y > 0 && !visited[p - width]) { visited[p - width] = 1; stack[sp++] = p - width }
    if (y < height - 1 && !visited[p + width]) { visited[p + width] = 1; stack[sp++] = p + width }
  }
  return data
}

/** Tight bounding box of pixels with alpha above a small threshold. */
function contentBounds(data, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * For "random pick" flat-lays (a pile of loose pieces) keep only the single
 * largest connected blob, so the charm reads as ONE piece, not the whole pile.
 */
function keepLargestComponent(data, width, height) {
  const n = width * height
  const label = new Int32Array(n)
  const stack = new Int32Array(n)
  const fg = (p) => data[p * 4 + 3] > 40
  let cur = 0
  let bestLabel = 0
  let bestSize = 0
  for (let start = 0; start < n; start++) {
    if (label[start] !== 0 || !fg(start)) continue
    cur++
    let sp = 0
    stack[sp++] = start
    label[start] = cur
    let size = 0
    while (sp > 0) {
      const p = stack[--sp]
      size++
      const x = p % width
      const y = (p / width) | 0
      if (x > 0 && label[p - 1] === 0 && fg(p - 1)) { label[p - 1] = cur; stack[sp++] = p - 1 }
      if (x < width - 1 && label[p + 1] === 0 && fg(p + 1)) { label[p + 1] = cur; stack[sp++] = p + 1 }
      if (y > 0 && label[p - width] === 0 && fg(p - width)) { label[p - width] = cur; stack[sp++] = p - width }
      if (y < height - 1 && label[p + width] === 0 && fg(p + width)) { label[p + width] = cur; stack[sp++] = p + width }
    }
    if (size > bestSize) { bestSize = size; bestLabel = cur }
  }
  if (!bestLabel) return
  for (let p = 0; p < n; p++) if (label[p] !== bestLabel) data[p * 4 + 3] = 0
}

async function processOne(src) {
  const res = await fetch(src.url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src.url}`)
  const input = Buffer.from(await res.arrayBuffer())

  // Downscale very large source images to keep cut-outs crisp but lean.
  const pre = sharp(input).resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await pre.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  knockoutBackground(data, info.width, info.height)
  if (src.singlePiece) keepLargestComponent(data, info.width, info.height)
  const box = contentBounds(data, info.width, info.height)
  if (!box) throw new Error(`No content found after knockout for ${src.id}`)

  const cut = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .png({ compressionLevel: 9 })

  const buf = await cut.toBuffer()
  await writeFile(join(OUT_IMG, `${src.id}.png`), buf)

  const tier = TIERS[src.tier]
  const long = Math.max(box.width, box.height)
  const widthMm = +((box.width / long) * tier.longMm).toFixed(1)
  const heightMm = +((box.height / long) * tier.longMm).toFixed(1)

  return {
    id: src.id,
    name: src.name,
    collection: src.collection,
    tier: src.tier,
    type: tier.type,
    price: tier.price,
    src: `/assets/charms/${src.id}.png`,
    pxW: box.width,
    pxH: box.height,
    widthMm,
    heightMm,
    minScale: tier.minScale,
    maxScale: tier.maxScale,
  }
}

/* ---- Individual letter & number charms ----------------------------------
 * Numbers: the brand's product photo (IMG-2879) shows the full 0–9 set in a
 * row, so each digit is cut straight out of the real photo — genuine gold-metal
 * charm cut-outs. Letters: the Letters/Initials photo only contains a handful
 * of scattered sample letters (not A–Z), so a full alphabet can't be cut; each
 * A–Z is rendered as a polished gold-metal charm whose tones are sampled from
 * the real number charms, so letters and numbers share one cohesive gold look.
 */
const NUMBERS_IMG = 'https://cdn.shopify.com/s/files/1/0922/3857/8042/files/IMG-2879.jpg'

/** Flood-fill knockout of the uniform cream backdrop from the four corners. */
function knockoutCream(data, W, H, tol = 46) {
  const n = W * H
  const seen = new Uint8Array(n)
  const st = new Int32Array(n)
  let sp = 0
  const corners = [0, W - 1, (H - 1) * W, n - 1]
  let sr = 0, sg = 0, sb = 0
  for (const c of corners) { sr += data[c * 4]; sg += data[c * 4 + 1]; sb += data[c * 4 + 2] }
  sr /= 4; sg /= 4; sb /= 4
  const t2 = tol * tol
  for (const c of corners) if (!seen[c]) { seen[c] = 1; st[sp++] = c }
  while (sp > 0) {
    const p = st[--sp], o = p * 4
    const dr = data[o] - sr, dg = data[o + 1] - sg, db = data[o + 2] - sb
    if (dr * dr + dg * dg + db * db > t2) continue
    data[o + 3] = 0
    const x = p % W, y = (p / W) | 0
    if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; st[sp++] = p - 1 }
    if (x < W - 1 && !seen[p + 1]) { seen[p + 1] = 1; st[sp++] = p + 1 }
    if (y > 0 && !seen[p - W]) { seen[p - W] = 1; st[sp++] = p - W }
    if (y < H - 1 && !seen[p + W]) { seen[p + W] = 1; st[sp++] = p + W }
  }
}

/** Label all foreground connected components with their bounding boxes. */
function allComponents(data, W, H) {
  const n = W * H
  const lab = new Int32Array(n)
  const st = new Int32Array(n)
  const fg = (p) => data[p * 4 + 3] > 60
  const comps = []
  let cur = 0
  for (let s = 0; s < n; s++) {
    if (lab[s] || !fg(s)) continue
    cur++; let sp = 0; st[sp++] = s; lab[s] = cur
    let minx = W, maxx = 0, miny = H, maxy = 0, area = 0
    while (sp > 0) {
      const p = st[--sp]; area++
      const x = p % W, y = (p / W) | 0
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
      if (x > 0 && !lab[p - 1] && fg(p - 1)) { lab[p - 1] = cur; st[sp++] = p - 1 }
      if (x < W - 1 && !lab[p + 1] && fg(p + 1)) { lab[p + 1] = cur; st[sp++] = p + 1 }
      if (y > 0 && !lab[p - W] && fg(p - W)) { lab[p - W] = cur; st[sp++] = p - W }
      if (y < H - 1 && !lab[p + W] && fg(p + W)) { lab[p + W] = cur; st[sp++] = p + W }
    }
    comps.push({ label: cur, area, minx, maxx, miny, maxy })
  }
  return { comps, lab }
}

const midiEntry = (id, name, collection, box) => {
  const tier = TIERS.midi
  const long = Math.max(box.width, box.height)
  return {
    id, name, collection, tier: 'midi', type: tier.type, price: 1,
    src: `/assets/charms/${id}.png`,
    pxW: box.width, pxH: box.height,
    widthMm: +((box.width / long) * tier.longMm).toFixed(1),
    heightMm: +((box.height / long) * tier.longMm).toFixed(1),
    minScale: tier.minScale, maxScale: tier.maxScale,
  }
}

/** Cut each 0–9 digit out of the real Numbers product photo. */
async function segmentNumbers() {
  const res = await fetch(NUMBERS_IMG)
  if (!res.ok) throw new Error(`HTTP ${res.status} for numbers photo`)
  const input = Buffer.from(await res.arrayBuffer())
  const { data, info } = await sharp(input).resize({ width: 2000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  knockoutCream(data, W, H)
  const { comps, lab } = allComponents(data, W, H)
  const digits = comps.filter((c) => c.area > 1200).sort((a, b) => a.minx - b.minx)
  if (digits.length !== 10) throw new Error(`expected 10 digits, found ${digits.length}`)
  const out = []
  for (let d = 0; d <= 9; d++) {
    const c = digits[d]
    const cw = c.maxx - c.minx + 1, ch = c.maxy - c.miny + 1
    const buf = Buffer.alloc(cw * ch * 4)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const sp = ((c.miny + y) * W + (c.minx + x)) * 4
      const dp = (y * cw + x) * 4
      const inside = lab[(c.miny + y) * W + (c.minx + x)] === c.label
      buf[dp] = data[sp]; buf[dp + 1] = data[sp + 1]; buf[dp + 2] = data[sp + 2]
      buf[dp + 3] = inside ? data[sp + 3] : 0
    }
    const id = `number-${d}`
    await writeFile(join(OUT_IMG, `${id}.png`),
      await sharp(buf, { raw: { width: cw, height: ch, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer())
    out.push(midiEntry(id, `Number ${d}`, 'Numbers', { width: cw, height: ch }))
  }
  return out
}

/* Polished gold metal, tones sampled from the real number charms (#e5af48 →
 * #f9f2e2): a vertical gradient with a thin specular band reads as real metal,
 * not a flat fill; a dark-gold edge gives the cut-charm definition. */
function letterSvg(ch) {
  const S = 640
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fbf3df"/>
    <stop offset="0.30" stop-color="#f2e3ad"/>
    <stop offset="0.46" stop-color="#ead08a"/>
    <stop offset="0.52" stop-color="#fffdf4"/>
    <stop offset="0.60" stop-color="#e6cb78"/>
    <stop offset="0.82" stop-color="#cda64c"/>
    <stop offset="1" stop-color="#a87d2c"/>
  </linearGradient></defs>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
    font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${Math.round(S * 0.8)}"
    fill="url(#g)" stroke="#8a6a26" stroke-width="${Math.round(S * 0.012)}" paint-order="stroke">${ch}</text>
</svg>`
}

async function renderLetter(ch) {
  const svg = Buffer.from(letterSvg(ch))
  const { data, info } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const box = contentBounds(data, info.width, info.height)
  if (!box) throw new Error(`empty letter "${ch}"`)
  const id = `letter-${ch.toLowerCase()}`
  await writeFile(join(OUT_IMG, `${id}.png`),
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(box).png({ compressionLevel: 9 }).toBuffer())
  return midiEntry(id, `Initial ${ch}`, 'Letters & Initials', box)
}

async function generateGlyphCharms() {
  const out = []
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') out.push(await renderLetter(ch))
  out.push(...(await segmentNumbers()))
  return out
}

async function main() {
  await mkdir(OUT_IMG, { recursive: true })
  await mkdir(OUT_DATA, { recursive: true })

  process.stdout.write('Fetching Add-On Charms collection … ')
  const products = await fetchCollection()
  const sources = buildSources(products)
  console.log(`${products.length} styles → ${sources.length} unique charm images`)

  const catalog = []
  for (const src of sources) {
    try {
      process.stdout.write(`· ${src.id} … `)
      const entry = await processOne(src)
      catalog.push(entry)
      console.log(`ok  ${entry.tier} (${entry.pxW}×${entry.pxH}px → ${entry.widthMm}×${entry.heightMm}mm)`)
    } catch (err) {
      console.log(`skip: ${err.message}`)
    }
  }

  // Individual letter & number charms (rendered — store has no per-glyph art).
  process.stdout.write('· numbers cut from photo + A–Z gold letters … ')
  try {
    const glyphs = await generateGlyphCharms()
    catalog.push(...glyphs)
    console.log(`ok (${glyphs.length})`)
  } catch (err) {
    console.log(`skip: ${err.message}`)
  }

  const byTier = (t) => catalog.filter((c) => c.tier === t).length
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'thecharmeedit.com/collections/add-on-charms',
    counts: { grande: byTier('grande'), midi: byTier('midi'), mini: byTier('mini'), total: catalog.length },
    charms: catalog,
  }
  await writeFile(join(OUT_DATA, 'catalog.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nWrote ${catalog.length} charms → src/data/catalog.json`)
  console.log(`  Grande ${byTier('grande')} · Midi ${byTier('midi')} · Mini ${byTier('mini')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
