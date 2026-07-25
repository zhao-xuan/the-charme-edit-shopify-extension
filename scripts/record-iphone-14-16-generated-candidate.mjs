import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

const manifestPath = argument('manifest') || 'reference/case-history/iphone-14-16-user-corrections.json'
const outputPath = argument('output') || 'reference/case-history/generated/iphone-14-16-user-corrections/candidate-provenance.json'
const modelId = argument('model')
const finish = argument('finish')
const conversationUrl = argument('conversation-url')
const sourceUrl = argument('source-url')
const reviewStatus = argument('review-status') || 'pending-review'

const allowedReviewStatuses = new Set(['pending-review', 'failed-size-gate', 'failed-hardware-gate'])

if (!modelId || !finish || !conversationUrl || !sourceUrl) {
  throw new Error('Pass --model, --finish, --conversation-url and --source-url')
}
if (!allowedReviewStatuses.has(reviewStatus)) {
  throw new Error(`Unsupported review status: ${reviewStatus}`)
}
if (!conversationUrl.startsWith('https://chatgpt.com/c/')) {
  throw new Error('conversation-url must identify a ChatGPT conversation')
}
if (!sourceUrl.startsWith('https://chatgpt.com/backend-api/estuary/content?')) {
  throw new Error('source-url must identify authenticated Estuary content')
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const prompt = manifest.prompts.find((entry) => entry.modelId === modelId && entry.finish === finish)
if (!prompt) throw new Error(`${modelId}:${finish} is not in ${manifestPath}`)
if (prompt.publish || prompt.setCurrent) throw new Error(`${modelId}:${finish} is not candidate-only`)

const bytes = await readFile(prompt.candidatePath)
const metadata = await sharp(bytes).metadata()
if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
  throw new Error(`${prompt.candidatePath} is not a valid PNG`)
}
const candidate = {
  modelId,
  modelName: prompt.modelName,
  finish,
  correctionType: prompt.correctionType,
  candidateVersion: prompt.candidateVersion,
  publish: false,
  setCurrent: false,
  generator: prompt.generator,
  promptText: prompt.promptText,
  promptSha256: prompt.promptSha256,
  referenceImages: prompt.referenceImages,
  candidatePath: prompt.candidatePath,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  widthPx: metadata.width,
  heightPx: metadata.height,
  conversationUrl,
  sourceUrl,
  reviewStatus,
  recordedAt: new Date().toISOString(),
}

let provenance = {
  schemaVersion: 1,
  campaign: manifest.campaign,
  manifestPath,
  publish: false,
  candidates: [],
}
try {
  provenance = JSON.parse(await readFile(outputPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const existing = provenance.candidates.find((entry) => (
  entry.modelId === modelId
  && entry.finish === finish
  && entry.candidateVersion === candidate.candidateVersion
))
if (existing) {
  const stableFields = ['candidateVersion', 'promptSha256', 'candidatePath', 'sha256', 'conversationUrl', 'sourceUrl', 'reviewStatus']
  if (stableFields.some((field) => existing[field] !== candidate[field])) {
    throw new Error(`${modelId}:${finish} already has different provenance`)
  }
  console.log(JSON.stringify({ recorded: false, candidate: existing }, null, 2))
  process.exit(0)
}

await Promise.all(prompt.referenceImages.map((filePath) => access(filePath)))
provenance.candidates.push(candidate)
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(provenance, null, 2)}\n`)
console.log(JSON.stringify({ recorded: true, candidate }, null, 2))