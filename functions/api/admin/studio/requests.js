import { route,onStudioOptions,studioShop,studioDb,studioAdmin,readBody,getDesign,publicDesign,StudioError } from '../../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestGet=route(async ({request,env}) => {
  await studioAdmin(request,env)
  const db=await studioDb(env),shop=studioShop(env,request)
  const before=new URL(request.url).searchParams.get('before') || '9999'
  const {results}=await db.prepare("SELECT id,revision,state,updated_at,json_extract(body,'$.document.name') AS name,json_extract(body,'$.template.name') AS templateName,json_extract(body,'$.template.process') AS process FROM studio_designs WHERE shop_id=? AND state!='draft' AND (updated_at || ':' || id)<? ORDER BY updated_at DESC,id DESC LIMIT 31").bind(shop,before).all()
  const rows=results.slice(0,30),last=rows.at(-1)
  return {requests:rows,next:results.length>30 ? `${last.updated_at}:${last.id}` : null}
})
export const onRequestPost=route(async ({request,env}) => {
  await studioAdmin(request,env)
  const body=await readBody(request,10000),db=await studioDb(env),shop=studioShop(env,request),row=await getDesign(db,shop,body.id)
  if (row.state==='draft' || !['reviewed','declined'].includes(body.state)) throw new StudioError('只能审核已提交的制作申请。',409)
  if (body.revision!==row.revision) throw new StudioError('申请已更新，请重新打开。',409)
  if (body.state==='reviewed' && body.productionConfirmed!==true) throw new StudioError('请确认物料、工艺、待接入项目和最终制作能力。')
  const variantId=String(body.variantId || '')
  if (variantId && !/^\d{8,20}$/.test(variantId)) throw new StudioError('请输入最终整件商品的 Shopify variant ID。')
  const notes=String(body.notes || '').trim().slice(0,2000)
  if (!notes) throw new StudioError('请填写审核说明。')
  const review={notes,variantId:body.state==='reviewed'?variantId:'',productionConfirmed:body.state==='reviewed',at:new Date().toISOString()}
  const updated=await db.prepare('UPDATE studio_designs SET state=?,review=?,revision=revision+1,updated_at=? WHERE shop_id=? AND id=? AND revision=?').bind(body.state,JSON.stringify(review),review.at,shop,row.id,row.revision).run()
  if (!updated.meta?.changes) throw new StudioError('申请已更新，请重新打开。',409)
  return publicDesign({...row,state:body.state,review:JSON.stringify(review),revision:row.revision+1,updated_at:review.at})
})
