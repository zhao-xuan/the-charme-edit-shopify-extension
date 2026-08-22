import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ANDROID_LAUNCH_MODEL_IDS, trustedCaseImages } from './caseImagePolicy.js'

const officialImages = JSON.parse(
  readFileSync(new URL('../data/official-phone-case-images.json', import.meta.url), 'utf8'),
)
const generatedImages = JSON.parse(
  readFileSync(new URL('../data/generated-phone-body-images.json', import.meta.url), 'utf8'),
)
const officialImageBounds = JSON.parse(
  readFileSync(new URL('../data/official-phone-case-image-bounds.json', import.meta.url), 'utf8'),
)

const unreviewedInputs = {
  remoteProduct: { src: 'remote-white.png', srcBlack: 'remote-black.png' },
  generatedImages: { white: 'generated-white.png', black: 'generated-black.png' },
}

test('Pixel models cannot inherit unreviewed local, remote, or generated images', () => {
  const images = trustedCaseImages(
    { brand: 'google', blankImage: { white: 'legacy-white.png', black: 'legacy-black.png' } },
    unreviewedInputs,
  )
  assert.deepEqual(images, {})
})

test('Pixel models expose only Case Review images in the official manifest', () => {
  const images = trustedCaseImages(
    { id: 'pixel-10-pro', brand: 'google', blankImage: { black: 'legacy-black.png' } },
    { ...unreviewedInputs, officialImages: { white: 'official-white.png' } },
  )
  assert.deepEqual(images, { white: 'official-white.png' })
})

test('Pixel 8 Pro exposes reviewed Black and White case images', () => {
  assert.deepEqual(officialImages['pixel-8-pro'], {
    black: '/assets/cases/case-without-gel/pixel-8-pro-black.png',
    white: '/assets/cases/case-without-gel/pixel-8-pro-white.png',
  })
})

test('iPhone XR cannot be overridden by rejected generated phone bodies', () => {
  assert.equal(generatedImages['iphone-xr'], undefined)
})

test('Samsung S24-S26 official finishes replace every unreviewed source', () => {
  const images = trustedCaseImages(
    { id: 'galaxy-s24', brand: 'samsung', blankImage: { white: 'legacy-white.png' } },
    { ...unreviewedInputs, officialImages: { black: 'official-black.png' } },
  )
  assert.deepEqual(images, { black: 'official-black.png' })
})

test('other Android models remain unavailable even when old official overrides exist', () => {
  for (const product of [
    { id: 'pixel-10', brand: 'google' },
    { id: 'pixel-10-pro-xl', brand: 'google' },
    { id: 'galaxy-s24-fe', brand: 'samsung' },
    { id: 'galaxy-s25-edge', brand: 'samsung' },
    { id: 'galaxy-s26-edge', brand: 'samsung' },
    { id: 'galaxy-s23', brand: 'samsung' },
    { id: 'galaxy-z-fold-5', brand: 'samsung' },
    { id: 'xiaomi-14', brand: 'xiaomi' },
    { id: 'huawei-p60-pro', brand: 'huawei' },
  ]) {
    assert.deepEqual(trustedCaseImages(product, {
      ...unreviewedInputs,
      officialImages: { black: 'old-official-black.png' },
    }), {})
  }
})

test('Samsung availability is limited to the S24, S25 and S26 families', () => {
  assert.deepEqual(
    ANDROID_LAUNCH_MODEL_IDS.filter((modelId) => modelId.startsWith('galaxy-')),
    [
      'galaxy-z-fold-7',
      'galaxy-z-fold-6',
      'galaxy-s26-ultra',
      'galaxy-s26-plus',
      'galaxy-s26',
      'galaxy-s25-ultra',
      'galaxy-s25-plus',
      'galaxy-s25',
      'galaxy-s24-ultra',
      'galaxy-s24-plus',
      'galaxy-s24',
    ],
  )
})

test('Samsung S24 White, S24+ White and S26 Ultra Black retain their assets and display crops', () => {
  assert.equal(
    officialImages['galaxy-s24'].white,
    '/assets/cases/case-without-gel/galaxy-s24-white.png',
  )
  assert.deepEqual(officialImageBounds['galaxy-s24'].white, {
    sourceWidth: 1920,
    sourceHeight: 1280,
    left: 664,
    top: 42,
    width: 592,
    height: 1196,
  })
  assert.equal(
    officialImages['galaxy-s24-plus'].white,
    '/assets/cases/case-without-gel/galaxy-s24-plus-white.png',
  )
  assert.deepEqual(officialImageBounds['galaxy-s24-plus'].white, {
    sourceWidth: 1920,
    sourceHeight: 1280,
    left: 665,
    top: 42,
    width: 590,
    height: 1196,
  })
  assert.equal(
    officialImages['galaxy-s26-ultra'].black,
    '/assets/cases/case-without-gel/galaxy-s26-ultra-black.png',
  )
  assert.deepEqual(officialImageBounds['galaxy-s26-ultra'].black, {
    sourceWidth: 622,
    sourceHeight: 1370,
    left: 2,
    top: 2,
    width: 618,
    height: 1366,
  })
})

test('Apple retains its existing remote and generated image precedence', () => {
  const images = trustedCaseImages(
    { brand: 'apple', blankImage: { white: 'legacy-white.png' } },
    unreviewedInputs,
  )
  assert.deepEqual(images, { white: 'generated-white.png', black: 'generated-black.png' })
})

test('Apple keeps a remote finish when only the other finish has a generated override', () => {
  const images = trustedCaseImages(
    { brand: 'apple', blankImage: { white: 'legacy-white.png' } },
    {
      remoteProduct: { src: 'remote-white.png', srcBlack: 'remote-black.png' },
      generatedImages: { black: 'generated-black.png' },
    },
  )
  assert.deepEqual(images, { white: 'remote-white.png', black: 'generated-black.png' })
})