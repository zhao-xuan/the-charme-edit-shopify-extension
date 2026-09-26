import { bad, json, requireAdmin } from '../_lib.js'
import { TYPES, listRecords, shopifyConfigured } from '../_shopify-store.js'
import { aggregateAnalytics } from '../../../src/lib/analyticsMetrics.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

export const onRequestOptions = () => new Response(null, { headers: cors })

export async function onRequestGet({ request, env }) {
  if (!(await requireAdmin(request, env))) return bad('unauthorized', 401)
  const url = new URL(request.url)
  const days = Math.max(1, Math.min(365, Math.round(Number(url.searchParams.get('days')) || 30)))
  const since = Date.now() - days * 86_400_000
  let sessions

  if (shopifyConfigured(env)) {
    sessions = await listRecords(env, TYPES.analytics)
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
  return json({ days, generatedAt: new Date().toISOString(), ...aggregateAnalytics(filtered) }, { headers: cors })
}
