import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const transcriptDirectory = argument('transcript-dir')
const outputPath = argument(
  'output',
  'reference/case-history/iphone-14-15-black-white-gpt-promotion.json',
)
const shouldWrite = process.argv.includes('--write')
const campaignRoot = 'reference/case-history/generated/black-white-glitter-shape-trials'
const provenancePath = path.join(campaignRoot, 'candidate-provenance.json')
const campaignManifestPath = 'reference/case-history/iphone-black-white-glitter-shape-trials.json'
const existingPublicationPath = 'reference/case-history/gpt-conversation-attempts-publication.json'
const publicDirectory = 'public/assets/cases/case-history/gpt-conversation-attempts'
const publicUrlRoot = '/assets/cases/case-history/gpt-conversation-attempts'

if (!transcriptDirectory) {
  throw new Error('Pass --transcript-dir with the VS Code Copilot transcript directory')
}

const targets = [
  {
    modelId: 'iphone-14',
    finish: 'black',
    candidateVersion: 'v6-gpt',
    sha256: 'db03feb615ef084aec9863fd6536f872d8555e0435c666f37dce1eee1b9b2e80',
    prompt: { kind: 'existing-publication' },
  },
  {
    modelId: 'iphone-14',
    finish: 'white',
    candidateVersion: 'v11-gpt',
    sha256: 'b69710d4c1a6fdefa32ffc9d929f7d3eaa0668c6abba698c8a73ec8bbe2c9c55',
    prompt: { kind: 'existing-publication' },
  },
  {
    modelId: 'iphone-14-plus',
    finish: 'black',
    candidateVersion: 'v2-gpt',
    sha256: 'be4480e9e7c25881e39e82b504a10317b4743502859335f905286dca695c7201',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_iIh8YWnvAYzHxlIHMBTZANjP',
      sha256: '733bec71446c7113b6d8faad5e176249b1fe82a32c8c5dafc46a19887d19a1aa',
    },
  },
  {
    modelId: 'iphone-14-plus',
    finish: 'white',
    candidateVersion: 'v1-gpt',
    sha256: 'de3d1a2c8dc2334ac1737cdaaf120c21de2740cd138c8ca9491051e3efa80b71',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_vFmfABmbsbHJKgcPDtYheDxS',
      toolCallId: 'call_HUjkgN58Ns3XmUFJPg4QOnB0',
      sha256: '228bc3c9056c8a3e30e6864741f00a3e8db5a5d3d7bb4cd94c5dd37c3737a835',
    },
  },
  {
    modelId: 'iphone-14-pro',
    finish: 'black',
    candidateVersion: 'v1-gpt',
    sha256: '9bf59496d4ce0692a9351e180eb557a26af0555dd066ce8bae2e198f2ad5f16d',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_Rbwio3u6lajsWXjXgh81Pzv5',
      toolCallId: 'call_D3Dgmfa4dutim1Z3BkuLT4cT',
      sha256: '5c42d14fe5d16832863b422a111b113cd17838347712d528da8f15e9ec35c2e0',
    },
  },
  {
    modelId: 'iphone-14-pro',
    finish: 'white',
    candidateVersion: 'v2-gpt',
    sha256: '44ca4d051a9717d3f0a3351d7561fc310d39c1a27d6312600e354028b15dd242',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_C0g5BeBn2a6sFir5ISE8B3tL',
      sha256: '2e8e4833a1bb51406f8cb899065fb25994f5a2c111f4362e5e0e5bbb651d7b25',
    },
  },
  {
    modelId: 'iphone-14-pro-max',
    finish: 'black',
    candidateVersion: 'v4-gpt',
    sha256: 'afb1f90bd258ab7a9be950908abdfaa0eb494aa09c69cbb673280415ced4bce0',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_TvYUjFkjWiVLO0gkXjbxuvey',
      toolCallId: 'call_FN9Vwjopgw7IIALatMwypgFU',
      sha256: 'bdd00fade84b723a70a1c28f8ffc9676c7f12d5d8f78b288b98ecc5e184e8f25',
    },
  },
  {
    modelId: 'iphone-14-pro-max',
    finish: 'white',
    candidateVersion: 'v1-gpt',
    sha256: 'c220f424f37679f5b80b478c458f9a4d844da6ed70bc9a5c3db122db0b44ad62',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_eXpUiyweWW0L7jPXeUSKZ3CB',
      toolCallId: 'call_WUr7Isa1ExbxeI7ZoZM0fjAH',
      sha256: 'ca6c08dc087997703b4cd68126b585e794318347cec47740c0f74c04ff712581',
    },
  },
  {
    modelId: 'iphone-15',
    finish: 'black',
    candidateVersion: 'v1-gpt',
    sha256: '0a7357868e3f294bbeded59b8dc7d61dae97ab594195490269a467e2becb0e3e',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_tx4oWfrfA6HsJheHnpkNFhZn',
      toolCallId: 'call_m5e0QaEj9mKorJS4KG02hke2',
      sha256: '62ae25ec418b2dba6a167a337464e1c3d0fcc0dfe9f50fde2fd2115907f86ecb',
    },
  },
  {
    modelId: 'iphone-15',
    finish: 'white',
    candidateVersion: 'v1-gpt',
    sha256: '77357a8fc4746473f5ea8e53dd184e7aff37cb696d1d88f4688d8e43764e2608',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_TjVMLl2jxGjXP9iUWwORbxC4',
      toolCallId: 'call_XY1RIyRPpXIcl5fGcHJZIcTf',
      sha256: 'e81712b8243ba88072e659f504b376aee6ed7b743a99554fb45487d3c29a33ff',
    },
  },
  {
    modelId: 'iphone-15-plus',
    finish: 'black',
    candidateVersion: 'v1-gpt',
    sha256: '3aeb2b70d4978b88ad907f92c946c5db9ee3a4fef75e55e1c6e0eb552690f08d',
    prompt: {
      kind: 'campaign-manifest',
      setupToolCallId: 'call_AhOF0EuwlWGuaN6Iz7vR8ZJW',
      toolCallId: 'call_21dTVz2B9ZnWeCvfYxhxwVu9',
      sha256: '27c69ec27c26fae334692c038a39ee5b26117bed97c8022c58732823ae8bdabe',
    },
  },
  {
    modelId: 'iphone-15-plus',
    finish: 'white',
    candidateVersion: 'v2-gpt',
    sha256: 'a0ab7f74c8b3ff08158cb97ed053b765d6e27ac9701c868456ab693493617777',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_Nk0ErjJEK6TON6ssh83cdj6A',
      sha256: '455e54f9896bec70309034586527545b1cabe71f2a07b17a38575350ac6c350d',
    },
  },
  {
    modelId: 'iphone-15-pro',
    finish: 'black',
    candidateVersion: 'v6b-gpt',
    sha256: 'cfe588f2e7fb688643c2aa5bb29e5c8b4f1d3a918a44d5b7471e1311f090a78c',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_56yhcfUD8SIgkHtkKTVqhLST',
      sha256: '76b7e1f614c8d0fd01cac8d84ca01c36498591182ed5b98ad25ec179b86f20db',
    },
  },
  {
    modelId: 'iphone-15-pro',
    finish: 'white',
    candidateVersion: 'v2-gpt',
    sha256: 'edd9c0d7564d0d07887b93a79ab3facd3fc37f49aa28d5975ad966a9988642ed',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_k8iHuWLZrFM4q1yIE3tzhBRL',
      sha256: '061d2c78f782bd8dbab45011b1aa46f020e6ea4a685fc6314058294da0636dde',
    },
  },
  {
    modelId: 'iphone-15-pro-max',
    finish: 'black',
    candidateVersion: 'v6-gpt',
    sha256: '17cd03048d8ddf9f7a8556284892fab51336c03ffbfba38b9f32e5bb54641f6e',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_04BLPhUATcXuGbMxzrNtaea8',
      sha256: '6695b20993452f7c926c19cf1f0fc58e734fe8445e28ca9b95a29592397f6443',
    },
  },
  {
    modelId: 'iphone-15-pro-max',
    finish: 'white',
    candidateVersion: 'v1-gpt',
    sha256: 'd472b1e108507c354bcf21b573b5a0e300c6b70cde62d5884f55d920f6b74dc7',
    prompt: {
      kind: 'transcript-literal',
      toolCallId: 'call_32FHQyhfxEOdRpN0QVzLdxBD',
      sha256: 'af63a0695876695854d132d8db3f695d47d255d5ed19f1c1a77af8530a85b29e',
    },
  },
]

