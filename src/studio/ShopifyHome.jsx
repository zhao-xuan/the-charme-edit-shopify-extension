import { lazy, Suspense, useEffect, useState } from 'react'
import { adminAuthHeaders, isShopifyEmbedded } from '../lib/adminApi.js'
import { studioApi } from './api.js'
import { PRODUCT_TEMPLATES, WORKFLOWS, interactionFor } from './templates.js'
import StudioAdmin from './StudioAdmin.jsx'
import './studio.css'
const AnalyticsTab = lazy(() => import('../components/AnalyticsTab.jsx'))

const TABS = [['new','New Customizer'],['mine','My Customizer'],['settings','Setting'],['subscription','Subscription'],['analytics','Analytics']]
const initialTab = () => { const tab = new URLSearchParams(location.search).get('view'); return TABS.some(([id]) => id === tab) ? tab : 'new' }
const customerUrl = (shop,id) => `${location.origin}/studio/?shop=${encodeURIComponent(shop)}&customizer=${encodeURIComponent(id)}`

function Subscription({ data, loading, error, reload }) {
  const current = data?.subscription
  return <section className="studio-app-section"><span className="studio-eyebrow">SHOPIFY APP PRICING</span><h1>Subscription</h1><p>计划、价格和试用期由 Shopify 管理。</p>
    {loading ? <p>正在读取订阅…</p> : error ? <p role="alert" className="studio-notice">{error}</p> : !data?.configured ? <div className="studio-notice">尚未连接 Partner API，当前订阅状态不可验证。此时不会误判商家为未付费。</div> : current ? <div className="studio-panel"><h2>当前订阅</h2><p>结算周期：{current.billingPeriod === 'ANNUAL' ? '每年' : '每 30 天'}</p>{current.items?.map((item) => <p key={item.handle}>{item.description || item.handle} · {item.price?.amount != null ? `${item.price.currency} ${item.price.amount}` : '用量计价'}</p>)}{current.trialEndsAt && <p>试用期结束：{new Date(current.trialEndsAt).toLocaleDateString()}</p>}{current.currentBillingCycle?.endTime && <p>本周期结束：{new Date(current.currentBillingCycle.endTime).toLocaleDateString()}</p>}{current.cancelAtEndOfCycle && <p>已计划在本周期结束时取消。</p>}</div> : <div className="studio-notice">Shopify 当前未返回有效订阅；若刚选计划，请稍后刷新。</div>}
    <div className="studio-card-actions">{data?.pricingUrl && <a className="studio-link-button" href={data.pricingUrl} target="_top">查看或更改 Shopify 计划 ↗</a>}<button onClick={reload}>刷新状态</button></div>{!data?.pricingUrl && <p className="studio-muted">发布计划后设置 SHOPIFY_APP_HANDLE，才会显示 Shopify 托管的计划入口。</p>}
  </section>
}

