import { route,onStudioOptions,studioShop,studioDb,getTemplates } from '../_studio.js'
export const onRequestOptions=onStudioOptions
export const onRequestGet=route(async ({request,env}) => {
  const shop=studioShop(env,request),db=await studioDb(env)
  return {templates:await getTemplates(db,shop),shop}
})
