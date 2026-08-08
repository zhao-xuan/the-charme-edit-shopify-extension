import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { extractPieces, extractTransparentPieces } from './segment.js'

const photo = (name) => fileURLToPath(new URL(`../../reference/1-charms-real-image/${name}`, import.meta.url))

async function loadPhoto(name) {
  const { data, info } = await sharp(photo(name))
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height }
}

async function extract(name) {
  return extractPieces(await loadPhoto(name), {
    productLongMm: 167,
    pieceTol: 58,
    minPieceMm: 3,
    warmOnly: false,
    renderOutput: false,
  })
}

async function extractRendered(name) {
  return extractRenderedImage(await loadPhoto(name))
}

function extractRenderedImage(imageData, options = {}) {
  const captures = []
  const originalDocument = globalThis.document
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0 }
      const context = {
        createImageData(width, height) {
          return { data: new Uint8ClampedArray(width * height * 4), width, height }
        },
        putImageData(imageData) {
          captures.push({
            width: canvas.width,
            height: canvas.height,
            data: new Uint8ClampedArray(imageData.data),
          })
        },
        fillRect() {},
        strokeRect() {},
      }
      canvas.getContext = () => context
      canvas.toDataURL = () => 'data:image/png;base64,'
      return canvas
    },
  }
  try {
    const result = extractPieces(imageData, {
      productLongMm: 167,
      pieceTol: 58,
      minPieceMm: 3,
      warmOnly: false,
      ...options,
    })
    return {
      result,
      cuts: captures.filter((capture) => (
        capture.width !== imageData.width || capture.height !== imageData.height
      )),
    }
  } finally {
    globalThis.document = originalDocument
  }
}

function syntheticFlowerOnSquare() {
  const width = 320
  const height = 520
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x, y, r, g, b) => {
    const offset = (y * width + x) * 4
    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = 255
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onCase = x >= 50 && x <= 270 && y >= 30 && y <= 490
      paint(x, y, ...(onCase ? [222, 222, 222] : [252, 252, 252]))
    }
  }
  for (let y = 185; y <= 305; y++) {
    for (let x = 100; x <= 220; x++) paint(x, y, 242, 242, 238)
  }
  const centerX = 160
  const centerY = 245
  for (let petal = 0; petal < 5; petal++) {
    const angle = -Math.PI / 2 + petal * Math.PI * 2 / 5
    const petalX = centerX + Math.cos(angle) * 24
    const petalY = centerY + Math.sin(angle) * 24
    for (let y = Math.floor(petalY - 22); y <= Math.ceil(petalY + 22); y++) {
      for (let x = Math.floor(petalX - 18); x <= Math.ceil(petalX + 18); x++) {
        if (((x - petalX) / 18) ** 2 + ((y - petalY) / 22) ** 2 <= 1) paint(x, y, 224, 72, 145)
      }
    }
  }
  for (let y = centerY - 10; y <= centerY + 10; y++) {
    for (let x = centerX - 10; x <= centerX + 10; x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= 100) paint(x, y, 238, 126, 38)
    }
  }
  return { data, width, height }
}

function syntheticEdgeOverhang() {
  const width = 320
  const height = 520
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x, y, r, g, b) => {
    const offset = (y * width + x) * 4
    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = 255
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onProduct = x >= 70 && x <= 250 && y >= 30 && y <= 490
      paint(x, y, ...(onProduct ? [218, 218, 218] : [250, 250, 250]))
    }
  }
  const centerX = 70
  const centerY = 240
  for (let y = centerY - 27; y <= centerY + 27; y++) {
    for (let x = centerX - 27; x <= centerX + 27; x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= 27 ** 2) paint(x, y, 120, 60, 10)
    }
  }
  for (let y = 130; y <= 145; y++) {
    for (let x = 40; x <= 55; x++) paint(x, y, 120, 60, 10)
  }
  return { data, width, height }
}

function standaloneImage(width = 384, height = 384) {
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const offset = (y * width + x) * 4
    data[offset] = r
    data[offset + 1] = g
    data[offset + 2] = b
    data[offset + 3] = 255
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) paint(x, y, 253, 253, 253)
  }
  return { data, width, height, paint }
}

