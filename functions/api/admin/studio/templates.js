import { normalizeTemplate } from '../../../../src/studio/model.js'
import { route,onStudioOptions,studioShop,studioDb,studioAdmin,readBody,getTemplates,validated,StudioError } from '../../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestGet=route(async ({request,env}) => {
  const db=await studioDb(env),shop=await studioAdmin(request,env,db)
  return {templates:await getTemplates(db,shop)}
})
export const onRequestPost=route(async ({request,env}) => {
  const db=await studioDb(env),shop=await studioAdmin(request,env,db)
  const body=await readBody(request,50000), template=validated(() => normalizeTemplate(body.template))
  const expected=Number(body.revision)
  if (!Number.isInteger(expected) || expected<1) throw new StudioError('模板版本无效。')
  const now=new Date().toISOString()
  // First persisted seed is revision 2. Concurrent edits use compare-and-swap.
  const existing=await db.prepare('SELECT revision FROM studio_templates WHERE shop_id=? AND id=?').bind(shop,template.id).first()
  if ((existing?.revision || 1)!==expected) throw new StudioError('模板已被更新，请刷新后重试。',409)
  let result
  if (!existing) result=await db.prepare('INSERT OR IGNORE INTO studio_templates(shop_id,id,revision,body,updated_at) VALUES (?,?,?,?,?)').bind(shop,template.id,expected+1,JSON.stringify(template),now).run()
  else result=await db.prepare('UPDATE studio_templates SET revision=revision+1,body=?,updated_at=? WHERE shop_id=? AND id=? AND revision=?').bind(JSON.stringify(template),now,shop,template.id,expected).run()
  if (!result.meta?.changes) throw new StudioError('模板已被更新，请刷新后重试。',409)
  return {template:{...template,version:expected+1}}
})
