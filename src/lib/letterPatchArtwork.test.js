import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { letterPatchArtwork } from './letterPatchArtwork.js'

const existingA = {
  id: 'patch-57e6e',
  name: 'A',
  src: 'https://cdn.shopify.com/s/files/1/0922/3857/8042/files/patch-57e6e.png?v=1789744139',
  price: 2,
  widthMm: 20,
  heightMm: 20,
  shopifyVariantId: '57288451916154',
}

test('repaired artwork preserves the patch identity, price, physical size and variant', () => {
  const repaired = letterPatchArtwork(existingA)
  assert.equal(repaired.src, '/assets/patches/letters/A.png')
  assert.equal(repaired.pxW, 242)
  assert.equal(repaired.pxH, 274)
  for (const key of ['id', 'name', 'price', 'widthMm', 'heightMm', 'shopifyVariantId']) {
    assert.equal(repaired[key], existingA[key])
  }
})

test('a later merchant image replacement takes precedence over the repair', () => {
  const changed = { ...existingA, src: 'https://cdn.shopify.com/files/replacement.png' }
  assert.equal(letterPatchArtwork(changed), changed)
  const revised = { ...existingA, src: existingA.src.replace('1789744139', '9999999999') }
  assert.equal(letterPatchArtwork(revised), revised)
  const other = { ...existingA, id: 'different-patch' }
  assert.equal(letterPatchArtwork(other), other)
})

test('all repaired letters retain transparent edges and solid dark stitching', async () => {
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const { data, info } = await sharp(new URL(`../../public/assets/patches/letters/${letter}.png`, import.meta.url).pathname)
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert(info.width >= 150 && info.height >= 200, `${letter}: expected a high-resolution cut-out`)
    assert.equal(data[3], 0, `${letter}: top-left background must remain transparent`)
    let dark = 0, translucentDark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) < 70) {
        dark++
        if (data[i + 3] < 200) translucentDark++
      }
    }
    assert(dark > 1000, `${letter}: missing black stitching`)
    assert(translucentDark / dark < 0.03, `${letter}: black stitching has unexpected transparency`)
  }
})
