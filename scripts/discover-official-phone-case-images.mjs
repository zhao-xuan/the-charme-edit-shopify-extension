#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DEFAULT_MANIFEST = 'reference/case-history/generated/official-phone-case-crawl/samsung-candidates.json'
const DEFAULT_ORIGINALS = 'reference/case-history/generated/official-phone-case-crawl/originals'
const SITEMAPS = [
  'https://www.samsung.com/uk/im-sitemap.xml',
  'https://www.samsung.com/uk/business/b2b-sitemap.xml',
]
const VISUAL_REJECTION_REASONS = new Map([
  ['EF-PS918TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS918LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-PS916TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS916LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-PS911TUEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-VS911LBEGWW', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-ES948CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES948CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES947CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES947CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES942CBEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['EF-ES942CWEGWW', 'Large magnetic ring obstructs the usable case back'],
  ['GP-FPS928SBJBW', 'Third-party Shieldon carbon-fibre case is visibly branded and textured'],
  ['GP-FPS921SBJBW', 'Third-party Shieldon carbon-fibre case is visibly branded and textured'],
  ['EF-PG780TVEGEU', 'Front-screen render; rear case and camera hardware are not visible'],
  ['GP-FPA516KDATW', 'Wrong A51 network model and front-screen render'],
  ['EF-QA326TBEGEU', 'Empty case shell; phone and camera hardware are absent'],
  ['EF-QA125TTEGEU', 'Front-screen render; rear case and camera hardware are not visible'],
])

const modelFilter = argumentValue('model', '')
const manifestPath = argumentValue('manifest', DEFAULT_MANIFEST)
const originalsDir = argumentValue('originals-dir', DEFAULT_ORIGINALS)
const candidateLimit = Number(argumentValue('candidate-limit', '20'))

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function slugOf(url) {
  return new URL(url).pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() || ''
}

function aliasesFor(modelId) {
  if (modelId === 'galaxy-a52-a52s-4g-5g') return ['galaxy-a52', 'galaxy-a52s']
  const alias = modelId
    .replace(/-(?:4g-5g|4g|5g)$/, '')
    .replace(/^galaxy-note-(\d+)/, 'galaxy-note$1')
    .replace(/^galaxy-z-(fold|flip)-(\d+)/, 'galaxy-z-$1$2')
  return [alias]
}

function exactModelMatch(modelId, url) {
  const slug = slugOf(url)
  const aliases = aliasesFor(modelId)
  const alias = aliases.find((value) => new RegExp(`(?:^|-)${value}(?:-|$)`).test(slug))
  if (!alias) return false
  if (/-4g$/.test(modelId) && /(?:^|-)5g(?:-|$)/.test(slug)) return false
  if (/-5g$/.test(modelId) && !/(?:^|-)5g(?:-|$)/.test(slug)) return false
  if (/^galaxy-s\d+$/.test(alias) && new RegExp(`${alias}-(?:plus|ultra|fe|edge)(?:-|$)`).test(slug)) return false
  if (/^galaxy-note\d+$/.test(alias) && new RegExp(`${alias}-plus(?:-|$)`).test(slug)) return false
  if (!/(?:case|cover|shield|suit)/.test(slug)) return false
  return !/(?:adidas|card-only|card-slot|frame-case|screen-protector|protective-film|strap|ring|magnet|shieldon|flipsuit|wallet|smart-view|clear-view|gadget|grip|standing|s-pen|flap|haainc)/.test(slug)
}

function colourOf(...values) {
  const text = values.filter(Boolean).join('-').toLowerCase().replaceAll('_', '-')
  if (/(?:^|-)(?:black|graphite|blue-black)(?:-|$)/.test(text)) return 'black'
  if (/(?:^|-)(?:white|cream|light-gray|light-grey|silver)(?:-|$)/.test(text)) return 'white'
  const known = text.match(/(?:^|-)(blue|green|navy|mint|pink|red|violet|yellow|orange|brown|gray|grey)(?:-|$)/)?.[1]
  return known || 'other'
}

function candidateScore(url) {
  const slug = slugOf(url)
  const colour = colourOf(slug)
  let score = colour === 'black' ? 500 : colour === 'white' ? 450 : 100
  if (/silicone/.test(slug)) score += 100
  if (/leather/.test(slug)) score += 50
  if (/rugged|protective/.test(slug)) score += 30
  if (/clear/.test(slug)) score -= 40
  if (/\/business\//.test(url)) score -= 1
  return score
}

function skuFrom(url) {
  return slugOf(url).match(/(?:^|-)((?:ef|gp)-[a-z0-9]+)$/)?.[1]?.toUpperCase() || null
}

function absoluteSamsungUrl(value) {
  if (!value) return null
  return value.startsWith('//') ? `https:${value}` : value
}

function decodePage(html) {
  return html
    .replaceAll('\\/', '/')
    .replaceAll('\\u002F', '/')
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&amp;', '&')
}

async function fetchOk(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 CharmeSourceReview/1.0' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

async function sitemapUrls() {
  const urls = []
  for (const sitemap of SITEMAPS) {
    const xml = await (await fetchOk(sitemap)).text()
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      if (/\/mobile-accessories\//.test(match[1])) urls.push(match[1])
    }
  }
  return [...new Set(urls)]
}

async function imageFromApi(sku) {
  const endpoint = new URL('https://searchapi.samsung.com/v6/front/b2c/product/card/detail/newhybris')
  Object.entries({
    siteCode: 'uk',
    modelList: sku,
    saleSkuYN: 'N',
    onlyRequestSkuYN: 'N',
    keySummaryYN: 'N',
    keySpecYN: 'N',
    quicklookYN: 'N',
    commonCodeYN: 'N',
  }).forEach(([key, value]) => endpoint.searchParams.set(key, value))
  const data = await (await fetchOk(endpoint)).json()
  const models = data.response?.resultData?.productList?.flatMap((family) => family.modelList || []) || []
  const model = models.find((entry) => entry.modelCode?.toUpperCase() === sku) || null
  if (!model?.largeUrl || /-thumb-/i.test(model.largeUrl)) return null
  return {
    imageUrl: absoluteSamsungUrl(model.largeUrl),
    imageRole: model.thumbUrlAlt || 'main',
    apiModelCode: model.modelCode,
    apiDisplayName: model.displayName,
    apiColour: model.fmyChipList?.find((chip) => chip.fmyChipType === 'COLOR')?.fmyChipLocalName || null,
  }
}

async function imageFromPage(pageUrl, sku) {
  const html = decodePage(await (await fetchOk(pageUrl)).text())
  const urls = [...new Set(html.match(/https?:\/\/images\.samsung\.com\/is\/image\/samsung\/[^"'<>\s]+/g) || [])]
    .map((url) => url.split('?')[0])
  const skuToken = sku?.toLowerCase()
  const productImages = urls.filter((url) => {
    const lower = url.toLowerCase()
    return !lower.includes('-thumb-')
      && !lower.includes('/assets/')
      && (!skuToken || lower.includes(skuToken))
  })
  const imageUrl = productImages.find((url) => /(?:front|gallery)/i.test(url)) || productImages[0]
  return imageUrl ? { imageUrl, imageRole: 'page-main', apiModelCode: null, apiDisplayName: null, apiColour: null } : null
}

function originalUrl(imageUrl) {
  return `${imageUrl.split('?')[0]}?$ORIGIN_PNG$`
}

function cameraHoleEvidence(data, info, bounds) {
  const pixelCount = info.width * info.height
  const outside = new Uint8Array(pixelCount)
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueHead = 0
  let queueTail = 0
  const isTransparent = (index) => data[index * info.channels + 3] < 32
  const addOutside = (index) => {
    if (outside[index] || !isTransparent(index)) return
    outside[index] = 1
    queue[queueTail++] = index
  }
  const visitNeighbours = (index, visit) => {
    const x = index % info.width
    if (index >= info.width) visit(index - info.width)
    if (index < pixelCount - info.width) visit(index + info.width)
    if (x > 0) visit(index - 1)
    if (x < info.width - 1) visit(index + 1)
  }

  for (let x = 0; x < info.width; x += 1) {
    addOutside(x)
    addOutside((info.height - 1) * info.width + x)
  }
  for (let y = 0; y < info.height; y += 1) {
    addOutside(y * info.width)
    addOutside(y * info.width + info.width - 1)
  }
  while (queueHead < queueTail) {
    visitNeighbours(queue[queueHead++], addOutside)
  }

  const areas = []
  const cameraRight = Math.floor(bounds.left + bounds.width * 0.55)
  const cameraBottom = Math.floor(bounds.top + bounds.height * 0.5)
  for (let y = bounds.top; y <= cameraBottom; y += 1) {
    for (let x = bounds.left; x <= cameraRight; x += 1) {
      const start = y * info.width + x
      if (outside[start] || visited[start] || !isTransparent(start)) continue
      queueHead = 0
      queueTail = 0
      visited[start] = 1
      queue[queueTail++] = start
      let area = 0
      while (queueHead < queueTail) {
        const index = queue[queueHead++]
        area += 1
        visitNeighbours(index, (next) => {
          if (outside[next] || visited[next] || !isTransparent(next)) return
          visited[next] = 1
          queue[queueTail++] = next
        })
      }
      if (area >= 64) areas.push(area)
    }
  }
  const largestAreaPx = Math.max(0, ...areas)
  return {
    count: areas.length,
    largestAreaPx,
    largestFraction: largestAreaPx / (bounds.width * bounds.height),
  }
}

async function imageEvidence(bytes) {
  const image = sharp(bytes)
  const metadata = await image.metadata()
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width
  let top = info.height
  let right = -1
  let bottom = -1
  let transparentPixels = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3]
      if (alpha === 0) transparentPixels += 1
      if (alpha < 128) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) throw new Error('Official image has no visible alpha subject')
  const visibleWidth = right - left + 1
  const visibleHeight = bottom - top + 1
  const visibleBounds = { left, top, right, bottom, width: visibleWidth, height: visibleHeight }
  return {
    format: metadata.format,
    widthPx: info.width,
    heightPx: info.height,
    channels: info.channels,
    hasAlpha: metadata.hasAlpha,
    transparentPixelFraction: transparentPixels / (info.width * info.height),
    visibleBounds,
    visibleAspect: visibleWidth / visibleHeight,
    cameraTransparentHoles: cameraHoleEvidence(data, info, visibleBounds),
  }
}

async function downloadCandidate(modelId, pageUrl) {
  const sku = skuFrom(pageUrl)
  const source = (sku && await imageFromApi(sku)) || await imageFromPage(pageUrl, sku)
  if (!source) throw new Error('No Samsung product image found')
  const sourceColour = colourOf(pageUrl, source.imageUrl, source.apiColour)
  const sourceUrl = originalUrl(source.imageUrl)
  const bytes = Buffer.from(await (await fetchOk(sourceUrl)).arrayBuffer())
  const evidence = await imageEvidence(bytes)
  if (Math.max(evidence.widthPx, evidence.heightPx) < 1000 || evidence.visibleBounds.height < 800) {
    throw new Error(`Official image is not high resolution: ${evidence.widthPx}x${evidence.heightPx}, subject ${evidence.visibleBounds.width}x${evidence.visibleBounds.height}`)
  }
  if (evidence.visibleAspect < 0.42 || evidence.visibleAspect > 0.56) {
    throw new Error(`Official image is not a straight-on tall case: visible aspect ${evidence.visibleAspect.toFixed(4)}`)
  }
  if (evidence.cameraTransparentHoles.largestFraction >= 0.004) {
    throw new Error(`Official image is an empty case shell: transparent camera hole fraction ${evidence.cameraTransparentHoles.largestFraction.toFixed(4)}`)
  }
  const hash = sha256(bytes)
  const filePath = path.join(originalsDir, `${modelId}-${sourceColour}-${hash.slice(0, 12)}.png`)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  return {
    modelId,
    status: 'candidate-found',
    publish: false,
    reviewStatus: 'pending-visual-review',
    reviewRequirements: ['exact-model', 'complete-phone-in-case', 'rear-view', 'straight-on', 'camera-hardware-visible'],
    targetFinish: sourceColour,
    sourceColour,
    finishFallback: false,
    sourcePageUrl: pageUrl,
    sourceUrl,
    sourceImageRole: source.imageRole,
    sourceSku: sku,
    apiModelCode: source.apiModelCode,
    apiDisplayName: source.apiDisplayName,
    apiColour: source.apiColour,
    sourcePath: filePath,
    sha256: hash,
    ...evidence,
  }
}

async function discoverModel(modelId, allUrls) {
  const pages = allUrls
    .filter((url) => exactModelMatch(modelId, url))
    .sort((left, right) => candidateScore(right) - candidateScore(left))
  const seenSkus = new Set()
  const attempts = []
  const preferred = new Map()
  let fallback = null
  for (const pageUrl of pages) {
    if (attempts.length >= candidateLimit) break
    const hintedColour = colourOf(pageUrl)
    if ((hintedColour === 'black' || hintedColour === 'white') && preferred.has(hintedColour)) continue
    const sku = skuFrom(pageUrl)
    if (VISUAL_REJECTION_REASONS.has(sku)) {
      attempts.push({ pageUrl, sku, error: `Rejected by direct visual review: ${VISUAL_REJECTION_REASONS.get(sku)}` })
      continue
    }
    if (sku && seenSkus.has(sku)) continue
    if (sku) seenSkus.add(sku)
    try {
      const candidate = await downloadCandidate(modelId, pageUrl)
      if (candidate.sourceColour === 'black' || candidate.sourceColour === 'white') {
        if (!preferred.has(candidate.sourceColour)) preferred.set(candidate.sourceColour, candidate)
      } else if (!fallback) {
        fallback = candidate
      }
      if (preferred.size === 2 || fallback) break
    } catch (error) {
      attempts.push({ pageUrl, sku, error: error.message })
    }
  }
  const candidates = ['black', 'white'].flatMap((finish) => preferred.has(finish) ? [preferred.get(finish)] : [])
  if (preferred.size < 2 && fallback) {
    fallback.targetFinish = preferred.has('black') ? 'white' : 'black'
    fallback.finishFallback = true
    candidates.push(fallback)
  }
  if (candidates.length) return { modelId, status: 'candidate-found', candidates, attempts }
  return {
    modelId,
    status: pages.length ? 'no-usable-download' : 'no-official-page-match',
    publish: false,
    reviewStatus: 'missing',
    candidatePageCount: pages.length,
    attempts,
  }
}

async function modelIds() {
  const variantMap = JSON.parse(await readFile('shopify/widget/variantmap-products.generated.json', 'utf8'))
  const ids = [...new Set(Object.keys(variantMap).map((key) => key.split(':')[0]))]
    .filter((id) => id.startsWith('galaxy-'))
  if (modelFilter && !ids.includes(modelFilter)) throw new Error(`Unknown Galaxy model: ${modelFilter}`)
  return modelFilter ? [modelFilter] : ids
}

async function main() {
  const [targets, urls] = await Promise.all([modelIds(), sitemapUrls()])
  const candidates = []
  for (const modelId of targets) {
    const result = await discoverModel(modelId, urls)
    candidates.push(...(result.candidates || []))
    const finishes = result.candidates?.map((candidate) => `${candidate.targetFinish}:${candidate.sourceSku}`).join(', ')
    console.log(`${modelId}: ${result.status}${finishes ? ` (${finishes})` : ''}`)
    if (!result.candidates?.length) candidates.push(result)
  }
  const manifest = {
    schemaVersion: 1,
    campaign: 'official-phone-case-crawl',
    generatedAt: new Date().toISOString(),
    sourcePolicy: 'Samsung-owned product pages and image CDN only. Every candidate requires visual review before publication.',
    sourceSitemaps: SITEMAPS,
    summary: {
      targets: targets.length,
      candidates: candidates.filter((candidate) => candidate.status === 'candidate-found').length,
      modelsWithCandidates: new Set(candidates.filter((candidate) => candidate.status === 'candidate-found').map((candidate) => candidate.modelId)).size,
      missingModels: targets.filter((modelId) => !candidates.some((candidate) => candidate.modelId === modelId && candidate.status === 'candidate-found')).length,
      approved: 0,
    },
    candidates,
  }
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${manifestPath}`)
}

await main()