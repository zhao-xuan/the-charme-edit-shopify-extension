export function productPhotoCrop(bounds, sourceWidth = bounds.sourceWidth, sourceHeight = bounds.sourceHeight) {
  return {
    left: bounds.left / bounds.sourceWidth * sourceWidth,
    top: bounds.top / bounds.sourceHeight * sourceHeight,
    width: bounds.width / bounds.sourceWidth * sourceWidth,
    height: bounds.height / bounds.sourceHeight * sourceHeight,
  }
}

export function productPhotoStyle(bounds) {
  const crop = productPhotoCrop(bounds, 1, 1)
  return {
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${-100 * crop.left / crop.width}%`,
    top: `${-100 * crop.top / crop.height}%`,
    right: 'auto',
    bottom: 'auto',
  }
}
