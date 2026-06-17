/**
 * upload-proof.js — store a design preview PNG on Shopify Files and return its
 * CDN URL, so it can be attached to the cart line item as `_proof`.
 *
 * Deploy this anywhere that runs Node (Vercel / Netlify / Cloudflare Workers /
 * a Shopify app's own backend). It expects:
 *
 *   POST { designToken: string, image: "data:image/png;base64,...." }
 *   →    { url: "https://cdn.shopify.com/s/files/.../charme-<token>.png" }
 *
 * It uses the Admin GraphQL API in three steps:
 *   1. stagedUploadsCreate  → a one-time upload target (S3-style)
 *   2. PUT the bytes to that target
 *   3. fileCreate           → register the file, poll until READY, return url
 *
 * Required env vars:
 *   SHOPIFY_STORE       e.g. your-store.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN an Admin API access token with `write_files`
 *   ALLOWED_ORIGIN      your storefront origin, for CORS (e.g. https://thecharmeedit.com)
 *
 * NOTE: keep the Admin token on the server only — never expose it in the theme.
 */

const API_VERSION = '2024-10'

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

async function admin(query, variables) {
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  )
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

const STAGED = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`

const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus alt ... on MediaImage { image { url } } }
      userErrors { field message }
    }
  }`

const FILE_QUERY = `
  query getFile($id: ID!) {
    node(id: $id) { ... on MediaImage { fileStatus image { url } } }
  }`

export default async function handler(req, res) {
  const headers = cors(process.env.ALLOWED_ORIGIN)
  if (req.method === 'OPTIONS') return res.writeHead(204, headers).end()
  if (req.method !== 'POST') return res.writeHead(405, headers).end('Method Not Allowed')

  try {
    const { designToken, image } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (!image?.startsWith('data:image/png;base64,')) throw new Error('image must be a PNG data URL')

    const bytes = Buffer.from(image.split(',')[1], 'base64')
    const filename = `charme-${designToken || Date.now()}.png`

    // 1. staged target
    const staged = await admin(STAGED, {
      input: [{ filename, mimeType: 'image/png', httpMethod: 'POST', resource: 'FILE', fileSize: String(bytes.length) }],
    })
    const target = staged.stagedUploadsCreate.stagedTargets[0]

    // 2. upload the bytes
    const form = new FormData()
    for (const p of target.parameters) form.append(p.name, p.value)
    form.append('file', new Blob([bytes], { type: 'image/png' }), filename)
    const up = await fetch(target.url, { method: 'POST', body: form })
    if (!up.ok) throw new Error(`staged upload failed: ${up.status}`)

    // 3. register the file
    const created = await admin(FILE_CREATE, {
      files: [{ alt: `Charmé design ${designToken}`, contentType: 'IMAGE', originalSource: target.resourceUrl }],
    })
    let node = created.fileCreate.files[0]

    // poll until the CDN url is ready
    for (let i = 0; i < 10 && !node?.image?.url; i++) {
      await new Promise((r) => setTimeout(r, 600))
      const q = await admin(FILE_QUERY, { id: node.id })
      node = q.node
    }

    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ url: node?.image?.url || null }))
  } catch (err) {
    res.writeHead(500, { ...cors(process.env.ALLOWED_ORIGIN), 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err.message || err) }))
  }
}
