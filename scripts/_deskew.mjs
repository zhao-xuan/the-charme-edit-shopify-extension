/**
 * _deskew.mjs — shared helper to straighten (deskew) a reference photo whose
 * case is slightly tilted, so the extracted pieces + the comparison crop match
 * the perfectly-straight app case.
 *
 * makeWork(realPath, tiltDeg) returns { buf, W, H, map } where:
 *   - buf  : a PNG buffer of the EXIF-corrected source, rotated by -tiltDeg so
 *            the case is axis-aligned (or just EXIF-corrected when tiltDeg≈0).
 *   - W,H  : dimensions of buf (the rotation expands the canvas).
 *   - map  : (x,y) in EXIF-corrected full-res coords → [x',y'] in buf coords.
 * Rotation preserves scale, so existing px↔mm scaling is unchanged.
 */
import sharp from 'sharp'

export async function makeWork(realPath, tiltDeg = 0) {
  const base = sharp(realPath).rotate() // apply EXIF orientation
  const meta = await base.metadata()
  const FW = meta.width, FH = meta.height
  const baseBuf = await base.toBuffer()
  if (!tiltDeg || Math.abs(tiltDeg) < 0.3) {
    return { buf: baseBuf, W: FW, H: FH, map: (x, y) => [x, y] }
  }
  // The case edge has slope tan(tilt); applying the sharp rotation a=deg to the
  // coordinates reduces the edge angle by deg, so deg = tiltDeg zeroes it.
  const deg = tiltDeg
  const rbuf = await sharp(baseBuf)
    .rotate(deg, { background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer()
  const rmeta = await sharp(rbuf).metadata()
  const RW = rmeta.width, RH = rmeta.height
  const a = (deg * Math.PI) / 180
  const ca = Math.cos(a), sa = Math.sin(a)
  const cx = FW / 2, cy = FH / 2
  const map = (x, y) => {
    const dx = x - cx, dy = y - cy
    return [dx * ca - dy * sa + RW / 2, dx * sa + dy * ca + RH / 2]
  }
  return { buf: rbuf, W: RW, H: RH, map }
}
