/**
 * process-tote.mjs
 * -------------------------------------------------------------------------
 * Produces the canvas-tote product blank from the real Trader Joe's cotton
 * shopping tote photo (the classic natural-canvas bag with navy handles/base
 * and the red Trader Joe's crest). The source is a "set of 2" product photo, so
 * we crop a single bag, flood-fill the white studio background to transparent,
 * trim to the bag outline, and save it for use as a photoreal product layer.
 *
 * The cropped bag is also analysed to derive the printable area (the plain
 * cream canvas panel between the top hem, the navy base, and clear of the front
 * pocket crest) which becomes the charm/patch placement region in products.js.
 *
 * Input is fetched in the browser (Amazon media is curl-friendly, but we keep a
 * local copy in .tote-src). Run with:  npm run tote   (expects .tote-src/tj-amazon-main.jpg)
 * -------------------------------------------------------------------------
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, '.tote-src', 'tj-amazon-main.jpg')
const OUT_IMG = join(ROOT, 'public', 'assets', 'totes')
const OUT_DATA = join(ROOT, 'src', 'data')

const TOL = 26 // distance from white backdrop
const FEATHER = 42

function knockout(data, w, h) {
  const n = w * h
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, (n - 1) * 4]
  let sr = 0, sg = 0, sb = 0
  for (const c of corners) { sr += data[c]; sg += data[c + 1]; sb += data[c + 2] }
  sr /= 4; sg /= 4; sb /= 4
  const tol2 = TOL * TOL
  const fth2 = (TOL + FEATHER) * (TOL + FEATHER)
  for (const c of corners) { const p = c / 4; if (!visited[p]) { visited[p] = 1; stack[sp++] = p } }
  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb
    const d2 = dr * dr + dg * dg + db * db
    if (d2 > fth2) continue
    if (d2 <= tol2) data[i + 3] = 0
    else data[i + 3] = Math.round(((Math.sqrt(d2) - TOL) / FEATHER) * 255)
    const x = p % w, y = (p / w) | 0
    if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1 }
    if (x < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1 }
    if (y > 0 && !visited[p - w]) { visited[p - w] = 1; stack[sp++] = p - w }
    if (y < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack[sp++] = p + w }
  }
}

function bounds(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 18) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

async function main() {
  await mkdir(OUT_IMG, { recursive: true })
  const meta = await sharp(SRC).metadata()
  // crop the left bag of the set-of-2 photo
  const left = Math.round(meta.width * 0.035)
  const cropW = Math.round(meta.width * 0.46)
  const cropped = await sharp(SRC)
    .extract({ left, top: 0, width: cropW, height: meta.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  knockout(cropped.data, cropped.info.width, cropped.info.height)
  const box = bounds(cropped.data, cropped.info.width, cropped.info.height)

  const png = await sharp(cropped.data, {
    raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 },
  })
    .extract(box)
    .png({ compressionLevel: 9 })
    .toBuffer()

  await writeFile(join(OUT_IMG, 'tj-natural.png'), png)

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'amazon.co.uk EXZMA Trader Joe’s cotton canvas tote (B0CRQ6ZX8F)',
    totes: {
      'tote-tj': {
        src: '/assets/totes/tj-natural.png',
        pxW: box.width,
        pxH: box.height,
        aspect: +(box.width / box.height).toFixed(4),
      },
    },
  }
  await writeFile(join(OUT_DATA, 'totes.json'), JSON.stringify(manifest, null, 2))
  console.log(`tote blank ${box.width}×${box.height} (aspect ${(box.width / box.height).toFixed(3)}) → public/assets/totes/tj-natural.png`)
}

main().catch((e) => { console.error(e); process.exit(1) })
