#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const sourceDirectory = process.argv[2] || path.join(os.homedir(), 'Downloads')
const outputDirectory = 'public/assets/cases/case-without-gel'
const manifestPath = 'src/data/official-phone-case-images.json'
const visionScript = 'scripts/_segment-tote.swift'

const modelIds = {
  'Galaxy S20+': 'galaxy-s20-plus-4g-5g',
  'Galaxy S21': 'galaxy-s21',
  'Galaxy S21 FE': 'galaxy-s21-fe',
  'Galaxy S21 Ultra': 'galaxy-s21-ultra',
  'Galaxy S21+': 'galaxy-s21-plus',
  'Galaxy S22': 'galaxy-s22',
  'Galaxy S22 Ultra': 'galaxy-s22-ultra',
  'Galaxy S22+': 'galaxy-s22-plus',
  'Galaxy S23': 'galaxy-s23',
  'Galaxy S23 FE': 'galaxy-s23-fe',
  'Galaxy S23 Ultra': 'galaxy-s23-ultra',
  'Galaxy S23+': 'galaxy-s23-plus',
  'Galaxy S24 FE': 'galaxy-s24-fe',
  'Galaxy S25 Edge': 'galaxy-s25-edge',
  'Galaxy Z Flip 3': 'galaxy-z-flip-3',
  'Galaxy Z Flip 4': 'galaxy-z-flip-4',
  'Galaxy Z Flip 5': 'galaxy-z-flip-5',
  'Galaxy Z Flip 6': 'galaxy-z-flip-6',
  'Galaxy Z Flip 7': 'galaxy-z-flip-7',
  'Galaxy Z Fold 3': 'galaxy-z-fold-3',
  'Galaxy Z Fold 4': 'galaxy-z-fold-4',
  'Galaxy Z Fold 5': 'galaxy-z-fold-5',
  'Galaxy Z Fold 7': 'galaxy-z-fold-7',
  'Pixel 5': 'pixel-5',
  'Pixel 6A': 'pixel-6a',
  'Pixel 7': 'pixel-7',
  'Pixel 7A': 'pixel-7a',
  'Pixel 8': 'pixel-8',
  'Pixel 8A': 'pixel-8a',
  'Pixel 9': 'pixel-9',
  'Pixel 9A': 'pixel-9a',
  'Pixel 10': 'pixel-10',
  'Pixel Pro 8': 'pixel-8-pro',
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
  })
}

await mkdir(outputDirectory, { recursive: true })
const files = (await readdir(sourceDirectory)).sort()
const results = []
for (const filename of files) {
  const match = filename.match(/^(.*?) - (black|white)\.png$/i)
  if (!match) continue
  const id = modelIds[match[1]]
  if (!id) continue
  const finish = match[2].toLowerCase()
  const source = path.join(sourceDirectory, filename)
  const output = path.join(outputDirectory, `${id}-${finish}.png`)
  const metadata = await sharp(source).metadata()
  let input = source
  let segmented = false
  if (!metadata.hasAlpha) {
    input = path.join(os.tmpdir(), `charme-${id}-${finish}-segmented.png`)
    await run('swift', [visionScript, source, input])
    segmented = true
  }
  await sharp(input)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(output)
  const out = await sharp(output).metadata()
  results.push({ id, finish, source: filename, output, segmented, width: out.width, height: out.height })
}

if (results.length !== 66) throw new Error(`Expected 66 mapped case images, wrote ${results.length}`)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const result of results) {
  manifest[result.id] = {
    ...(manifest[result.id] || {}),
    [result.finish]: `/${result.output.replace(/^public\//, '')}`,
  }
}
const orderedManifest = Object.fromEntries(Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right)))
await writeFile(manifestPath, `${JSON.stringify(orderedManifest, null, 2)}\n`)
console.log(JSON.stringify({ sourceDirectory, count: results.length, results }, null, 2))
