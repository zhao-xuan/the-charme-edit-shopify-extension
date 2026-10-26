import { getShopifyToken } from '../../_lib.js'
import { installedShopToken } from '../../_shopify_install.js'
import { route, onStudioOptions, studioDb, studioAdmin, StudioError } from '../../_studio.js'

export const onRequestOptions = onStudioOptions
export const onRequestGet = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const appHandle = String(env.SHOPIFY_APP_HANDLE || '')
  const pricingUrl = /^[a-z0-9][a-z0-9-]*$/.test(appHandle)
    ? `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, '')}/charges/${appHandle}/pricing_plans` : null
  if (!env.SHOPIFY_PARTNER_ORG_ID || !env.SHOPIFY_PARTNER_API_ACCESS_TOKEN || !env.SHOPIFY_APP_GID) return { configured: false, pricingUrl, subscription: null }
  if (!/^\d+$/.test(env.SHOPIFY_PARTNER_ORG_ID) || !/^gid:\/\/shopify\/App\/\d+$/.test(env.SHOPIFY_APP_GID)) throw new StudioError('Partner API 配置无效。', 503)
  const token = shop === env.SHOPIFY_STORE ? await getShopifyToken(env) : await installedShopToken(db, shop, env)
  const shopResponse = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query: '{ shop { id } }' }), signal: AbortSignal.timeout(10000),
  })
  const shopBody = await shopResponse.json().catch(() => null)
  const shopId = shopBody?.data?.shop?.id
  if (!shopResponse.ok || shopBody?.errors || !shopId) throw new StudioError('无法核对 Shopify 商店身份。', 502)
  const response = await fetch(`https://partners.shopify.com/${env.SHOPIFY_PARTNER_ORG_ID}/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': env.SHOPIFY_PARTNER_API_ACCESS_TOKEN },
    body: JSON.stringify({
      query: 'query ActiveSubscription($appId: ID!, $shopId: ID!) { activeSubscription(appId: $appId, shopId: $shopId) { billingPeriod cancelAtEndOfCycle trialEndsAt currentBillingCycle { endTime } items { handle description price { __typename currency ... on FlatRatePrice { amount } } } } }',
      variables: { appId: env.SHOPIFY_APP_GID, shopId },
    }), signal: AbortSignal.timeout(10000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.errors || !body?.data) throw new StudioError('暂时无法读取 Shopify 订阅状态；不会据此取消商家访问。', 502)
  return { configured: true, pricingUrl, subscription: body.data.activeSubscription }
})
