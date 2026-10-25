import { normalizeDesign } from '../../../src/studio/model.js'
import { route,onStudioOptions,studioShop,studioDb,readBody,getTemplate,designId,digest,limitWrites,designAccess,publicDesign,validated,StudioError } from '../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestPost=route(async ({request,env}) => {
  const body=await readBody(request), id=designId(body.id),shop=studioShop(env,request),db=await studioDb(env)
  const auth=request.headers.get('authorization') || '', secret=auth.startsWith('Design ') ? auth.slice(7) : ''
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new StudioError('保存凭据无效。',401)
  const existing=await db.prepare('SELECT * FROM studio_designs WHERE shop_id=? AND id=?').bind(shop,id).first()
  if (existing) { await designAccess(request,env,existing); return publicDesign(existing) }
  await limitWrites(db,request,shop)
  const template=await getTemplate(db,shop,body.document?.templateId)
  if (!template) throw new StudioError('品类不存在。',404)
  const document=validated(() => normalizeDesign(body.document,template)),now=new Date().toISOString()
  const row={shop_id:shop,id,secret_hash:await digest(secret),revision:1,state:'draft',body:JSON.stringify({document,template}),review:'{}',created_at:now,updated_at:now}
  const inserted=await db.prepare('INSERT OR IGNORE INTO studio_designs(shop_id,id,secret_hash,revision,state,body,review,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(...[row.shop_id,row.id,row.secret_hash,1,'draft',row.body,'{}',now,now]).run()
  if (!inserted.meta?.changes) {
    const concurrent=await db.prepare('SELECT * FROM studio_designs WHERE shop_id=? AND id=?').bind(shop,id).first()
    await designAccess(request,env,concurrent);return publicDesign(concurrent)
  }
  return publicDesign(row)
})
