export const ANDROID_LAUNCH_MODEL_IDS = Object.freeze([
  'pixel-10-pro',
  'pixel-9-pro',
  'pixel-8-pro',
  'pixel-7-pro',
  'pixel-6-pro',
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
])

const ANDROID_LAUNCH_MODELS = new Set(ANDROID_LAUNCH_MODEL_IDS)

export function trustedCaseImages(product, {
  remoteProduct,
  generatedImages = {},
  officialImages = {},
} = {}) {
  const images = product.brand === 'apple' ? { ...(product.blankImage || {}) } : {}
  if (product.brand === 'apple') {
    if (remoteProduct?.src) images.white = remoteProduct.src
    if (remoteProduct?.srcBlack) images.black = remoteProduct.srcBlack
    Object.assign(images, generatedImages)
  }
  if (ANDROID_LAUNCH_MODELS.has(product.id)) Object.assign(images, officialImages)
  return images
}