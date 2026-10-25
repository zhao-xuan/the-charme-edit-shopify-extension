import { aggregateAnalytics } from '../../../../src/lib/analyticsMetrics.js'
import { route, onStudioOptions, studioDb, studioAdmin } from '../../_studio.js'

export const onRequestOptions = onStudioOptions
export const onRequestGet = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const days = Math.max(1,Math.min(365,Math.round(Number(new URL(request.url).searchParams.get('days')) || 30)))
  const since = new Date(Date.now()-days*86_400_000).toISOString()
  const { results } = await db.prepare('SELECT data FROM studio_analytics WHERE shop_id=? AND started_at>=? ORDER BY started_at DESC LIMIT 10000').bind(shop,since).all()
  return { days, generatedAt: new Date().toISOString(), ...aggregateAnalytics(results.flatMap((row) => { try { return [JSON.parse(row.data)] } catch { return [] } })) }
})
