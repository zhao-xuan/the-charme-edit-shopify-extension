import { bad, json } from './_lib.js'
import { TYPES, saveRecord, shopifyConfigured } from './_shopify-store.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

export const onRequestOptions = () => new Response(null, { headers: cors })

const text = (value, max = 120) => String(value || '').trim().slice(0, max)
const count = (value, max = 100000) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)))
const flag = (value) => value === true

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || ''
  const configured = String(env.ANALYTICS_ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean)
  if (configured.includes(origin)) return true
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'thecharmeedit.com'
      || host.endsWith('.thecharmeedit.com')
      || host.endsWith('.myshopify.com')
      || host === 'charme-customizer.pages.dev'
      || host.endsWith('.charme-customizer.pages.dev')
      || host === 'localhost'
      || host === '127.0.0.1'
  } catch {
    return false
  }
}

function stringCountMap(value, names = false) {
  const out = {}
  for (const [key, raw] of Object.entries(value || {}).slice(0, 100)) {
    const safeKey = text(key, 80)
    if (!safeKey) continue
    out[safeKey] = names ? text(raw, 120) : count(raw, 1000)
  }
  return out
}

export function normalizeAnalyticsSession(body, now = Date.now()) {
  const sessionId = text(body?.sessionId, 80)
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(sessionId)) return null
  const startedMs = Date.parse(body.startedAt)
  const lastSeenMs = Date.parse(body.lastSeenAt)
  if (!Number.isFinite(startedMs) || startedMs > now + 300_000) return null
  const safeLastSeen = Number.isFinite(lastSeenMs) ? Math.max(startedMs, Math.min(lastSeenMs, now + 300_000)) : now
  const activeMs = count(body.activeMs, 86_400_000)
  const decorationStartedMs = Number(body.decorationStartedAt)
  const decorationStartedAt = Number.isFinite(decorationStartedMs)
    && decorationStartedMs >= startedMs
    && decorationStartedMs <= safeLastSeen
    ? Math.round(decorationStartedMs)
    : null
  return {
    sessionId,
    startedAt: new Date(startedMs).toISOString(),
    lastSeenAt: new Date(safeLastSeen).toISOString(),
    activeMs,
    decorationStartedAt,
    decorationActiveMs: Math.min(count(body.decorationActiveMs, 86_400_000), activeMs),
    productId: text(body.productId),
    productName: text(body.productName),
    productKind: ['phone', 'tote', 'frame'].includes(body.productKind) ? body.productKind : 'unknown',
    finish: text(body.finish, 80),
    locale: text(body.locale, 20),
    currency: text(body.currency, 8).toUpperCase(),
    device: ['mobile', 'tablet', 'desktop'].includes(body.device) ? body.device : 'unknown',
    entryPoint: ['shopify', 'standalone'].includes(body.entryPoint) ? body.entryPoint : 'unknown',
    productSelections: count(body.productSelections, 1000),
    finishChanges: count(body.finishChanges, 1000),
    categoryChanges: count(body.categoryChanges, 5000),
    decorationAdds: count(body.decorationAdds, 5000),
    decorationRemoves: count(body.decorationRemoves, 5000),
    decorationMoves: count(body.decorationMoves, 100000),
    undoCount: count(body.undoCount, 1000),
    clearCount: count(body.clearCount, 1000),
    zoomActions: count(body.zoomActions, 10000),
    trayExpansions: count(body.trayExpansions, 1000),
    sideSwitches: count(body.sideSwitches, 1000),
    summaryViews: count(body.summaryViews, 1000),
    blockedOrderAttempts: count(body.blockedOrderAttempts, 1000),
    purchaseClicked: flag(body.purchaseClicked),
    checkoutSucceeded: flag(body.checkoutSucceeded),
    checkoutFailures: count(body.checkoutFailures, 100),
    finalDecorationCount: count(body.finalDecorationCount, 1000),
    maxDecorationCount: count(body.maxDecorationCount, 1000),
    decorationSelections: stringCountMap(body.decorationSelections),
    decorationNames: stringCountMap(body.decorationNames, true),
    lastEvent: text(body.lastEvent, 40),
  }
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request, env)) return bad('origin not allowed', 403)
  const raw = await request.json().catch(() => null)
  const record = normalizeAnalyticsSession(raw)
  if (!record) return bad('invalid analytics session')

  if (shopifyConfigured(env)) {
    await saveRecord(env, TYPES.analytics, record.sessionId, record)
  } else if (env.DB) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS analytics_sessions (
        session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO analytics_sessions (session_id, started_at, last_seen_at, data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, data=excluded.data`,
    ).bind(record.sessionId, record.startedAt, record.lastSeenAt, JSON.stringify(record)).run()
  } else {
    return bad('analytics storage unavailable', 503)
  }

  return json({ ok: true }, { headers: cors })
}
