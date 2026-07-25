import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const transcriptPath = argument('transcript')
const outputPath = argument(
  'output',
  'reference/case-history/gpt-conversation-attempts-publication.json',
)
const shouldWrite = process.argv.includes('--write')
const promoteAccepted = process.argv.includes('--promote-accepted')
const campaignRoot = 'reference/case-history/generated/black-white-glitter-shape-trials'
const provenancePath = path.join(campaignRoot, 'candidate-provenance.json')
const publicDirectory = 'public/assets/cases/case-history/gpt-conversation-attempts'
const publicUrlRoot = '/assets/cases/case-history/gpt-conversation-attempts'

if (!transcriptPath) {
  throw new Error('Pass --transcript with the VS Code Copilot JSONL transcript path')
}

const promptSources = [
  ['iphone-14-black-v2-gpt.png', 'call_IcvziEvlEnftW2eynaDpqu8u'],
  ['iphone-14-black-v3-gpt.png', 'call_0A2s5D4uMAO3egOGZLjODT9f'],
  ['iphone-14-black-v4-gpt.png', 'call_0onCU3KeS7V7K9ipJ0DTcjfg'],
  ['iphone-14-black-v5-gpt.png', 'call_EJOg74uOfc2fV2L22hhEtw5f', true],
  ['iphone-14-black-v6-gpt.png', 'call_TuelLgedmos7FkrTTGqB11tb'],
  ['iphone-11-pro-black-v1-gpt.png', 'call_bo31TY8QQTUtSpCAT1M7LtLj'],
  ['iphone-11-pro-white-v1-gpt.png', 'call_BZpPiwbcNSYqtXa3uovorRoL'],
  ['iphone-11-pro-white-v2-gpt.png', 'call_uJ7A2HwWzSrwPixHb9g4sGm1', true],
  ['iphone-11-pro-white-v3-gpt.png', 'call_Ni2eJ7VeeK73u79KNCWb5StE'],
  ['iphone-11-pro-max-black-v1-gpt.png', 'call_qD98E83aZisXN7cNsWH41FEV'],
  ['iphone-11-pro-max-white-v1-gpt.png', 'call_4zy8NtGTFxxEBHKkvUl1qg2s'],
  ['iphone-11-black-v1-gpt.png', 'call_JMvHZ8PR6Hq1XXhCSpmTXFTG'],
  ['iphone-11-white-v1-gpt.png', 'call_7wAg9Dhgz4S5hvtdC914nv9u'],
  ['iphone-12-mini-black-v1-gpt.png', 'call_FwjgOEHHkVDAKKr2dypmlSBG'],
  ['iphone-12-mini-white-v1-gpt.png', 'call_9jWp6yTdv9RPGwkqPlfZCpfc'],
  ['iphone-12-black-v1-gpt.png', 'call_mKDpitxcBGlp9CtNkf1OiqbB'],
  ['iphone-12-white-v1-gpt.png', 'call_jhSQqF5nXdF3bqdESvtdfTug'],
  ['iphone-12-pro-black-v1-gpt.png', 'call_hDHZdxMgtOEoOchvxKu8gHXS'],
  ['iphone-12-pro-white-v1-gpt.png', 'call_LNxzWFJUmITJhczMquho1a78'],
  ['iphone-12-pro-white-v2-gpt.png', 'call_tZD6qXcStMAE81q6TmHdh98I'],
  ['iphone-12-pro-max-black-v1-gpt.png', 'call_mr7ClUgA8xwr4FTRSRL8HRmE'],
  ['iphone-12-pro-max-white-v1-gpt.png', 'call_dlfok5FquJWEhWV4TdPXtfDl'],
  ['iphone-13-mini-black-v1-gpt.png', 'call_ONYi4f1i8DlSjROeUeznORWU'],
  ['iphone-13-mini-white-v1-gpt.png', 'call_1WdzitF6GJ4OvC8KOthw0yu6'],
  ['iphone-13-black-v1-gpt.png', 'call_g2ZAg1tuvSLMKlUYo04a5rjy'],
  ['iphone-13-white-v1-gpt.png', 'call_dI1xBZGVK0t1XPxiKOkyTl3J'],
  ['iphone-13-pro-black-v1-gpt.png', 'call_uggvX5U3B7LY9aoEAjwfaRa6'],
  ['iphone-13-pro-white-v1-gpt.png', 'call_cyOwfApaQHPVreaGCN2qn94e'],
  ['iphone-13-pro-max-black-v1-gpt.png', 'call_2jqvTP4piARn1CYVpSwW5C04'],
  ['iphone-13-pro-max-white-v1-gpt.png', 'call_zhDt4DdCTg8aMeOtu9upiSbM'],
  ['iphone-14-white-v1-gpt.png', 'call_kC2HNPf2en8sHEx7MUE7CluD'],
  ['iphone-14-white-v2-gpt.png', 'call_62JioZIE46c0nREXhb5pSIdu'],
  ['iphone-14-white-v3-gpt.png', 'call_14FfnOd9QjCKEkDnOP9FJjxJ'],
  ['iphone-14-white-v4-gpt.png', 'call_hzDZsEwEBArvkpTDAvzfzoUf'],
  ['iphone-14-white-v5-gpt.png', 'call_44nJ67G4xHb1c1d2Xo6a3Kzr'],
  ['iphone-14-white-v6-gpt.png', 'call_bJHqUfIw39bgmd8oDIFyqw0t', true],
  ['iphone-14-white-v7-gpt.png', 'call_NxehSib6W0sqio1ZdHGMPUq0', true],
  ['iphone-14-white-v8-gpt.png', 'call_JYTR0CGmRwfT9woajnhJP1PU'],
  ['iphone-14-white-v9-gpt.png', 'call_nEAKVG8mVoqIs44Y5Dy8lItC'],
  ['iphone-14-white-v10-gpt.png', 'call_oCytUDpJZ5yY30p0CiBG3vjx'],
  ['iphone-14-white-v11-gpt.png', 'call_M7YhOyOG9l3qUj9Gdh2Jp6KW'],
].map(([fileName, toolCallId, allowImplicitModel = false]) => ({
  fileName,
  toolCallId,
  allowImplicitModel,
}))

