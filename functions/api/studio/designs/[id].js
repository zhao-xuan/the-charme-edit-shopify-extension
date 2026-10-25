import { normalizeDesign,validateDesign } from '../../../../src/studio/model.js'
import { route,onStudioOptions,studioShop,studioDb,readBody,getTemplate,getDesign,designAccess,publicDesign,validated,StudioError,limitWrites } from '../../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestGet=route(async ({request,env,params}) => {
  const db=await studioDb(env),shop=await studioShop(env,request,db),row=await getDesign(db,shop,params.id)
  await designAccess(request,env,row);return publicDesign(row)
})
export const onRequestPatch=route(async ({request,env,params}) => {
  const db=await studioDb(env),shop=await studioShop(env,request,db),row=await getDesign(db,shop,params.id)
  await designAccess(request,env,row)
  const body=await readBody(request)
  if (row.state==='submitted' && body.action==='submit' && body.revision===row.revision-1) return publicDesign(row)
  if (row.state!=='draft') throw new StudioError('已提交设计已冻结；请复制为新设计。',409)
  if (body.revision!==row.revision) throw new StudioError('设计已在其他窗口更新，请重新载入。',409)
  await limitWrites(db,request,shop)
  const {template}=JSON.parse(row.body), document=validated(() => normalizeDesign(body.document,template))
  let state='draft'
  if (body.action==='submit') {
    const current=await getTemplate(db,shop,template.id)
    if (!current.enabled || !current.calibrated) throw new StudioError('此品类仍为示例；商家确认实物尺寸后才能提交制作申请。',409)
    if (current.version!==template.version) throw new StudioError('模板已更新，请使用新模板复制设计并重新检查。',409)
    const validation=validateDesign(document,template)
    if (!validation.valid) throw new StudioError(validation.errors.join(' '),422)
    state='submitted'
  } else if (body.action && body.action!=='save') throw new StudioError('操作无效。')
  const payload=JSON.stringify({document,template}),now=new Date().toISOString()
  const updated=await db.prepare('UPDATE studio_designs SET body=?,revision=revision+1,state=?,updated_at=? WHERE shop_id=? AND id=? AND revision=? AND state=\'draft\'').bind(payload,state,now,shop,row.id,row.revision).run()
  if (!updated.meta?.changes) throw new StudioError('设计已更新，请重新载入。',409)
  return publicDesign({...row,body:payload,state,revision:row.revision+1,updated_at:now})
})