function sha256(textOrBytes) {
  return createHash('sha256').update(textOrBytes).digest('hex')
}

function keyOf({ modelId, finish }) {
  return `${modelId}:${finish}`
}

function extractTemplatePrompt(code, toolCallId) {
  const marker = /\bconst\s+(prompt|correction)\s*=\s*`/g
  const match = marker.exec(code)
  if (!match) throw new Error(`${toolCallId} does not define a prompt template`)
  const variableName = match[1]
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
    const fillPattern = new RegExp(`\\.fill\\(\\s*${variableName}\\s*\\)`)
    if (!fillPattern.test(code)) {
      throw new Error(`${toolCallId} defines ${variableName} but does not fill it into the composer`)
    }
    return promptText
  }
  throw new Error(`${toolCallId} has an unterminated prompt template`)
}

async function transcriptEvents(directory) {
  const starts = new Map()
  const completions = new Map()
  for (const fileName of (await readdir(directory)).filter((name) => name.endsWith('.jsonl'))) {
    const session = path.basename(fileName, '.jsonl')
    const contents = await readFile(path.join(directory, fileName), 'utf8')
    for (const line of contents.split('\n').filter(Boolean)) {
      const event = JSON.parse(line)
      const toolCallId = event.data?.toolCallId
      if (!toolCallId) continue
      if (event.type === 'tool.execution_start') starts.set(toolCallId, { ...event, session })
      if (event.type === 'tool.execution_complete') completions.set(toolCallId, event)
    }
  }
  return { starts, completions }
}

function successfulEvent(toolCallId, events) {
  const event = events.starts.get(toolCallId)
  if (!event) throw new Error(`Transcript event ${toolCallId} is missing`)
  const completion = events.completions.get(toolCallId)
  if (!completion?.data?.success) throw new Error(`Transcript event ${toolCallId} did not complete successfully`)
  return event
}

async function imageIdentity(filePath) {
  const bytes = await readFile(filePath)
  const metadata = await sharp(bytes).metadata()
  return {
    sha256: sha256(bytes),
    widthPx: metadata.width,
    heightPx: metadata.height,
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
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

const provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
const campaignManifest = JSON.parse(await readFile(campaignManifestPath, 'utf8'))
const existingPublication = JSON.parse(await readFile(existingPublicationPath, 'utf8'))
const events = await transcriptEvents(transcriptDirectory)
const acceptedCandidates = provenance.candidates.filter((candidate) => (
  candidate.reviewStatus === 'accepted-candidate'
  && /^iphone-(14|15)(?:-|$)/.test(candidate.modelId)
  && ['black', 'white'].includes(candidate.finish)
))

if (targets.length !== 16 || acceptedCandidates.length !== 16) {
  throw new Error(`Expected 16 targets and accepted candidates; found ${targets.length} and ${acceptedCandidates.length}`)
}
if (new Set(targets.map(keyOf)).size !== targets.length) {
  throw new Error('Promotion targets contain duplicate model/finish keys')
}

const prompts = []
for (const target of targets) {
  const candidate = acceptedCandidates.find((item) => (
    item.modelId === target.modelId
    && item.finish === target.finish
    && item.candidateVersion === target.candidateVersion
  ))
  if (!candidate) throw new Error(`${keyOf(target)} ${target.candidateVersion} is not accepted in provenance`)
  if (candidate.sha256 !== target.sha256) throw new Error(`${keyOf(target)} provenance SHA-256 changed`)

  let promptText
  let toolCallId
  let submittedAt
  let transcriptSession
  if (target.prompt.kind === 'existing-publication') {
    const existing = existingPublication.prompts.find((item) => (
      item.modelId === target.modelId
      && item.finish === target.finish
      && item.candidateVersion === target.candidateVersion
    ))
    if (!existing) throw new Error(`${keyOf(target)} is missing from the existing exact-prompt publication`)
    promptText = existing.promptText
    toolCallId = existing.transcriptToolCallId
    submittedAt = existing.submittedAt
    const event = successfulEvent(toolCallId, events)
    transcriptSession = event.session
  } else {
    const event = successfulEvent(target.prompt.toolCallId, events)
    const code = String(event.data?.arguments?.code || '')
    toolCallId = target.prompt.toolCallId
    submittedAt = event.timestamp
    transcriptSession = event.session
    if (target.prompt.kind === 'transcript-literal') {
      promptText = extractTemplatePrompt(code, toolCallId)
    } else {
      const setupEvent = successfulEvent(target.prompt.setupToolCallId, events)
      const expectedEntry = `/entry?model=${target.modelId}&finish=${target.finish}`
      if (setupEvent.session !== event.session || !String(setupEvent.data?.arguments?.code || '').includes(expectedEntry)) {
        throw new Error(`${toolCallId} is not linked to the expected ${expectedEntry} setup`)
      }
      if (setupEvent.timestamp >= event.timestamp) throw new Error(`${toolCallId} predates its campaign setup`)
      if (!/\.fill\(\s*entry\.promptText\s*\)/.test(code) || !code.includes('entry.promptSha256')) {
        throw new Error(`${toolCallId} did not browser-verify entry.promptText`)
      }
      const campaignPrompt = campaignManifest.prompts.find((item) => (
        item.modelId === target.modelId && item.finish === target.finish
      ))
      if (!campaignPrompt) throw new Error(`${keyOf(target)} is missing from the campaign manifest`)
      promptText = campaignPrompt.promptText
    }
    if (sha256(promptText) !== target.prompt.sha256) {
      throw new Error(`${keyOf(target)} exact prompt SHA-256 changed`)
    }
  }

  const fileName = `${target.modelId}-${target.finish}-${target.candidateVersion}.png`
  const expectedCandidatePath = `candidates/${fileName}`
  if (candidate.imagePath !== expectedCandidatePath) {
    throw new Error(`${keyOf(target)} candidate path is not ${expectedCandidatePath}`)
  }
  const sourcePath = path.join(campaignRoot, candidate.imagePath)
  const identity = await imageIdentity(sourcePath)
  if (
    identity.sha256 !== target.sha256
    || identity.widthPx !== candidate.widthPx
    || identity.heightPx !== candidate.heightPx
  ) {
    throw new Error(`${keyOf(target)} candidate bytes do not match provenance`)
  }

  const localImagePath = path.join(publicDirectory, fileName)
  if (shouldWrite) await ensurePublicCopy(sourcePath, localImagePath, target.sha256)
  if (await fileExists(localImagePath)) {
    const publicIdentity = await imageIdentity(localImagePath)
    if (publicIdentity.sha256 !== target.sha256) {
      throw new Error(`${localImagePath} does not match the accepted candidate`)
    }
  }

  prompts.push({
    modelId: target.modelId,
    finish: target.finish,
    candidateVersion: target.candidateVersion,
    imageVersion: 'v1',
    publish: true,
    setCurrent: true,
    generator: candidate.generator || 'ChatGPT image generation',
    promptText,
    promptSha256: sha256(promptText),
    referenceImages: candidate.referenceImages || [],
    imagePath: `${publicUrlRoot}/${fileName}`,
    localImagePath,
    sourceCandidatePath: sourcePath,
    sha256: identity.sha256,
    widthPx: identity.widthPx,
    heightPx: identity.heightPx,
    conversationUrl: candidate.conversationUrl || '',
    sourceUrl: candidate.sourceUrl || '',
    reviewStatus: candidate.reviewStatus,
    reviewNotes: candidate.reviewNotes || '',
    promptSource: target.prompt.kind,
    transcriptSession,
    transcriptToolCallId: toolCallId,
    submittedAt,
  })
}

const manifest = {
  schemaVersion: 1,
  campaign: 'iphone-14-15-black-white-gpt-promotion',
  generatedBy: 'scripts/build-iphone-14-15-black-white-promotion.mjs',
  promotionPolicy: 'Exactly 16 accepted iPhone 14-15 Black/White candidates absent from production are appended and made current.',
  sourceManifests: [provenancePath, campaignManifestPath, existingPublicationPath],
  transcriptSessions: [...new Set(prompts.map((prompt) => prompt.transcriptSession))],
  prompts,
}

if (shouldWrite) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(JSON.stringify({
  records: prompts.length,
  current: prompts.filter((prompt) => prompt.setCurrent).length,
  uniqueImages: new Set(prompts.map((prompt) => prompt.sha256)).size,
  uniquePrompts: new Set(prompts.map((prompt) => prompt.promptSha256)).size,
  copiedOrVerified: prompts.filter((prompt) => shouldWrite || prompt.localImagePath).length,
  wrote: shouldWrite ? outputPath : false,
}, null, 2))