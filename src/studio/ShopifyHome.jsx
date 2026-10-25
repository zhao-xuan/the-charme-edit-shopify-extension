import { useEffect, useState } from 'react'
import { adminAuthHeaders, isShopifyEmbedded } from '../lib/adminApi.js'
import StudioAdmin from './StudioAdmin.jsx'
import './studio.css'

export default function ShopifyHome() {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let live = true
    async function connect() {
      if (!isShopifyEmbedded()) throw new Error('请从 Shopify 商家后台的应用页面打开。')
      const response = await fetch('/api/shopify-app/session', { method: 'POST', headers: await adminAuthHeaders(), cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '无法连接 Shopify 商店。')
      return body
    }
    connect().then((result) => { if (live) setState({ loading: false, shop: result.shop }) })
      .catch((error) => { if (live) setState({ loading: false, error: error.message }) })
    return () => { live = false }
  }, [])
  if (state.loading) return <main className="studio-shell studio-gallery"><h1>正在连接 Shopify 商店…</h1></main>
  if (state.error) return <main className="studio-shell studio-gallery"><h1>无法打开商家工作室</h1><p role="alert">{state.error}</p></main>
  const studioUrl = `/studio/?shop=${encodeURIComponent(state.shop)}`
  return <main className="studio-shell">
    <header className="studio-header"><a className="studio-brand" href={studioUrl}>CHARMÉ <span>PRODUCT STUDIO</span></a><span>{state.shop}</span></header>
    <section className="studio-gallery"><div className="studio-hero"><div><span className="studio-eyebrow">SHOPIFY SETUP</span><h1>配置你的商品定制</h1><p>相近品类共用五种编辑方式。按下面的顺序启用，再让顾客下单。</p><ol><li>在下方选模板，核对实物尺寸、材料、安全区域并启用。</li><li>在 Shopify 主题编辑器的商品页添加 Product Studio App Block，可填入模板 ID。</li><li>用顾客工作室提交测试设计；在制作申请中确认工艺并绑定包含全部费用的商品变体。</li><li>测试报价、原生购物车和实际订单，再向顾客开放。</li></ol><a className="studio-link-button" href={studioUrl} target="_blank" rel="noreferrer">预览顾客工作室 ↗</a></div></div></section>
    <StudioAdmin />
  </main>
}
