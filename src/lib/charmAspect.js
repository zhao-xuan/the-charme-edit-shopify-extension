/** Keep the merchant's longest edge while matching the artwork's pixel ratio. */
export function charmSizeFromArtwork(charm, pxW = charm.pxW, pxH = charm.pxH) {
  const width = Number(pxW)
  const height = Number(pxH)
  const longMm = Math.max(Number(charm.widthMm), Number(charm.heightMm))
  if (![width, height, longMm].every((value) => Number.isFinite(value) && value > 0)) return charm
  return {
    ...charm,
    widthMm: width >= height ? longMm : longMm * (width / height),
    heightMm: height >= width ? longMm : longMm * (height / width),
  }
}

export function pngPixelSize(src) {
  const prefix = 'data:image/png;base64,'
  if (typeof src !== 'string' || !src.startsWith(prefix)) throw new Error('A PNG image is required')
  const bytes = Uint8Array.from(atob(src.slice(prefix.length, prefix.length + 44)), (char) => char.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error('Invalid PNG image header')
  }
  const view = new DataView(bytes.buffer)
  const pxW = view.getUint32(16)
  const pxH = view.getUint32(20)
  if (!pxW || !pxH) throw new Error('PNG image dimensions must be positive')
  return { pxW, pxH }
}

export function charmWithPngArtwork(charm, src) {
  const pixels = pngPixelSize(src)
  return charmSizeFromArtwork({ ...charm, ...pixels })
}
