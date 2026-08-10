export function measuredCameraKeepout(product, fractions) {
  if (!fractions) return null

  return {
    kind: product.camera.kind,
    xMm: +(product.widthMm * fractions.x).toFixed(1),
    yMm: +(product.heightMm * fractions.y).toFixed(1),
    wMm: +(product.widthMm * fractions.w).toFixed(1),
    hMm: +(product.heightMm * fractions.h).toFixed(1),
    rMm: 13,
  }
}