import { route, onStudioOptions, studioDb, studioAdmin, getTemplate, readBody, StudioError, customizerId } from '../../_studio.js'

export const onRequestOptions = onStudioOptions
const publicRow = (row) => ({ id: row.id, templateId: row.template_id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })

export const onRequestGet = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const { results } = await db.prepare('SELECT * FROM studio_customizers WHERE shop_id=? ORDER BY updated_at DESC LIMIT 200').bind(shop).all()
  return { customizers: results.map(publicRow) }
})

export const onRequestPost = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const body = await readBody(request, 4000)
  const id = customizerId(body.id)
  const template = await getTemplate(db, shop, body.templateId)
  if (!template) throw new StudioError('商品模板不存在。', 404)
  const name = String(body.name || '').trim()
  if (!name || name.length > 80) throw new StudioError('请输入不超过 80 字的名称。')
  const now = new Date().toISOString()
  const result = await db.prepare("INSERT OR IGNORE INTO studio_customizers(shop_id,id,template_id,name,status,created_at,updated_at) VALUES (?,?,?,?, 'draft',?,?)").bind(shop,id,template.id,name,now,now).run()
  if (!result.meta?.changes) throw new StudioError('定制器编号已存在。', 409)
  return { customizer: { id, templateId: template.id, name, status: 'draft', createdAt: now, updatedAt: now } }
})

export const onRequestPatch = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const body = await readBody(request, 4000), id = customizerId(body.id)
  const row = await db.prepare('SELECT * FROM studio_customizers WHERE shop_id=? AND id=?').bind(shop,id).first()
  if (!row) throw new StudioError('定制器不存在。', 404)
  const name = body.name === undefined ? row.name : String(body.name).trim()
  if (!name || name.length > 80) throw new StudioError('请输入不超过 80 字的名称。')
  const status = body.status === undefined ? row.status : body.status
  if (!['draft','published'].includes(status)) throw new StudioError('发布状态无效。')
  const template = await getTemplate(db, shop, row.template_id)
  if (status === 'published' && (!template?.enabled || !template?.calibrated)) throw new StudioError('请先在 Setting 校准并启用该模板，才能发布。', 409)
  const now = new Date().toISOString()
  const result = await db.prepare('UPDATE studio_customizers SET name=?,status=?,updated_at=? WHERE shop_id=? AND id=? AND updated_at=?').bind(name,status,now,shop,id,row.updated_at).run()
  if (!result.meta?.changes) throw new StudioError('定制器已被其他窗口更新，请刷新。', 409)
  return { customizer: publicRow({ ...row, name, status, updated_at: now }) }
})

export const onRequestDelete = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const id = customizerId(new URL(request.url).searchParams.get('id'))
  const row = await db.prepare('SELECT status FROM studio_customizers WHERE shop_id=? AND id=?').bind(shop,id).first()
  if (!row) throw new StudioError('定制器不存在。',404)
  if (row.status !== 'draft') throw new StudioError('先下架，再删除定制器。',409)
  await db.prepare('DELETE FROM studio_customizers WHERE shop_id=? AND id=?').bind(shop,id).run()
  return { deleted:true }
})
