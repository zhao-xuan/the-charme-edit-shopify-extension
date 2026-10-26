import { useEffect,useState } from 'react'
import { PRODUCT_TEMPLATES,PROCESSES } from './templates.js'
import { normalizeTemplate,productionPack,validateDesign } from './model.js'
import { studioApi,downloadFile } from './api.js'
import StudioCanvas from './StudioCanvas.jsx'
import CatalogLayoutEditor from './CatalogLayoutEditor.jsx'
import { NumberField } from './StudioPage.jsx'
import './studio.css'

export default function StudioAdmin() {
  const initialTemplate=PRODUCT_TEMPLATES.find((item) => item.id === new URLSearchParams(location.search).get('template')) || PRODUCT_TEMPLATES[0]
  const [templates,setTemplates]=useState(PRODUCT_TEMPLATES),[selected,setSelected]=useState(initialTemplate),[mode,setMode]=useState('templates')
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[rows,setRows]=useState([]),[next,setNext]=useState(null),[request,setRequest]=useState(null)
  const [notes,setNotes]=useState(''),[variantId,setVariantId]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [variantSearch,setVariantSearch]=useState(''),[variants,setVariants]=useState([])
  const [templateTab,setTemplateTab]=useState(new URLSearchParams(location.search).get('manage') === '1' ? 'catalog' : 'details')
  const loadTemplates=async () => {
    setBusy(true);try{const result=await studioApi.adminTemplates();setTemplates(result.templates);setSelected((current) => result.templates.find((t) => t.id===current.id)||result.templates[0]);setNotice('')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const loadRequests=async (cursor) => {
    setBusy(true);try{const result=await studioApi.requests(cursor);setRows((existing) => cursor?[...existing,...result.requests]:result.requests);setNext(result.next);setNotice('')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  useEffect(() => {loadTemplates()},[])
  const set=(patch) => setSelected({...selected,...patch})
  const editSurface=(id,fn) => set({surfaces:selected.surfaces.map((s) => s.id===id?fn(s):s)})
  const resize=(s,key,value) => {
    if(value<20||value>1500)return s
    const factor=value/s[key],x=key==='widthMm'?'x':'y',size=key==='widthMm'?'width':'height'
    return {...s,[key]:value,zone:{...s.zone,[x]:s.zone[x]*factor,[size]:s.zone[size]*factor},keepouts:s.keepouts.map((r) => ({...r,[x]:r[x]*factor,[size]:r[size]*factor}))}
  }
  const persist=async () => {
    setBusy(true);try{normalizeTemplate(selected);const {template}=await studioApi.saveTemplate(selected);setSelected(template);setTemplates(templates.map((t) => t.id===template.id?template:t));setNotice(`模板已保存为 v${template.version}。已有设计保留原快照。`)}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const openRequest=async (id) => {
    setBusy(true);try{const row=await studioApi.load(id,null,true);setRequest(row);setNotes(row.review?.notes||'');setVariantId(row.review?.variantId||'');setVariants([]);setConfirmed(false);setNotice('')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const review=async (state) => {
    setBusy(true);try{const row=await studioApi.review({id:request.id,revision:request.revision,state,notes,variantId,productionConfirmed:confirmed});setRequest(row);setRows(rows.map((r) => r.id===row.id?{...r,state:row.state,revision:row.revision}:r));setNotice('审核结果已保存，客户可通过私密链接查看。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const removeRequest=async () => {
    if(!request||!confirm('永久删除此制作申请和设计资料？请先确认没有未完成的订单。'))return
    setBusy(true)
    try{await studioApi.deleteDesign(request.id,null,true);setRequest(null);await loadRequests();setNotice('设计资料已删除，原私密链接失效。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const findVariants=async () => {
    setBusy(true);try{const result=await studioApi.variants(variantSearch);setVariants(result.variants);setNotice(result.variants.length?'':'未找到可销售的商品变体。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const shop=new URLSearchParams(location.search).get('shop')
  return <div className="studio-admin">
    <div className="studio-editor-head"><div><span className="studio-eyebrow">PRODUCT PLATFORM</span><h2>多品类工作室</h2><p>标定模板、开放制作申请、审核全部设计面。</p></div><a className="studio-link-button" href={`/studio/${shop?`?shop=${encodeURIComponent(shop)}`:''}`} target="_blank" rel="noreferrer">打开顾客工作室 ↗</a></div>
    <div className="studio-filters"><button className={mode==='templates'?'active':''} onClick={() => setMode('templates')}>商品模板 · {templates.length}</button><button className={mode==='requests'?'active':''} onClick={() => {setMode('requests');loadRequests()}}>制作申请</button><button disabled={busy} onClick={() => mode==='templates'?loadTemplates():loadRequests()}>刷新</button></div>
    {notice&&<div className="studio-notice" role="status">{notice}</div>}
    {mode==='templates'?<div className="studio-admin-layout"><aside className="studio-template-menu">{templates.map((t) => <button disabled={busy} key={t.id} className={selected.id===t.id?'active':''} onClick={() => {setSelected(structuredClone(t));setTemplateTab('details');setNotice('')}}><strong>{t.name}</strong><span>{PROCESSES[t.process].name} · v{t.version} · {t.enabled?'已启用':'示例'}</span></button>)}</aside>
      <section className="studio-panel"><h2>{selected.name}</h2><div className="studio-filters studio-template-tabs" role="tablist" aria-label={`${selected.name} 配置`}><button type="button" role="tab" aria-selected={templateTab==='details'} className={templateTab==='details'?'active':''} onClick={() => setTemplateTab('details')}>模板设置</button><button type="button" role="tab" aria-selected={templateTab==='catalog'} className={templateTab==='catalog'?'active':''} onClick={() => setTemplateTab('catalog')}>Category / Order</button></div>{templateTab==='details'?<><p className="studio-muted">模板尺寸为起始示例，请以实物测量校准。保存会生成新版本；旧设计与制作资料不随之变更。</p>
        <div className="studio-two-cols"><label className="studio-field"><span>名称</span><input value={selected.name} onChange={(e) => set({name:e.target.value})}/></label><label className="studio-field"><span>材料</span><input value={selected.material} onChange={(e) => set({material:e.target.value})}/></label><NumberField label="最多元素数" value={selected.maxElements} min={1} max={120} onChange={(maxElements) => set({maxElements})}/><NumberField label="最小细节 · mm" value={selected.minFeatureMm} min={.2} max={20} step={.1} onChange={(minFeatureMm) => set({minFeatureMm})}/>{['print','wrap','embroidery'].includes(selected.process)&&<NumberField label="最低图片 DPI" value={selected.minDpi} min={72} max={600} onChange={(minDpi) => set({minDpi})}/>}<NumberField label="文字字数上限" value={selected.maxTextLength} min={1} max={120} onChange={(maxTextLength) => set({maxTextLength})}/></div>
        {selected.process==='beads'&&<div className="studio-two-cols"><NumberField label="成品长度 · mm" value={selected.circumferenceMm} min={80} max={1000} onChange={(circumferenceMm) => set({circumferenceMm})}/><NumberField label="扣件预留 · mm" value={selected.claspMm} min={0} max={100} onChange={(claspMm) => set({claspMm})}/></div>}
        <label className="studio-field"><span>制作说明 / 温度 / 工艺要求</span><textarea value={selected.productionNotes} maxLength={1000} onChange={(e) => set({productionNotes:e.target.value})}/></label>
        {selected.surfaces.map((s) => <details className="studio-surface-config" key={s.id} open><summary>{s.name}</summary><div className="studio-two-cols"><NumberField label="面宽 · mm" value={s.widthMm} min={20} max={1500} onChange={(v) => editSurface(s.id,(old) => resize(old,'widthMm',v))}/><NumberField label="面高 · mm" value={s.heightMm} min={20} max={1500} onChange={(v) => editSurface(s.id,(old) => resize(old,'heightMm',v))}/></div><h4>安全区域</h4><div className="studio-four-cols">{[['x','X'],['y','Y'],['width','宽'],['height','高']].map(([key,label]) => <NumberField key={key} label={`${label} · mm`} value={Math.round(s.zone[key]*100)/100} min={key==='x'||key==='y'?0:.1} step={.1} onChange={(value) => editSurface(s.id,(old) => ({...old,zone:{...old.zone,[key]:value}}))}/>)}</div><h4>禁区</h4>{s.keepouts.map((r,index) => <div className="studio-keepout-config" key={index}><input aria-label="禁区名称" value={r.label} maxLength={40} onChange={(e) => editSurface(s.id,(old) => ({...old,keepouts:old.keepouts.map((k,i) => i===index?{...k,label:e.target.value}:k)}))}/><div className="studio-four-cols">{[['x','X'],['y','Y'],['width','宽'],['height','高']].map(([key,label]) => <NumberField key={key} label={`${label} · mm`} value={Math.round(r[key]*100)/100} min={0} step={.1} onChange={(value) => editSurface(s.id,(old) => ({...old,keepouts:old.keepouts.map((k,i) => i===index?{...k,[key]:value}:k)}))}/>)}</div><button onClick={() => editSurface(s.id,(old) => ({...old,keepouts:old.keepouts.filter((_,i) => i!==index)}))}>删除此禁区</button></div>)}<button disabled={s.keepouts.length>=20} onClick={() => editSurface(s.id,(old) => ({...old,keepouts:[...old.keepouts,{x:0,y:0,width:10,height:10,label:'新禁区'}]}))}>＋ 添加禁区</button></details>)}
        {selected.deferred.length>0&&<div className="studio-notice"><strong>暂缓的生产能力</strong>{selected.deferred.map((d) => <p key={d}>{d}</p>)}<p>模板启用不代表这些能力已实现。审核时需确认外部制作方已接手。</p></div>}
        <label className="studio-checkbox"><input type="checkbox" checked={selected.calibrated} onChange={(e) => set({calibrated:e.target.checked,enabled:e.target.checked?selected.enabled:false})}/>我已核对实物尺寸、材料、可制作区域与禁区</label><label className="studio-checkbox"><input type="checkbox" checked={selected.enabled} disabled={!selected.calibrated} onChange={(e) => set({enabled:e.target.checked})}/>允许顾客提交此品类的制作申请</label></>:<CatalogLayoutEditor template={selected} onChange={setSelected} disabled={busy}/>}<button className="studio-primary" disabled={busy} onClick={persist}>{busy?'保存中…':'保存模板新版本'}</button>
      </section></div>:<div className="studio-admin-layout"><aside className="studio-template-menu">{rows.map((row) => <button disabled={busy} key={row.id} className={request?.id===row.id?'active':''} onClick={() => openRequest(row.id)}><strong>{row.name}</strong><span>{row.templateName} · {({submitted:'待审核',reviewed:'已审核',declined:'需修改'})[row.state]}</span><small>{row.id.slice(0,8)} · {new Date(row.updated_at).toLocaleString()}</small></button>)}{!rows.length&&<p className="studio-muted">暂无制作申请。顾客提交后会出现在这里。</p>}{next&&<button disabled={busy} onClick={() => loadRequests(next)}>加载更多</button>}</aside>
      {request?<section className="studio-panel"><h2>{request.document.name}</h2><p className="studio-muted">设计 {request.id} · {request.template.name} v{request.template.version}</p><div className="studio-review-surfaces">{request.template.surfaces.map((s) => <div key={s.id}><h3>{s.name}</h3><StudioCanvas template={request.template} document={request.document} surfaceId={s.id} readOnly/><small>{s.widthMm} × {s.heightMm} mm</small></div>)}</div><p>客户说明：{request.document.notes||'无'}</p><button onClick={() => downloadFile(`${request.id}-review.json`,JSON.stringify(productionPack(request.document,request.template),null,2))}>下载完整制作资料包</button><div className="studio-notice">{validateDesign(request.document,request.template).warnings.map((w) => <p key={w}>{w}</p>)}<p>示例物料须与实际库存核对。SVG 中的字体未转曲；本系统不会生成针法、刀路或 3D 模型。</p></div><label className="studio-field"><span>审核说明（客户可见）</span><textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)}/></label><label className="studio-field"><span>最终整件商品 Shopify variant ID（可稍后绑定）</span><input value={variantId} inputMode="numeric" onChange={(e) => setVariantId(e.target.value)}/></label><div className="studio-variant-picker"><label className="studio-field"><span>搜索 Shopify 商品 / SKU</span><input value={variantSearch} onChange={(e) => setVariantSearch(e.target.value)} onKeyDown={(e) => {if(e.key==='Enter')findVariants()}}/></label><button disabled={busy} onClick={findVariants}>查找变体</button>{variants.map((variant) => <button type="button" key={variant.id} disabled={busy||!variant.available} onClick={() => {setVariantId(variant.id);setVariants([])}}>{variant.name} · {variant.price} · {variant.available?'选择':'不可销售'}</button>)}</div><p className="studio-muted">请绑定包含全部材料与工费的整件商品，不是仅底胚价格。购物车由 Shopify 计价。系统不替代付款事件、库存物料扣减和履约集成。</p><label className="studio-checkbox"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}/>我已确认所有设计面、物料、生产文件及外部工艺能力；绑定商品的价格包含完整制作费用</label><div className="studio-head-actions"><button className="studio-primary" disabled={busy||!confirmed||!notes.trim()} onClick={() => review('reviewed')}>确认可制作</button><button disabled={busy||!notes.trim()} onClick={() => review('declined')}>退回并说明</button><button disabled={busy} onClick={removeRequest}>删除设计资料</button></div></section>:<section className="studio-panel studio-empty">选择一条申请，查看设计快照与制作资料。</section>}
    </div>}
  </div>
}
