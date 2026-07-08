// Shared helpers for the Charmé catalog API (Cloudflare Pages Functions).

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...(init.headers || {}),
    },
  })

export const bad = (msg, status = 400) => json({ error: msg }, { status })

/** Decode a base64url string to bytes. */
function b64urlToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4
  if (pad) s += '='.repeat(4 - pad)
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Verify a Shopify App Bridge session token (a JWT signed HS256 with the app's
 * client secret). Returns the decoded payload if valid, else null.
 * See https://shopify.dev/docs/apps/auth/session-tokens.
 */
export async function verifyShopifySessionToken(token, env) {
  const secret = env.SHOPIFY_CLIENT_SECRET
  if (!secret || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  let payload
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const ok = await crypto.subtle.verify(
      'HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
    )
    if (!ok) return null
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)))
  } catch {
    return null
  }
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now >= Number(payload.exp)) return null
  if (payload.nbf && now < Number(payload.nbf) - 5) return null
  // aud must be this app's API key (client id) when we know it.
  if (env.SHOPIFY_CLIENT_ID && payload.aud && payload.aud !== env.SHOPIFY_CLIENT_ID) return null
  return payload
}

/**
 * Require an admin bearer token. Accepts EITHER the static ADMIN_TOKEN secret
 * (external admin subdomain / API clients) OR a valid Shopify App Bridge session
 * token (the embedded Shopify Admin app). Async because JWT verification is.
 */
export async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return false
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true
  if (await verifyShopifySessionToken(token, env)) return true
  return false
}

/** Map a D1 charm row to the catalogue shape the client expects. */
export const rowToCharm = (r) => ({
  id: r.id,
  name: r.name,
  collection: r.collection,
  category: r.category,
  tier: r.tier,
  type: r.type,
  price: r.price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  pxW: r.px_w,
  pxH: r.px_h,
  src: `/api/image/${r.image_key}`,
  hidden: !!r.hidden,
  source: r.source,
  dupOf: r.dup_of,
  dupScore: r.dup_score,
  bundle: !!r.bundle,
  bundleMax: r.bundle_max ?? null,
  minScale: 1,
  maxScale: 1,
})

export const rowToProduct = (r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  basePrice: r.base_price,
  widthMm: r.width_mm,
  heightMm: r.height_mm,
  src: r.image_key ? `/api/image/${r.image_key}` : null,
  colourLabel: r.colour_label,
})

/** Decode a data: URL and store the bytes in KV under `img:<key>`. Returns key. */
export async function storeImage(env, key, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '')
  if (!m) throw new Error('expected a base64 data URL')
  const contentType = m[1]
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  await env.IMAGES.put(`img:${key}`, bytes, { metadata: { contentType } })
  return key
}

const slug = (s) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item'
const rid = () => Math.random().toString(36).slice(2, 7)
export const makeId = (prefix, name) => `${prefix}-${slug(name)}-${rid()}`

// ---------------------------------------------------------------------------
// Shopify Admin API helpers (client_credentials grant → GraphQL → Files upload)
// ---------------------------------------------------------------------------

const SHOPIFY_API_VERSION = '2024-10'

// Cache the exchanged access token per isolate (best-effort; tokens expire).
let _shopifyToken = null // { token, exp }

/**
 * Resolve a Shopify Admin API access token. New dev-dashboard custom apps expose
 * a Client ID + Secret and you exchange them for a short-lived token via the
 * client_credentials grant; fall back to a static SHOPIFY_ADMIN_TOKEN if set.
 */
