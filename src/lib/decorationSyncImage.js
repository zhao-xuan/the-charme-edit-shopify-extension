import { extractPieces, loadImageData } from './segment.js'

export async function prepareDecorationSyncImage(src, { load = loadImageData, extract = extractPieces, trimTransparent = false } = {}) {
  const image = await load(src, 1200)
  const { data, width, height } = image
  let visible = 0
  let border = 0
  let transparentBorder = 0
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 8) {
        visible++
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        border++
        if (alpha <= 8) transparentBorder++
      }
    }
  }
  if (!visible) throw new Error('The image is empty or fully transparent')
  if (transparentBorder / border >= 0.5) {
    const canvas = document.createElement('canvas')
    canvas.width = trimTransparent ? maxX - minX + 1 : width
    canvas.height = trimTransparent ? maxY - minY + 1 : height
    canvas.getContext('2d').putImageData(image, trimTransparent ? -minX : 0, trimTransparent ? -minY : 0)
    return canvas.toDataURL('image/png')
  }
  const result = extract(image, { mode: 'standalone', standaloneLongMm: 16 })
  if (result.pieces.length !== 1 || !result.pieces[0].dataUrl) {
    throw new Error('Background removal needs one isolated decoration on a plain background. Upload a transparent PNG or use the manual auto-extract tool, then retry.')
  }
  return result.pieces[0].dataUrl
}
