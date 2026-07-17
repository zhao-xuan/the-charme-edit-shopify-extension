import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const sourcePath = 'public/assets/cases/case-with-gel/integrated-iphone-14-pro-black.png'
const fileName = 'gpt-iphone-14-ultra-close-outer-fit.png'
const referencePath = path.join('reference', 'case-history', 'references', fileName)
const publicPath = path.join('public', 'assets', 'cases', 'gpt-references', fileName)

await Promise.all([
  mkdir(path.dirname(referencePath), { recursive: true }),
  mkdir(path.dirname(publicPath), { recursive: true }),
])
await Promise.all([
  copyFile(sourcePath, referencePath),
  copyFile(sourcePath, publicPath),
])
console.log(`Wrote ${referencePath}`)
console.log(`Wrote ${publicPath}`)