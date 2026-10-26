import StudioAdmin from './StudioAdmin.jsx'
import './studio.css'

export default function StudioMerchantPage() {
  const params = new URLSearchParams(location.search)
  const back = new URLSearchParams()
  for (const key of ['shop','host','embedded']) if (params.has(key)) back.set(key,params.get(key))
  back.set('view','settings')
  return <main className="studio-shell studio-app-home"><header className="studio-header"><span className="studio-brand">CHARMÉ <span>PRODUCT STUDIO</span></span><a href={`/shopify-app/?${back}`}>← 返回 Shopify App</a></header><section className="studio-app-section"><span className="studio-eyebrow">MERCHANT STUDIO</span><h1>商品品类设置</h1><p>选择下方的商品品类，在 Category / Order 中调整顾客看到的分类和选项顺序。</p><StudioAdmin/></section></main>
}