function syntheticStandaloneStar() {
  const image = standaloneImage()
  const centerX = image.width / 2
  const centerY = 190
  const pointDistance = (x, y, ax, ay, bx, by) => {
    const dx = bx - ax
    const dy = by - ay
    const amount = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(x - (ax + amount * dx), y - (ay + amount * dy))
  }
  const star = [[centerX, 74], [centerX + 24, 154], [centerX + 92, 190], [centerX + 25, 212], [centerX, 322], [centerX - 25, 212], [centerX - 92, 190], [centerX - 24, 154], [centerX, 74]]
  for (let y = 50; y < 330; y++) {
    for (let x = 90; x < 294; x++) {
      const ringDistance = Math.abs(Math.hypot(x - centerX, y - 48) - 23)
      let edgeDistance = Infinity
      for (let index = 1; index < star.length; index++) {
        edgeDistance = Math.min(edgeDistance, pointDistance(x, y, ...star[index - 1], ...star[index]))
      }
      const distance = Math.min(ringDistance, edgeDistance)
      if (distance <= 4) image.paint(x, y, 190 + ((x + y) % 45), 119, 10)
      else if (distance <= 5) image.paint(x, y, 249, 245, 233)
    }
  }
  return image
}

function syntheticStandalonePearl() {
  const image = standaloneImage()
  const centerX = image.width / 2
  const centerY = image.height / 2
  for (let y = 116; y <= 268; y++) {
    for (let x = 116; x <= 268; x++) {
      const distance = Math.hypot(x - centerX, y - centerY)
      if (distance > 76) continue
      const pearlDistance = Math.hypot(x - (centerX + 7), y - (centerY - 4))
      if (pearlDistance <= 42) {
        const shade = Math.max(175, Math.min(249, Math.round(235 - pearlDistance * 0.7 + (x - y) * 0.05)))
        image.paint(x, y, shade, shade + 3, shade + 5)
      } else {
        const wave = Math.round(28 * Math.sin(Math.atan2(y - centerY, x - centerX) * 3))
        const shade = Math.max(105, Math.min(242, 188 + wave))
        image.paint(x, y, shade, shade + 2, shade + 4)
      }
    }
  }
  return image
}

