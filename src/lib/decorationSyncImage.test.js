import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareDecorationSyncImage } from './decorationSyncImage.js'
import { loadImageData } from './segment.js'

function photo({ transparent = false, empty = false } = {}) {
  const width = 120, height = 120
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const subject = !empty && Math.hypot(x - 60, y - 60) < 26
      const offset = (y * width + x) * 4
      data.set(subject ? [180, 100, 20, 255] : [255, 255, 255, transparent ? 0 : 255], offset)
    }
  }
  return { data, width, height }
}

function stubGlobal(t, key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, key, original)
    else delete globalThis[key]
  })
}

function mockCanvas(t) {
  const renders = []
  stubGlobal(t, 'document', {
    createElement() {
      const canvas = { width: 0, height: 0 }
      let pixels
      canvas.getContext = () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
        putImageData: (image, x, y) => { pixels = image; canvas.offset = { x, y } },
        fillRect() {},
        strokeRect() {},
      })
      canvas.toDataURL = (type) => {
        renders.push({ pixels, width: canvas.width, height: canvas.height, offset: canvas.offset })
        assert.equal(type, 'image/png')
        return `data:image/png;base64,cutout${renders.length}`
      }
      return canvas
    },
  })
  return renders
}

test('opaque Shopify photo becomes a tightly cropped cut-out with transparent corners and an opaque subject', async (t) => {
  const renders = mockCanvas(t)
  const src = await prepareDecorationSyncImage('https://cdn.shopify.com/photo.jpg', { load: async () => photo() })
  assert.equal(src, 'data:image/png;base64,cutout1')
  const { pixels, width, height } = renders[0]
  assert.ok(width < 60 && height < 60)
  assert.equal(pixels.data[3], 0)
  assert.equal(pixels.data[((height >> 1) * width + (width >> 1)) * 4 + 3], 255)
})

test('transparent artwork preserves every pixel and does not run the colour extractor', async (t) => {
  const renders = mockCanvas(t)
  const original = photo({ transparent: true })
  await prepareDecorationSyncImage('/transparent.png', {
    load: async (_src, maxDim) => { assert.equal(maxDim, 1200); return original },
    extract: () => assert.fail('must preserve existing transparency'),
  })
  assert.deepEqual(renders[0].pixels, original)
})

test('size studio trims transparent padding so millimetres measure the visible decoration', async (t) => {
  const renders = mockCanvas(t)
  const original = photo({ transparent: true })
  await prepareDecorationSyncImage('/padded.png', {
    load: async () => original, trimTransparent: true,
    extract: () => assert.fail('must not re-key transparent artwork'),
  })
  assert.equal(renders[0].width, 51)
  assert.equal(renders[0].height, 51)
  assert.deepEqual(renders[0].offset, { x: -35, y: -35 })
})
test('empty, ambiguous and unreadable images fail explicitly instead of returning the original photo', async () => {
  await assert.rejects(() => prepareDecorationSyncImage('/empty.png', {
    load: async () => photo({ transparent: true, empty: true }),
  }), /fully transparent/)
  for (const pieces of [[], [{ dataUrl: 'one' }, { dataUrl: 'two' }]]) {
    await assert.rejects(() => prepareDecorationSyncImage('/photo.jpg', {
      load: async () => photo(), extract: () => ({ pieces }),
    }), /one isolated decoration/)
  }
  await assert.rejects(() => prepareDecorationSyncImage('/broken.jpg', {
    load: async () => { throw new Error('Image request failed') },
  }), /Image request failed/)
})

test('already-tight transparent cut-outs are preserved when their edges touch the canvas', async (t) => {
  mockCanvas(t)
  const width = 51, height = 51
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x - 25, y - 25) <= 25) data.set([180, 100, 20, 255], (y * width + x) * 4)
    }
  }
  await prepareDecorationSyncImage('/tight.png', {
    load: async () => ({ data, width, height }), trimTransparent: true,
    extract: () => assert.fail('tight transparent cut-outs must not be extracted a second time'),
  })
})
test('image loader rejects canvas access errors and image load failures without hanging', async (t) => {
  stubGlobal(t, 'window', { Image: class {
    set src(value) { queueMicrotask(() => value === 'broken' ? this.onerror() : this.onload()) }
    width = 120
    height = 120
  } })
  stubGlobal(t, 'document', {
    createElement: () => ({ getContext: () => ({ drawImage: () => { throw new Error('Tainted canvas') } }) }),
  })
  await assert.rejects(() => loadImageData('tainted'), /Could not read image pixels: Tainted canvas/)
  await assert.rejects(() => loadImageData('broken'), /Could not load image/)
})