function extractTemplatePrompt(code, toolCallId) {
  const marker = /\bconst\s+prompt\s*=\s*`/g
  const match = marker.exec(code)
  if (!match) throw new Error(`${toolCallId} does not define a prompt template`)
  const start = match.index + match[0].length
  let escaped = false
  for (let index = start; index < code.length; index += 1) {
    const character = code[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character !== '`') continue
    const rawPromptText = code.slice(start, index)
    if (rawPromptText.includes('${')) {
      throw new Error(`${toolCallId} uses an interpolated prompt template`)
    }
    let promptText = ''
    for (let promptIndex = 0; promptIndex < rawPromptText.length; promptIndex += 1) {
      const promptCharacter = rawPromptText[promptIndex]
      if (promptCharacter !== '\\') {
        promptText += promptCharacter
        continue
      }
      const escape = rawPromptText[promptIndex + 1]
      const decoded = { n: '\n', r: '\r', t: '\t', '\\': '\\', '`': '`' }[escape]
      if (decoded == null) throw new Error(`${toolCallId} uses unsupported prompt escape \\${escape}`)
      promptText += decoded
      promptIndex += 1
    }
    return promptText
  }
  throw new Error(`${toolCallId} has an unterminated prompt template`)
}

function extractPrompt(event) {
  const { toolName, arguments: args = {}, toolCallId } = event.data
  if (toolName === 'type_in_page') return String(args.text || '')
  if (toolName === 'run_playwright_code') {
    const promptText = extractTemplatePrompt(String(args.code || ''), toolCallId)
    if (!String(args.code || '').includes('.fill(prompt)')) {
      throw new Error(`${toolCallId} defines prompt but does not fill it into the composer`)
    }
    return promptText
  }
  throw new Error(`${toolCallId} uses unsupported prompt tool ${toolName}`)
}

function mentionedModels(promptText) {
  const models = new Set()
  const pattern = /\biPhone\s+(11|12|13|14)(?:\s+(Pro Max|Pro|mini))?\b/gi
  for (const match of promptText.matchAll(pattern)) {
    const suffix = match[2] ? `-${match[2].toLowerCase().replaceAll(' ', '-')}` : ''
    models.add(`iphone-${match[1]}${suffix}`)
  }
  return models
}

async function imageIdentity(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    widthPx: metadata.width,
    heightPx: metadata.height,
  }
}

async function ensurePublicCopy(sourcePath, destinationPath, expectedSha) {
  await mkdir(path.dirname(destinationPath), { recursive: true })
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const copied = await imageIdentity(destinationPath)
  if (copied.sha256 !== expectedSha) {
    throw new Error(`${destinationPath} exists with an unexpected SHA-256`)
  }
}

