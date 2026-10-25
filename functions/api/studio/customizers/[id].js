import { route, onStudioOptions, studioDb, studioShop, publishedCustomizer, getTemplate, StudioError } from '../../_studio.js'

export const onRequestOptions = onStudioOptions
export const onRequestGet = route(async ({ request, env, params }) => {
  const db = await studioDb(env), shop = await studioShop(env, request, db)
  const customizer = await publishedCustomizer(db, shop, params.id)
  const template = await getTemplate(db, shop, customizer.templateId)
  if (!template?.enabled || !template?.calibrated) throw new StudioError('商家暂时停用了这个定制器。',409)
  return { customizer, template }
})