export async function getShopifyToken(env) {
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET && env.SHOPIFY_STORE) {
    const now = Date.now()
    if (_shopifyToken && _shopifyToken.exp > now + 60_000) return _shopifyToken.token
    const res = await fetch(`https://${env.SHOPIFY_STORE}/admin/oauth/access_token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) {
      throw new Error(`token exchange failed: ${JSON.stringify(data).slice(0, 200)}`)
    }
    _shopifyToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 }
    return _shopifyToken.token
  }
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN
  throw new Error('no Shopify auth configured')
}

/** Run an Admin GraphQL query. Throws on GraphQL-level errors. */
export async function shopifyAdmin(env, query, variables) {
  const token = await getShopifyToken(env)
  const res = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
    },
  )
  const body = await res.json()
  if (body.errors) throw new Error(JSON.stringify(body.errors))
  return body.data
}

const STAGED_UPLOADS_CREATE = `
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

const FILE_NODE = `
  query fileNode($id: ID!) {
    node(id: $id) { ... on MediaImage { id fileStatus image { url } } }
  }`

const FILE_DELETE = `
  mutation fileDelete($ids: [ID!]!) {
    fileDelete(fileIds: $ids) {
      deletedFileIds
      userErrors { field message }
    }
  }`

/**
 * Upload raw image bytes to the store's **Shopify Files** (Content → Files) and
 * return { url, id } — the permanent `cdn.shopify.com` URL plus the File GID
 * (kept so callers can later `fileDelete` it). `url` is null if Shopify hasn't
 * finished processing within the poll window (caller should fall back).
 * Steps: stage an upload target, POST the bytes to it, create the File, then
 * poll until Shopify exposes the CDN url.
 */
export async function uploadImageFile(env, bytes, opts = {}) {
  const contentType = opts.contentType || 'image/png'
  const filename = opts.filename || `charme-${rid()}.png`
  const alt = opts.alt || filename

  // 1) Ask Shopify for a staged upload target (S3/GCS form POST).
  const staged = await shopifyAdmin(env, STAGED_UPLOADS_CREATE, {
    input: [{ resource: 'IMAGE', filename, mimeType: contentType, httpMethod: 'POST' }],
  })
  const errs = staged.stagedUploadsCreate.userErrors
  if (errs && errs.length) throw new Error('stagedUploadsCreate: ' + JSON.stringify(errs))
  const target = staged.stagedUploadsCreate.stagedTargets[0]
  if (!target) throw new Error('no staged upload target returned')

  // 2) POST the file to the staged target with all provided form parameters.
  const form = new FormData()
  for (const p of target.parameters) form.append(p.name, p.value)
  form.append('file', new Blob([bytes], { type: contentType }), filename)
  const up = await fetch(target.url, { method: 'POST', body: form })
  if (!up.ok) throw new Error('staged upload POST failed: ' + up.status)

  // 3) Register the uploaded resource as a File.
  const created = await shopifyAdmin(env, FILE_CREATE, {
    files: [{ contentType: 'IMAGE', originalSource: target.resourceUrl, alt }],
  })
  const cErrs = created.fileCreate.userErrors
  if (cErrs && cErrs.length) throw new Error('fileCreate: ' + JSON.stringify(cErrs))
  const file = created.fileCreate.files[0]
  if (!file) throw new Error('fileCreate returned no file')
  if (file.image && file.image.url) return { url: file.image.url, id: file.id }

  // 4) Poll until Shopify finishes processing and exposes the CDN url.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 700))
    const q = await shopifyAdmin(env, FILE_NODE, { id: file.id })
    const node = q.node
    if (node && node.image && node.image.url) return { url: node.image.url, id: file.id }
    if (node && node.fileStatus === 'FAILED') throw new Error('Shopify file processing failed')
  }
  return { url: null, id: file.id }
}

/**
 * Back-compat wrapper: upload image bytes and return just the CDN URL (or null).
 * Existing callers (draft-order proof, upload-proof) use the URL string.
 */
export async function uploadImageToShopifyFiles(env, bytes, opts = {}) {
  const { url } = await uploadImageFile(env, bytes, opts)
  return url
}

/** Best-effort delete of Shopify File(s) by GID. Never throws. */
export async function fileDelete(env, ids) {
  const list = (ids || []).filter(Boolean)
  if (!list.length) return
  try {
    await shopifyAdmin(env, FILE_DELETE, { ids: list })
  } catch (e) {
    console.warn('[Charmé] fileDelete failed', e && e.message)
  }
}