const transcriptEvents = (await readFile(transcriptPath, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const promptEvents = new Map(
  transcriptEvents
    .filter((event) => event.type === 'tool.execution_start' && event.data?.toolCallId)
    .map((event) => [event.data.toolCallId, event]),
)
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
const candidatesByFile = new Map(
  provenance.candidates
    .filter((candidate) => /-gpt\.png$/.test(candidate.imagePath || ''))
    .map((candidate) => [path.basename(candidate.imagePath), candidate]),
)

if (promptSources.length !== 41 || candidatesByFile.size !== 41) {
  throw new Error(`Expected 41 prompt mappings and GPT candidates; found ${promptSources.length} and ${candidatesByFile.size}`)
}
const mappedFiles = new Set(promptSources.map((source) => source.fileName))
if (mappedFiles.size !== promptSources.length) throw new Error('Prompt mapping contains duplicate files')
for (const fileName of candidatesByFile.keys()) {
  if (!mappedFiles.has(fileName)) throw new Error(`${fileName} has no transcript prompt mapping`)
}

const prompts = []
for (const source of promptSources) {
  const candidate = candidatesByFile.get(source.fileName)
  if (!candidate) throw new Error(`${source.fileName} is missing from provenance`)
  const event = promptEvents.get(source.toolCallId)
  if (!event) throw new Error(`${source.fileName} is missing transcript event ${source.toolCallId}`)
  const promptText = extractPrompt(event)
  if (!promptText || promptText !== promptText.trim()) {
    throw new Error(`${source.toolCallId} has empty or padded prompt text`)
  }
  const models = mentionedModels(promptText)
  if (models.size && !models.has(candidate.modelId)) {
    throw new Error(`${source.fileName} prompt mentions ${[...models].join(', ')}, not ${candidate.modelId}`)
  }
  if (!models.size && !source.allowImplicitModel) {
    throw new Error(`${source.fileName} prompt does not identify ${candidate.modelId}`)
  }

  const expectedFileName = `${candidate.modelId}-${candidate.finish}-${candidate.candidateVersion}.png`
  if (source.fileName !== expectedFileName) {
    throw new Error(`${source.fileName} conflicts with provenance identity ${expectedFileName}`)
  }
  const sourcePath = path.join(campaignRoot, candidate.imagePath)
  const identity = await imageIdentity(sourcePath)
  if (
    identity.sha256 !== candidate.sha256
    || identity.widthPx !== candidate.widthPx
    || identity.heightPx !== candidate.heightPx
  ) {
    throw new Error(`${source.fileName} does not match its provenance identity`)
  }
  const publicImagePath = `${publicUrlRoot}/${source.fileName}`
  const localImagePath = path.join(publicDirectory, source.fileName)
  if (shouldWrite) await ensurePublicCopy(sourcePath, localImagePath, candidate.sha256)

  prompts.push({
    modelId: candidate.modelId,
    finish: candidate.finish,
    candidateVersion: candidate.candidateVersion,
    imageVersion: candidate.candidateVersion.replace(/-gpt$/, ''),
    publish: true,
    setCurrent: promoteAccepted && candidate.reviewStatus === 'accepted-candidate',
    generator: candidate.generator || 'ChatGPT image generation',
    promptText,
    referenceImages: candidate.referenceImages || [],
    imagePath: publicImagePath,
    localImagePath,
    sha256: candidate.sha256,
    widthPx: candidate.widthPx,
    heightPx: candidate.heightPx,
    conversationUrl: candidate.conversationUrl || '',
    sourceUrl: candidate.sourceUrl || '',
    reviewStatus: candidate.reviewStatus,
    reviewNotes: candidate.reviewNotes || '',
    transcriptToolCallId: source.toolCallId,
    submittedAt: event.timestamp,
  })
}

const manifest = {
  schemaVersion: 1,
  campaign: 'gpt-conversation-attempts-publication',
  generatedBy: 'scripts/build-gpt-conversation-history.mjs',
  transcriptSession: path.basename(transcriptPath, '.jsonl'),
  promotionPolicy: promoteAccepted
    ? 'Only provenance records marked accepted-candidate are made current.'
    : 'All attempts are appended as non-current history.',
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(JSON.stringify({
  prompts: prompts.length,
  accepted: prompts.filter((prompt) => prompt.reviewStatus === 'accepted-candidate').length,
  rejected: prompts.filter((prompt) => prompt.reviewStatus === 'rejected').length,
  current: prompts.filter((prompt) => prompt.setCurrent).length,
  uniquePromptEvents: new Set(prompts.map((prompt) => prompt.transcriptToolCallId)).size,
  wrote: shouldWrite ? outputPath : false,
}, null, 2))