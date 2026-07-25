import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import sharp from 'sharp'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const target = argument('target')
const port = Number(argument('port', '8765'))
const resultPath = argument('result')
const allowedDirectories = new Set([
  path.resolve('reference/case-history/generated/black-white-glitter-shape-trials/candidates'),
  path.resolve('reference/case-history/generated/shopify-iphone-without-gel-regeneration/candidates'),
])
const resolvedTarget = path.resolve(target)

if (!target || !allowedDirectories.has(path.dirname(resolvedTarget)) || path.extname(resolvedTarget) !== '.png') {
  throw new Error('Pass --target with a PNG directly inside an allowed campaign candidates directory')
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`Invalid port ${port}`)
}
await access(resolvedTarget).then(
  () => { throw new Error(`${target} already exists`) },
  (error) => { if (error.code !== 'ENOENT') throw error },
)

async function saveCandidate(bytes, sourceUrl = '') {
  const metadata = await sharp(bytes).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error('Received bytes are not a valid PNG')
  }
  await writeFile(resolvedTarget, bytes, { flag: 'wx' })
  return {
    target,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    widthPx: metadata.width,
    heightPx: metadata.height,
    sourceUrl,
  }
}

if (resultPath) {
  const serialized = await readFile(resultPath, 'utf8')
  const payload = JSON.parse(serialized.replace(/^Result:\s*/, ''))
  if (!payload.sourceUrl?.startsWith('https://chatgpt.com/backend-api/estuary/content?')) {
    throw new Error('Browser result does not contain a ChatGPT Estuary source URL')
  }
  if (typeof payload.base64 !== 'string' || payload.base64.length === 0) {
    throw new Error('Browser result does not contain PNG base64')
  }
  const result = await saveCandidate(Buffer.from(payload.base64, 'base64'), payload.sourceUrl)
  console.log(`SAVED ${JSON.stringify(result)}`)
  process.exit(0)
}

const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'https://chatgpt.com')
  response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  if (request.method !== 'POST' || request.url !== '/upload') {
    response.writeHead(404)
    response.end()
    return
  }
  if (!String(request.headers['content-type'] || '').startsWith('image/png')) {
    response.writeHead(415)
    response.end('Expected image/png', () => server.close())
    return
  }

  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > 30 * 1024 * 1024) request.destroy(new Error('Candidate exceeds 30 MiB'))
    chunks.push(chunk)
  })
  request.on('end', async () => {
    try {
      const bytes = Buffer.concat(chunks)
      const result = await saveCandidate(bytes)
      console.log(`SAVED ${JSON.stringify(result)}`)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(result), () => server.close())
    } catch (error) {
      console.error(error)
      response.writeHead(500)
      response.end(String(error), () => server.close())
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`READY http://127.0.0.1:${port}/upload -> ${target}`)
})