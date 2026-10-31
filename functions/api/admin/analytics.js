import { bad, json, requireAdmin } from '../_lib.js'
import { TYPES, listRecordsSince, shopifyConfigured } from '../_shopify-store.js'
import { analyticsDb, readAttributionData } from '../_analytics-store.js'
import { aggregateAnalytics } from '../../../src/lib/analyticsMetrics.js'
import { buildAttributionReport } from '../../../src/lib/attributionReport.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

export const onRequestOptions = () => new Response(null, { headers: cors })

/** The per-source report, or `{ unavailable: true }` so the rest of the report still loads. */
async function attributionFor(env, sessions, since) {
  try {
    const db = await analyticsDb(env)
    if (!db) return { unavailable: true }
    const data = await readAttributionData(db, new Date(since).toISOString())
    return { ...buildAttributionReport({ sessions, ...data }), truncated: data.truncated }
  } catch (error) {
    console.error('attribution report failed', error?.message || error)
    return { unavailable: true }
  }
}

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const url = new URL(request.url)
  const days = Math.max(1, Math.min(365, Math.round(Number(url.searchParams.get('days')) || 30)))
  const since = Date.now() - days * 86_400_000
  let sessions
  let truncated = false

  if (shopifyConfigured(env)) {
    // Newest first, so a long window loses its oldest sessions rather than its latest ones.
    const result = await listRecordsSince(env, TYPES.analytics, since)
    sessions = result.records
    truncated = result.truncated
  } else if (env.DB) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS analytics_sessions (
        session_id TEXT PRIMARY KEY, started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, data TEXT NOT NULL
      )`,
    ).run()
    const result = await env.DB.prepare(
      'SELECT data FROM analytics_sessions WHERE started_at >= ? ORDER BY started_at ASC',
    ).bind(new Date(since).toISOString()).all()
    sessions = (result.results || []).map((row) => {
      try { return JSON.parse(row.data) } catch { return null }
    }).filter(Boolean)
  } else {
    return bad('analytics storage unavailable', 503)
  }

  const filtered = sessions.filter((record) => Date.parse(record.startedAt) >= since)
  const attribution = await attributionFor(env, filtered, since)
  return json({
    days,
    generatedAt: new Date().toISOString(),
    truncated,
    recordsScanned: sessions.length,
    ...aggregateAnalytics(filtered),
    attribution,
  }, { headers: cors })
}
