import { installShop } from '../../_shopify_install.js'

export async function onRequestPost({ request, env }) {
  try {
    const shop = await installShop(request, env)
    return Response.json({ shop, installed: true, clientId: env.SHOPIFY_CLIENT_ID }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error('[shopify-install]', error.message)
    const unauthorized = error.message === 'Invalid Shopify session token'
    return Response.json({ error: unauthorized ? '无法验证 Shopify 身份，请从商家后台重新打开应用。' : '商店连接暂不可用，请稍后重试。' }, { status: unauthorized ? 401 : 503, headers: { 'cache-control': 'no-store' } })
  }
}
