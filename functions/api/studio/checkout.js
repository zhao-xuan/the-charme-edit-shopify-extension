import { getShopifyToken } from '../_lib.js'
import { route,onStudioOptions,studioShop,studioDb,readBody,getDesign,designAccess,StudioError } from '../_studio.js'

export const STUDIO_QUOTE_QUERY = `query StudioQuote($id: ID!, $country: CountryCode!) {
  productVariant(id: $id) {
    id title
    contextualPricing(context: {country: $country}) { price { amount currencyCode } }
    product { title }
  }
}`
export const onRequestOptions=onStudioOptions
export const onRequestPost=route(async ({request,env}) => {
  const body=await readBody(request,5000),shop=studioShop(env,request),row=await getDesign(await studioDb(env),shop,body.id)
  await designAccess(request,env,row)
  const review=JSON.parse(row.review)
  if (row.state!=='reviewed' || !review.productionConfirmed || !/^\d{8,20}$/.test(review.variantId || '')) throw new StudioError('商家尚未确认制作或绑定最终整件商品。',409)
  if (body.revision!==row.revision) throw new StudioError('审核已更新，请刷新设计。',409)
  if (shop==='local-development') throw new StudioError('本地演示不创建真实购物车。',409)
  const country=String(body.country || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new StudioError('请选择收货国家 / 市场。')
  const response=await fetch(`https://${shop}/admin/api/2026-07/graphql.json`,{
    method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':await getShopifyToken(env)},
    body:JSON.stringify({query:STUDIO_QUOTE_QUERY,variables:{id:`gid://shopify/ProductVariant/${review.variantId}`,country}}),
    signal:AbortSignal.timeout(10000),
  })
  const result=await response.json()
  if (!response.ok || result.errors) throw new StudioError('Shopify 报价暂不可用，请稍后重试。',502)
  const variant=result.data?.productVariant,price=variant?.contextualPricing?.price
  if (!price || !Number.isFinite(Number(price.amount)) || Number(price.amount)<0) throw new StudioError('最终商品已失效或暂无法报价。',409)
  const {template,document}=JSON.parse(row.body)
  return {amount:price.amount,currency:price.currencyCode,country,storeUrl:`https://${shop}`,title:variant.product.title,
    expiresAt:new Date(Date.now()+60000).toISOString(),
    items:[{id:review.variantId,quantity:1,properties:{'Design ID':row.id,'Design':document.name,'Template':`${template.id} v${template.version}`,'Process':template.process,'Review':'Merchant approved','_studio_revision':String(row.revision)}}]}
})