function transparentStandaloneCharm() {
  const width = 200
  const height = 160
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 30; y < 110; y++) {
    for (let x = 40; x < 140; x++) {
      const offset = (y * width + x) * 4
      data[offset] = 210
      data[offset + 1] = 155
      data[offset + 2] = 35
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

test('auto-extract finds all five pieces on the difficult white case', async () => {
  const result = await extract('Image_20260619201443_367_2327.jpg')
  assert.equal(result.product.detected, true)
  assert.equal(result.pieces.length, 5)
})

test('auto-extract cuts pieces to transparent, softly matted edges', async () => {
  const { result, cuts } = await extractRendered('Image_20260619201443_367_2327.jpg')
  assert.equal(cuts.length, result.pieces.length)
  for (const cut of cuts) {
    const alpha = cut.data.filter((_, index) => index % 4 === 3)
    assert.ok(alpha.some((value) => value === 0), 'cut-out should contain transparent background')
    assert.ok(alpha.some((value) => value > 0 && value < 255), 'cut-out should contain a soft alpha edge')
    assert.ok(alpha.some((value) => value === 255), 'cut-out should retain an opaque subject')
  }
})

test('auto-extract removes a subtly different square backing around a colourful flower', () => {
  const { result, cuts } = extractRenderedImage(syntheticFlowerOnSquare(), { pieceTol: 25 })
  assert.equal(result.pieces.length, 1)
  assert.equal(cuts.length, 1)
  const [cut] = cuts
  const cornerAlpha = [
    cut.data[3],
    cut.data[(cut.width - 1) * 4 + 3],
    cut.data[((cut.height - 1) * cut.width) * 4 + 3],
    cut.data[(cut.height * cut.width - 1) * 4 + 3],
  ]
  assert.deepEqual(cornerAlpha, [0, 0, 0, 0])
  assert.ok(cut.width < 100, `cut width should follow the flower, received ${cut.width}px`)
  assert.ok(cut.height < 100, `cut height should follow the flower, received ${cut.height}px`)
})

test('auto-extract keeps an overhanging charm but rejects detached objects outside the product box', () => {
  const { result, cuts } = extractRenderedImage(syntheticEdgeOverhang())
  assert.equal(result.product.detector, 'edge-drop')
  assert.equal(result.product.pxW, 181)
  assert.equal(result.pieces.length, 1)
  assert.equal(cuts.length, 1)
  assert.ok(result.pieces[0].bbox.minx <= 44, `piece should extend outside the product box, received x=${result.pieces[0].bbox.minx}`)
  assert.ok(cuts[0].width >= 53, `cut should retain the full overhanging charm, received ${cuts[0].width}px`)
})

test('auto-extract finds 17 pieces and rejects the black-case camera opening', async () => {
  const result = await extract('Image_20260619214422_369_2327.jpg')
  assert.equal(result.product.detected, true)
  assert.equal(result.pieces.length, 17)
})

test('auto-extract preserves soft transparent edges on the black case', async () => {
  const { result, cuts } = await extractRendered('Image_20260619214422_369_2327.jpg')
  assert.equal(cuts.length, result.pieces.length)
  for (const cut of cuts) {
    const alpha = cut.data.filter((_, index) => index % 4 === 3)
    assert.ok(alpha.some((value) => value === 0), 'cut-out should contain transparent background')
    assert.ok(alpha.some((value) => value > 0 && value < 255), 'cut-out should contain a soft alpha edge')
    assert.ok(alpha.some((value) => value === 255), 'cut-out should retain an opaque subject')
  }
})

test('auto-extract stops when the photo has no product body', async () => {
  const result = await extract('Image_20260619201121_366_2327.jpg')
  assert.equal(result.product.detected, false)
  assert.equal(result.pieces.length, 0)
})

for (const [name, fixture] of [
  ['outlined gold star', syntheticStandaloneStar],
  ['silver pearl', syntheticStandalonePearl],
]) {
  test(`auto-extract cuts one ${name} from a white-background product image`, () => {
    const { result, cuts } = extractRenderedImage(fixture(), {
      mode: 'standalone',
      standaloneLongMm: 30,
    })
    assert.equal(result.product.mode, 'standalone')
    assert.equal(result.pieces.length, 1)
    assert.equal(cuts.length, 1)
    const alpha = cuts[0].data.filter((_, index) => index % 4 === 3)
    assert.ok(alpha.some((value) => value === 0), 'cut-out should have a transparent background')
    assert.ok(alpha.some((value) => value > 0 && value < 255), 'cut-out should keep a soft edge')
    assert.ok(alpha.some((value) => value === 255), 'cut-out should keep an opaque core')
  })
}

test('GPT transparent single-charm import maps the alpha subject to the entered long side', () => {
  const result = extractTransparentPieces(transparentStandaloneCharm(), {
    standaloneLongMm: 30,
    renderOutput: false,
  })
  assert.equal(result.pieces.length, 1)
  assert.equal(result.pieces[0].pxW, 100)
  assert.equal(result.pieces[0].pxH, 80)
  assert.equal(result.pieces[0].widthMm, 30)
  assert.equal(result.pieces[0].heightMm, 24)
  assert.equal(result.pieces[0].longMm, 30)
})

test('GPT transparent plain-background import separates multiple components at one reference scale', () => {
  const width = 180
  const height = 100
  const data = new Uint8ClampedArray(width * height * 4)
  const fill = (left, top, right, bottom, color) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) data.set([...color, 255], (y * width + x) * 4)
  }
  fill(20, 20, 79, 79, [200, 50, 50])
  fill(120, 35, 149, 64, [50, 80, 200])
  const result = extractTransparentPieces({ data, width, height }, { standaloneLongMm: 30, renderOutput: false })
  assert.equal(result.pieces.length, 2)
  assert.deepEqual(result.pieces.map((piece) => piece.longMm), [30, 15])
})

test('plain-background extraction separates multiple decorations using one reference scale', () => {
  const width = 240
  const height = 160
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) data.set([255, 255, 255, 255], pixel * 4)
  const fill = (left, top, right, bottom, color) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) data.set([...color, 255], (y * width + x) * 4)
  }
  fill(30, 35, 89, 94, [190, 40, 60])
  fill(150, 50, 179, 79, [40, 90, 190])
  const result = extractPieces({ data, width, height }, { mode: 'standalone', standaloneLongMm: 30, renderOutput: false })
  assert.equal(result.pieces.length, 2)
  assert.deepEqual(result.pieces.map((piece) => piece.longMm), [30, 15])
})