export default function ShopifyHome() {
  const [state,setState] = useState({ loading:true }), [tab,setTab] = useState(initialTab)
  const [templates,setTemplates] = useState(PRODUCT_TEMPLATES), [rows,setRows] = useState([])
  const [chosen,setChosen] = useState(PRODUCT_TEMPLATES[0].id), [name,setName] = useState(''), [draft,setDraft] = useState(null)
  const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false)
  const [subscription,setSubscription] = useState(null), [subscriptionLoading,setSubscriptionLoading] = useState(false), [subscriptionError,setSubscriptionError] = useState('')
  useEffect(() => {
    let live = true
    async function connect() {
      if (!isShopifyEmbedded()) throw new Error('请从 Shopify 商家后台的应用页面打开。')
      const response = await fetch('/api/shopify-app/session',{method:'POST',headers:await adminAuthHeaders(),cache:'no-store'})
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '无法连接 Shopify 商店。')
      return body
    }
    connect().then((result) => { if (live) { const url = new URL(location.href); url.searchParams.set('shop',result.shop); history.replaceState({},'',url); setState({loading:false,shop:result.shop,clientId:result.clientId}) } }).catch((error) => { if (live) setState({loading:false,error:error.message}) })
    return () => { live = false }
  },[])
  async function reload() {
    const [saved,catalog] = await Promise.all([studioApi.customizers(),studioApi.adminTemplates()])
    setRows(saved.customizers);setTemplates(catalog.templates)
  }
  useEffect(() => { if (state.shop) { reload().catch((error) => setNotice(error.message)); if (tab === 'subscription') loadSubscription() } },[state.shop])
  async function loadSubscription() {
    setSubscriptionLoading(true);setSubscriptionError('')
    try {setSubscription(await studioApi.subscription())} catch (error) {setSubscriptionError(error.message)} finally {setSubscriptionLoading(false)}
  }
  function selectTab(next) {
    setTab(next);setNotice('')
    const url = new URL(location.href);url.searchParams.set('view',next);history.replaceState({},'',url)
    if (next === 'mine') reload().catch((error) => setNotice(error.message))
    if (next === 'subscription') loadSubscription()
  }
  async function create() {
    setBusy(true);setNotice('')
    try {const result = await studioApi.createCustomizer({id:crypto.randomUUID(),templateId:chosen,name:name.trim() || templates.find((t) => t.id === chosen)?.name});setDraft(result.customizer);await reload();setNotice('草稿已创建。请在 Studio 预览，然后校准模板并发布。')}
    catch (error) {setNotice(error.message)} finally {setBusy(false)}
  }
  async function update(row,patch) {
    setBusy(true);setNotice('')
    try {const result = await studioApi.updateCustomizer({id:row.id,...patch});if (draft?.id === row.id) setDraft(result.customizer);await reload();setNotice(patch.status === 'published' ? '定制器已发布；请在商品页配置 App Block。' : patch.status === 'draft' ? '定制器已下架。' : '名称已更新。')}
    catch (error) {setNotice(error.message)} finally {setBusy(false)}
  }
  async function remove(row) {
    if (row.status !== 'draft' || !confirm('永久删除此定制器？已保存的设计不会自动删除。')) return
    setBusy(true);setNotice('')
    try {await studioApi.deleteCustomizer(row.id);await reload();setNotice('定制器已删除。')} catch (error) {setNotice(error.message)} finally {setBusy(false)}
  }
  if (state.loading) return <main className="studio-shell studio-gallery"><h1>正在连接 Shopify 商店…</h1></main>
  if (state.error) return <main className="studio-shell studio-gallery"><h1>无法打开商家工作室</h1><p role="alert">{state.error}</p></main>
  const preview = (templateId) => `/studio/?shop=${encodeURIComponent(state.shop)}&template=${encodeURIComponent(templateId)}`
  const themeEditor = `https://${state.shop}/admin/themes/current/editor?template=product&addAppBlockId=${encodeURIComponent(state.clientId || '')}/charme-customizer&target=mainSection`
  return <main className="studio-shell studio-app-home">
    <header className="studio-header"><span className="studio-brand">CHARMÉ <span>PRODUCT STUDIO</span></span><span>{state.shop}</span></header>
    <nav className="studio-app-tabs" aria-label="Shopify app navigation">{TABS.map(([id,label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => selectTab(id)}>{label}</button>)}</nav>
    {notice && <div className="studio-notice" role="status">{notice}</div>}
    {tab === 'new' && <section className="studio-app-section"><span className="studio-eyebrow">CREATE</span><h1>New Customizer</h1><p>五种编辑方式覆盖多个品类。先创建草稿，在 /studio 预览顾客体验，再发布。</p><div className="studio-panel studio-create-form"><label className="studio-field"><span>交互方式与商品模板</span><select value={chosen} onChange={(event) => {setChosen(event.target.value);setDraft(null)}}>{WORKFLOWS.map((workflow) => <optgroup key={workflow.id} label={workflow.name}>{templates.filter((t) => interactionFor(t) === workflow.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}</select></label><label className="studio-field"><span>定制器名称</span><input value={name} maxLength={80} placeholder={templates.find((t) => t.id === chosen)?.name} onChange={(event) => setName(event.target.value)}/></label><div className="studio-card-actions"><button className="studio-primary" disabled={busy} onClick={create}>创建草稿</button><a className="studio-link-button" href={preview(chosen)} target="_blank" rel="noreferrer">打开 /studio 预览 ↗</a></div></div>{draft && <div className="studio-panel"><h2>{draft.name} · {draft.status === 'published' ? '已发布' : '草稿'}</h2><p>Customizer ID：{draft.id}</p><div className="studio-card-actions"><a className="studio-link-button" href={preview(draft.templateId)} target="_blank" rel="noreferrer">编辑预览 ↗</a><button disabled={busy || draft.status === 'published'} onClick={() => update(draft,{status:'published'})}>发布</button><button onClick={() => selectTab('settings')}>核对模板和 App Block</button></div>{draft.status === 'published' && <p>顾客链接：<a href={customerUrl(state.shop,draft.id)} target="_blank" rel="noreferrer">{customerUrl(state.shop,draft.id)}</a></p>}</div>}</section>}
    {tab === 'mine' && <section className="studio-app-section"><div className="studio-editor-head"><div><span className="studio-eyebrow">YOUR WORK</span><h1>My Customizer</h1><p>管理草稿和已发布的定制器。</p></div><button disabled={busy} onClick={() => reload().catch((error) => setNotice(error.message))}>刷新</button></div>{!rows.length ? <div className="studio-panel studio-empty">还没有定制器。先在 New Customizer 创建一个。</div> : <div className="studio-customizer-grid">{rows.map((row) => <article className="studio-panel" key={row.id}><span className="studio-eyebrow">{WORKFLOWS.find((w) => w.id === interactionFor(PRODUCT_TEMPLATES.find((t) => t.id === row.templateId)))?.name || '定制'}</span><h2>{row.name}</h2><p>{PRODUCT_TEMPLATES.find((t) => t.id === row.templateId)?.name || row.templateId} · {row.status === 'published' ? '已发布' : '草稿'}</p>{row.status === 'published' && !templates.find((t) => t.id === row.templateId)?.enabled && <p className="studio-notice">模板已停用，顾客暂不能使用。</p>}<small>更新于 {new Date(row.updatedAt).toLocaleString()}</small><div className="studio-card-actions"><a className="studio-link-button" href={preview(row.templateId)} target="_blank" rel="noreferrer">Studio 预览 ↗</a><button disabled={busy} onClick={() => {const value=prompt('定制器名称',row.name);if(value && value.trim() !== row.name) update(row,{name:value.trim()})}}>重命名</button><button disabled={busy} onClick={() => update(row,{status:row.status === 'published' ? 'draft' : 'published'})}>{row.status === 'published' ? '下架' : '发布'}</button>{row.status === 'draft' && <button disabled={busy} onClick={() => remove(row)}>删除</button>}</div>{row.status === 'published' && <label className="studio-field"><span>顾客链接 / App Block Customizer ID</span><input readOnly value={customerUrl(state.shop,row.id)} onFocus={(event) => event.target.select()}/><small>{row.id}</small></label>}</article>)}</div>}</section>}
    {tab === 'settings' && <section className="studio-app-section"><span className="studio-eyebrow">CONFIGURE</span><h1>Setting</h1><div className="studio-panel"><h2>Shopify 商品页 App Block</h2><p>进入当前主题的商品模板，预览 Product Studio 区块，填入已发布的 Customizer ID，然后在 Shopify 主题编辑器点击“保存”。是否启用区块由商家在主题编辑器控制。</p><a className="studio-link-button" href={themeEditor} target="_blank" rel="noreferrer">在主题编辑器添加 App Block ↗</a><p className="studio-muted">若商品主区块不支持 App Block，请在主题的 Apps 区域添加，或使用兼容的 Online Store 2.0 主题。</p></div><StudioAdmin /></section>}
    {tab === 'subscription' && <Subscription data={subscription} loading={subscriptionLoading} error={subscriptionError} reload={loadSubscription} />}
    {tab === 'analytics' && <section className="studio-app-section"><Suspense fallback={<p>正在加载统计…</p>}><AnalyticsTab fetchReport={studioApi.analytics} studio /></Suspense></section>}
    <footer className="studio-footer"><span>CHARMÉ / PRODUCT STUDIO</span><span><a href="/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a> · <a href="/terms/" target="_blank" rel="noreferrer">Terms of Service</a></span></footer>
  </main>
}
