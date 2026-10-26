import { getShopifyToken } from '../../_lib.js'
import { installedShopToken } from '../../_shopify_install.js'
import { route, onStudioOptions, studioDb, studioAdmin, StudioError } from '../../_studio.js'

export const onRequestOptions = onStudioOptions
export const onRequestGet = route(async ({ request, env }) => {
  const db = await studioDb(env), shop = await studioAdmin(request, env, db)
  const q = (new URL(request.url).searchParams.get('q') || '').trim()
  if (q.length > 100) throw new StudioError('搜索内容过长。')
  const token = shop === env.SHOPIFY_STORE ? await getShopifyToken(env) : await installedShopToken(db, shop, env)
  const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query: `query StudioVariants($q: String) { productVariants(first: 20, query: $q) { nodes { legacyResourceId displayName price availableForSale product { status } } } }`, variables: { q: q || null } }),
    signal: AbortSignal.timeout(10000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.errors || !result?.data?.productVariants) throw new StudioError('暂时无法读取商品变体。', 502)
  return { variants: result.data.productVariants.nodes.filter((variant) => variant.product.status === 'ACTIVE').map((variant) => ({ id: String(variant.legacyResourceId), name: variant.displayName, price: variant.price, available: variant.availableForSale })) }
})
