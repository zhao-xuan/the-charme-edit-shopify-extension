// POST /api/analytics/confirm  { sessionId, designTokens: [...] }
//
// Sent by the storefront cart page once it has verified that a designer hand-off
// really arrived in the Shopify cart. It records which designer session owns
// which design tokens, so a later paid order (its line items carry the same
// `_design_token`) can be traced back to the session and its campaign.
// The body is `text/plain` so the cross-origin beacon needs no preflight.
import { bad, json } from '../_lib.js'
import { StudioError, limitWrites, studioDb } from '../_studio.js'
import { allowedOrigin } from '../analytics.js'
import { analyticsDb, purgeExpired, recordDesignLinks, reserveLinkBudget } from '../_analytics-store.js'

const SESSION_ID = /^[A-Za-z0-9_-]{8,80}$/
const DESIGN_TOKEN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_BODY_BYTES = 8_192
// One hand-off carries the designs made in a single editor visit, a handful at most.
const MAX_TOKENS = 20

const corsHeaders = (request) => ({
  'access-control-allow-origin': request.headers.get('origin') || '',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'Origin',
})

export function onRequestOptions({ request, env }) {
  if (!allowedOrigin(request, env)) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'access-control-max-age': '86400' } })
}

async function readLimited(request, limit) {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request, env)) return bad('origin not allowed', 403)
  const headers = corsHeaders(request)
  const reply = (data, status = 200) => json(data, { status, headers })

  const text = await readLimited(request, MAX_BODY_BYTES)
  if (text === null) return reply({ error: 'body too large' }, 413)
  let body
  try { body = JSON.parse(text) } catch { return reply({ error: 'invalid json' }, 400) }

  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (!SESSION_ID.test(sessionId)) return reply({ error: 'invalid session' }, 400)
  const requested = Array.isArray(body.designTokens) ? body.designTokens : []
  const tokens = [...new Set(requested.filter((token) => typeof token === 'string' && DESIGN_TOKEN.test(token)))].slice(0, MAX_TOKENS)
  if (!tokens.length) return reply({ error: 'no design tokens' }, 400)

  try {
    const db = await studioDb(env)
    await limitWrites(db, request, env.SHOPIFY_STORE || 'local', 'confirm')
    await analyticsDb(env)
    if (!(await reserveLinkBudget(db, tokens.length))) return reply({ error: 'rate limited' }, 429)
    await recordDesignLinks(db, sessionId, tokens)
    if (Math.random() < 0.02) await purgeExpired(db)
  } catch (error) {
    if (error instanceof StudioError) return reply({ error: error.status === 429 ? 'rate limited' : 'storage unavailable' }, error.status)
    console.error('[analytics-confirm]', error?.message)
    return reply({ error: 'storage unavailable' }, 500)
  }
  return reply({ ok: true })
}
