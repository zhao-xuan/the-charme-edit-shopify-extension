import { route,onStudioOptions,studioShop,studioDb,getTemplates } from '../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestGet=route(async ({request,env}) => {
  const db=await studioDb(env),shop=await studioShop(env,request,db)
  return {templates:await getTemplates(db,shop),shop}
})
