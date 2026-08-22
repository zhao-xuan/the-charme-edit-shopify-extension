export const DELISTED_PHONE_MODEL_IDS = Object.freeze([
  'pixel-10-pro-xl',
  'pixel-9-pro-xl',
  'galaxy-z-fold-6',
])

export const ANDROID_LAUNCH_MODEL_IDS = Object.freeze([
  'pixel-10-pro',
  'pixel-9-pro',
  'pixel-8-pro',
  'pixel-7-pro',
  'pixel-6-pro',
  'pixel-10',
  'pixel-9a',
  'pixel-9',
  'pixel-8a',
  'pixel-8',
  'pixel-7a',
  'pixel-7',
  'pixel-6a',
  'pixel-5',
  'galaxy-z-flip-7',
  'galaxy-z-flip-6',
  'galaxy-z-flip-5',
  'galaxy-z-flip-4',
  'galaxy-z-flip-3',
  'galaxy-z-fold-7',
  'galaxy-z-fold-5',
  'galaxy-z-fold-4',
  'galaxy-z-fold-3',
  'galaxy-s25-edge',
  'galaxy-s26-ultra',
  'galaxy-s26-plus',
  'galaxy-s26',
  'galaxy-s25-ultra',
  'galaxy-s25-plus',
  'galaxy-s25',
  'galaxy-s24-ultra',
  'galaxy-s24-plus',
  'galaxy-s24',
  'galaxy-s24-fe',
  'galaxy-s23-ultra',
  'galaxy-s23-plus',
  'galaxy-s23-fe',
  'galaxy-s23',
  'galaxy-s22-ultra',
  'galaxy-s22-plus',
  'galaxy-s22',
  'galaxy-s21-ultra',
  'galaxy-s21-plus',
  'galaxy-s21-fe',
  'galaxy-s21',
  'galaxy-s20-plus-4g-5g',
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