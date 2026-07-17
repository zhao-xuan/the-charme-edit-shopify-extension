import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const sourcePath = 'public/assets/cases/case-with-gel/integrated-iphone-11-pro-white.png'
const fileName = 'gpt-wide-camera-clearance-guide.png'
const referencePath = path.join('reference', 'case-history', 'references', fileName)
const publicPath = path.join('public', 'assets', 'cases', 'gpt-references', fileName)
const { width, height } = await sharp(sourcePath).metadata()

if (!width || !height) throw new Error(`Could not read dimensions from ${sourcePath}`)

const guide = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 798 1606" xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 718 38 C 652 18 560 18 486 27 C 439 33 420 61 417 112 L 408 322 C 406 368 395 397 369 417 C 340 439 304 444 250 444 L 150 444 C 105 444 77 471 63 514 C 50 557 49 632 50 748 L 55 1120"
    fill="none"
    stroke="#ff5058"
    stroke-width="8"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`)

const output = await sharp(sourcePath)
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