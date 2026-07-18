import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MODELS = [
  {
    id: 'iphone-13',
    baseWidth: 920,
    baseHeight: 1835,
    cameraRight: 448,
    cameraBottom: 450,
    cameraOffset: 51,
    outer: { left: 57, top: 48, right: 863, bottom: 1771 },
  },
  {
    id: 'iphone-14',
    baseWidth: 920,
    baseHeight: 1831,
    cameraRight: 451,
    cameraBottom: 451,
    cameraOffset: 51,
    outer: { left: 57, top: 48, right: 863, bottom: 1768 },
  },
  {
    id: 'iphone-15',
    baseWidth: 916,
    baseHeight: 1827,
    cameraRight: 459,
    cameraBottom: 458,
    cameraOffset: 51,
    outer: { left: 57, top: 48, right: 859, bottom: 1764 },
  },
]

const referenceDir = path.join('reference', 'case-history', 'references')
const publicDir = path.join('public', 'assets', 'cases', 'gpt-references')

await Promise.all([
  mkdir(referenceDir, { recursive: true }),
  mkdir(publicDir, { recursive: true }),
])

for (const model of MODELS) {
  for (const shell of ['black', 'white']) {
    const sourcePath = `public/assets/cases/case-without-gel/${model.id}-${shell}.png`
    const { width, height } = await sharp(sourcePath).metadata()
    if (!width || !height) throw new Error(`Could not read dimensions from ${sourcePath}`)

    const scaleX = width / model.baseWidth
    const scaleY = height / model.baseHeight
    const x = (value) => Math.round(value * scaleX)
    const y = (value) => Math.round(value * scaleY)
    const radius = (value) => Math.round(value * scaleX)
    const cameraOffset = x(model.cameraOffset)
    const cameraX = x(model.cameraRight) + cameraOffset
    const cameraY = y(model.cameraBottom) + cameraOffset
    const left = x(model.outer.left)
    const top = y(model.outer.top)
    const right = x(model.outer.right)
    const bottom = y(model.outer.bottom)
    const pathData = [
      `M ${left + radius(104)} ${cameraY}`,
      `L ${cameraX - radius(120)} ${cameraY}`,
      `C ${cameraX - radius(42)} ${cameraY} ${cameraX + radius(18)} ${cameraY - radius(50)} ${cameraX + radius(20)} ${cameraY - radius(145)}`,
      `C ${cameraX + radius(23)} ${cameraY - radius(300)} ${cameraX + radius(85)} ${top + radius(18)} ${cameraX + radius(185)} ${top + radius(18)}`,
      `C ${cameraX + radius(280)} ${top + radius(18)} ${right - radius(8)} ${top + radius(68)} ${right} ${top + radius(148)}`,
      `L ${right} ${bottom - radius(84)}`,
      `C ${right} ${bottom - radius(28)} ${right - radius(28)} ${bottom} ${right - radius(84)} ${bottom}`,
      `L ${left + radius(84)} ${bottom}`,
      `C ${left + radius(28)} ${bottom} ${left} ${bottom - radius(28)} ${left} ${bottom - radius(84)}`,
      `L ${left} ${cameraY + radius(104)}`,
      `C ${left} ${cameraY + radius(36)} ${left + radius(36)} ${cameraY} ${left + radius(104)} ${cameraY}`,
      'Z',
    ].join(' ')
    const overlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path
      d="${pathData}"
      fill="#ff5058"
      fill-opacity="0.08"
      stroke="#ff3f4a"
      stroke-width="9"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`)
    const output = await sharp(sourcePath)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png()
      .toBuffer()
    const fileName = `gpt-${model.id}-${shell}-standard-exact-gel-path.png`

    await Promise.all([
      writeFile(path.join(referenceDir, fileName), output),
      writeFile(path.join(publicDir, fileName), output),
    ])
    console.log(`${model.id}/${shell}: camera gap ${cameraOffset}px (${(cameraOffset / width * 100).toFixed(2)}%)`)
  }
}