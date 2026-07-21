import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const baseUrl = argument('url')
const manifestPath = argument('manifest', 'reference/case-history/v1-prompts.json')
const defaultImageVersion = argument('image-version', 'v1')

if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error('Pass --url with the Pages origin, for example --url http://localhost:8788')
}
if (!/^v[1-9][0-9]*$/.test(defaultImageVersion)) {
  throw new Error('--image-version must look like v1, v2, ...')
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.prompts) || !manifest.prompts.length) {
  throw new Error(`${manifestPath} has no prompts`)
}

function defaultReferences(modelId, finish) {
  const shellFinish = finish === 'black' ? 'black' : 'white'
  const material = finish === 'black'
    ? 'gpt-black-material.png'
    : finish === 'white'
      ? 'gpt-white-material.png'
      : 'gpt-glitter-pixel-10-pro.png'
  return [
    `${modelId}-${shellFinish}.png`,
    'gpt-approved-layout.png',
    material,
  ]
}

async function imageMetadata(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    widthPx: metadata.width,
    heightPx: metadata.height,
  }
}

for (const prompt of manifest.prompts) {
  if (prompt.publish === false) {
    console.log(`skip ${prompt.modelId}:${prompt.finish} ${prompt.imageVersion || defaultImageVersion} (publish=false)`)
    continue
  }
  const { modelId, finish, promptText } = prompt
  const imageVersion = prompt.imageVersion || defaultImageVersion
  if (!/^v[1-9][0-9]*$/.test(imageVersion)) {
    throw new Error(`${modelId}:${finish} imageVersion must look like v1, v2, ...`)
  }
  const imagePath = `/assets/cases/case-history/${modelId}/${finish}/${imageVersion}.png`
  const localImagePath = path.join('public', imagePath)
  const metadata = await imageMetadata(localImagePath)
  const historyUrl = new URL('/api/admin/case-history', baseUrl)
  historyUrl.searchParams.set('modelId', modelId)
  historyUrl.searchParams.set('finish', finish)
  const currentResponse = await fetch(historyUrl)
  if (!currentResponse.ok) throw new Error(`${modelId}:${finish} lookup failed (${currentResponse.status})`)
  const current = await currentResponse.json()
  const duplicate = (current.images || []).some((image) => {
    const linkedPrompt = (current.prompts || []).find((item) => item.key === image.promptVersionKey)
    return image.sha256 === metadata.sha256 && linkedPrompt?.promptText === promptText
  })
  if (duplicate) {
    console.log(`skip ${modelId}:${finish} ${imageVersion} (already stored)`)
    continue
  }

  const response = await fetch(new URL('/api/admin/case-history', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId,
      finish,
      promptText,
      imagePath,
      ...metadata,
      referenceImages: prompt.referenceImages || defaultReferences(modelId, finish),
      generator: prompt.generator || 'ChatGPT',
      conversationUrl: prompt.conversationUrl || manifest.conversationUrl || '',
      sourceUrl: prompt.sourceUrl || '',
      setCurrent: true,
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${modelId}:${finish} create failed: ${result.error || response.status}`)
  const image = result.images?.[0]
  const linkedPrompt = result.prompts?.find((item) => item.key === image?.promptVersionKey)
  if (!image || !linkedPrompt) throw new Error(`${modelId}:${finish} response is missing its prompt link`)
  console.log(`stored ${modelId}:${finish} image v${image.version} -> prompt v${linkedPrompt.version}`)
}