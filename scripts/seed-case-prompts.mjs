import { readFile } from 'node:fs/promises'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const baseUrl = argument('url')
const manifestPath = argument('manifest', 'reference/case-history/iphone-16-17-standard-prompts.json')

if (!/^https?:\/\//.test(baseUrl)) {
  throw new Error('Pass --url with the Pages origin, for example --url http://localhost:8788')
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.prompts) || !manifest.prompts.length) {
  throw new Error(`${manifestPath} has no prompts`)
}

for (const prompt of manifest.prompts) {
  const historyUrl = new URL('/api/admin/case-history', baseUrl)
  historyUrl.searchParams.set('modelId', prompt.modelId)
  historyUrl.searchParams.set('finish', prompt.finish)
  const currentResponse = await fetch(historyUrl)
  if (!currentResponse.ok) {
    throw new Error(`${prompt.modelId}:${prompt.finish} lookup failed (${currentResponse.status})`)
  }
  const current = await currentResponse.json()
  const duplicate = (current.prompts || []).some((item) => (
    item.promptText === prompt.promptText
    && JSON.stringify(item.referenceImages) === JSON.stringify(prompt.referenceImages || [])
  ))
  if (duplicate) {
    console.log(`skip ${prompt.modelId}:${prompt.finish} (already stored)`)
    continue
  }

  const response = await fetch(new URL('/api/admin/case-history', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: prompt.modelId,
      finish: prompt.finish,
      promptText: prompt.promptText,
      referenceImages: prompt.referenceImages || [],
      generator: prompt.generator || 'ChatGPT',
      conversationUrl: prompt.conversationUrl || manifest.conversationUrl || '',
    }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${prompt.modelId}:${prompt.finish} create failed: ${result.error || response.status}`)
  }
  const stored = (result.prompts || []).find((item) => (
    item.modelId === prompt.modelId
    && item.finish === prompt.finish
    && item.promptText === prompt.promptText
  ))
  if (!stored) throw new Error(`${prompt.modelId}:${prompt.finish} response is missing the stored prompt`)
  console.log(`stored ${prompt.modelId}:${prompt.finish} prompt v${stored.version}`)
}