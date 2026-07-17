import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const sourcePath = 'public/assets/cases/case-with-gel/integrated-iphone-16-black.png'
const fileName = 'gpt-iphone-16-17-standard-gel-path.png'
const referencePath = path.join('reference', 'case-history', 'references', fileName)
const publicPath = path.join('public', 'assets', 'cases', 'gpt-references', fileName)
const width = 768
const height = 1600

const guide = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 736 239 C 736 151 715 91 674 59 C 643 35 604 35 574 42 C 527 53 486 78 470 118 C 453 162 456 216 444 282 C 432 354 414 406 378 432 C 350 451 315 454 267 454 L 177 454 C 112 455 77 482 61 535 C 43 596 44 704 47 844 L 59 1278 C 62 1344 61 1391 50 1438 C 40 1483 58 1523 98 1548 C 146 1577 236 1568 356 1566 L 612 1563 C 675 1562 711 1542 726 1502"
    fill="none"
    stroke="#ff5058"
    stroke-width="9"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`)

const output = await sharp(sourcePath)
  .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .composite([{ input: guide, left: 0, top: 0 }])
  .png()
  .toBuffer()

await Promise.all([
  mkdir(path.dirname(referencePath), { recursive: true }),
  mkdir(path.dirname(publicPath), { recursive: true }),
])
await Promise.all([
  writeFile(referencePath, output),
  writeFile(publicPath, output),
])
console.log(`Wrote ${referencePath}`)
console.log(`Wrote ${publicPath}`)