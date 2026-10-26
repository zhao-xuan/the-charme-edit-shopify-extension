import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

test('Duo cutouts have transparent padding, solid bodies, and the official folded aspect ratio', async () => {
  const provenance = JSON.parse(await readFile(new URL('../../reference/case-history/generated/iphone-duo/source-provenance.json', import.meta.url), 'utf8'))
  assert.equal(provenance.dimensionsSource, 'https://www.apple.com/iphone-duo/specs/')
  assert.equal(provenance.widthMm, 84.1)
  assert.equal(provenance.heightMm, 117.8)
  const bounds = JSON.parse(await readFile(new URL('../data/official-phone-case-image-bounds.json', import.meta.url), 'utf8'))['iphone-duo']
  for (const finish of ['white', 'black']) {
    const { data, info } = await sharp(new URL(`../../public/assets/cases/case-without-gel/iphone-duo-${finish}.png`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const crop = bounds[finish]
    assert.equal(info.width, crop.sourceWidth)
    assert.equal(info.height, crop.sourceHeight)
    assert.ok(Math.abs((crop.width / crop.height) / (84.1 / 117.8) - 1) < 0.01)
    for (let x = 0; x < info.width; x++) {
      assert.equal(data[x * 4 + 3], 0)
      assert.equal(data[((info.height - 1) * info.width + x) * 4 + 3], 0)
    }
    for (let y = 0; y < info.height; y++) {
      assert.equal(data[y * info.width * 4 + 3], 0)
      assert.equal(data[(y * info.width + info.width - 1) * 4 + 3], 0)
    }
    for (const [x, y] of [[190, 270], [70, 65], [150, 65], [190, 400]]) {
      assert.equal(data[(y * info.width + x) * 4 + 3], 255, `${finish}: phone body and camera must stay opaque`)
    }
  }
})
