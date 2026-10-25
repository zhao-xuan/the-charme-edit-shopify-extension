import { route, onStudioOptions, studioDb, studioShop, readBody, limitWrites, StudioError } from '../_studio.js'
import { MATERIALS } from '../../../src/studio/templates.js'

export const onRequestOptions = onStudioOptions
const EVENTS = new Set(['start','choose','save','submit','quote','cart'])
const DEVICE = new Set(['desktop','tablet','mobile'])
const NAMES = new Map(MATERIALS.map((item) => [item.id,item.name]))
export const onRequestPost = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioShop(env, request, db)
  const body = await readBody(request, 2000)
  if (!/^[0-9a-f-]{36}$/i.test(body.sessionId || '') || !EVENTS.has(body.event)) throw new StudioError('统计事件无效。')
  await limitWrites(db,request,shop,'analytics')
  const now = new Date().toISOString()
  const row = await db.prepare('SELECT data FROM studio_analytics WHERE shop_id=? AND session_id=?').bind(shop,body.sessionId).first()
  const record = row ? JSON.parse(row.data) : { startedAt: now, device: DEVICE.has(body.device) ? body.device : 'unknown', productKind: 'unknown', summaryViews: 0, decorationSelections: {} }
  if (body.event === 'choose' && /^[a-z0-9-]{1,60}$/.test(body.templateId || '')) { record.productKind = body.templateId; record.productSelections = (record.productSelections || 0) + 1 }
  if (body.event === 'save') {record.decorationStartedAt ||= Date.now();record.designSaves=(record.designSaves||0)+1}
  if (body.event === 'submit') {
    record.summaryViews = 1;record.productionRequests=(record.productionRequests||0)+1
    const ids = Array.isArray(body.materialIds) ? body.materialIds.slice(0,120).filter((id) => NAMES.has(id)) : []
    record.finalDecorationCount=ids.length
    for (const id of ids) {record.decorationSelections[id]=(record.decorationSelections[id]||0)+1;record.decorationNames ||= {};record.decorationNames[id]=NAMES.get(id)}
  }
  if (body.event === 'quote') {record.purchaseClicked = true;record.quoteRequests=(record.quoteRequests||0)+1}
  if (body.event === 'cart') {record.purchaseClicked = true;record.checkoutSucceeded = true;record.cartHandoffs=(record.cartHandoffs||0)+1}
  record.activeMs = Math.min(86_400_000,Date.now() - Date.parse(record.startedAt))
  record.decorationActiveMs = record.decorationStartedAt ? Math.min(record.activeMs,Date.now()-record.decorationStartedAt) : 0
  if (row) await db.prepare('UPDATE studio_analytics SET data=?,last_seen_at=? WHERE shop_id=? AND session_id=?').bind(JSON.stringify(record),now,shop,body.sessionId).run()
  else await db.prepare('INSERT OR IGNORE INTO studio_analytics(shop_id,session_id,started_at,last_seen_at,data) VALUES (?,?,?,?,?)').bind(shop,body.sessionId,now,now,JSON.stringify(record)).run()
  return { ok: true }
})
