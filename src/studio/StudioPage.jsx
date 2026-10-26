import { lazy,Suspense,useEffect,useMemo,useRef,useState } from 'react'
import { PRODUCT_TEMPLATES,PROCESSES,MATERIALS,WORKFLOWS,interactionFor } from './templates.js'
import { blankDesign,normalizeDesign,validateDesign,billOfMaterials,beadMetrics,productionPack,FONT_FAMILIES } from './model.js'
import { studioApi,designCredentials,downloadFile } from './api.js'
import StudioCanvas from './StudioCanvas.jsx'
import StudioCatalogTools from './StudioCatalogTools.jsx'
import { orderedCatalogItems } from './catalogLayout.js'
import { openStudioCart } from '../lib/storefrontCart.js'
import './studio.css'

const copy=(v) => JSON.parse(JSON.stringify(v))
const SHOP = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('shop') : ''
const CUSTOMIZER = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('customizer') : ''
const RECOVERY=`charme.studio.recovery.v1.${SHOP || 'default'}`
const studioLocation=(path='/studio/') => { const url=new URL(path,location.origin);if(SHOP)url.searchParams.set('shop',SHOP);if(CUSTOMIZER)url.searchParams.set('customizer',CUSTOMIZER);return url }
const labels={draft:'草稿',submitted:'等待制作审核',reviewed:'已审核',declined:'需修改 · 请复制新设计'}
const JewelryScene=lazy(() => import('./JewelryScene.jsx'))
export function NumberField({label,value,onChange,min=0,max=1500,step=1,disabled=false}) {
  return <label className="studio-field"><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => {const value=e.target.valueAsNumber;if(Number.isFinite(value))onChange(value)}}/></label>
}

function WorkflowCard({workflow,products,onSelect}) {
  return <button className={`studio-workflow-card studio-workflow-card--${workflow.id}`} onClick={() => onSelect(workflow)}>
    <span className="studio-workflow-symbol" aria-hidden="true">{workflow.symbol}</span>
    <span className="studio-eyebrow">{workflow.english} · {products.length} 种商品</span>
    <h2>{workflow.name}</h2><p>{workflow.description}</p><small>{workflow.detail}</small>
    <span className="studio-workflow-products">{products.slice(0,4).map((product) => <span key={product.id}>{product.name}</span>)}{products.length>4&&<span>＋{products.length-4}</span>}</span>
    <span className="studio-workflow-enter">进入工作台 <span aria-hidden="true">↗</span></span>
  </button>
}

export default function StudioPage() {
  const [templates,setTemplates]=useState(PRODUCT_TEMPLATES),[backend,setBackend]=useState('loading'),[apiError,setApiError]=useState('')
  const [template,setTemplate]=useState(null),[doc,setDoc]=useState(null),[record,setRecord]=useState(null),[credentials,setCredentials]=useState(null)
  const [surfaceId,setSurfaceId]=useState(''),[selected,setSelected]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [history,setHistory]=useState({past:[],future:[]}),[country,setCountry]=useState('GB'),[quote,setQuote]=useState(null),[now,setNow]=useState(Date.now())
  const [share,setShare]=useState(''),[recovery,setRecovery]=useState(null),[localError,setLocalError]=useState('')
  const [customizerName,setCustomizerName]=useState('')
  const [customizerError,setCustomizerError]=useState('')
  const documentRef=useRef(doc),pendingCredentials=useRef(null),initialized=useRef(false),operation=useRef(false)
  const session=useRef(null)
  if (!session.current && typeof window!=='undefined') session.current=window.__charmeStudioSession ||= crypto.randomUUID()
  const track=(event,templateId=template?.id,materialIds=[]) => {
    const device=innerWidth<640?'mobile':innerWidth<1024?'tablet':'desktop'
    studioApi.track(event,session.current,templateId,device,materialIds).catch(() => {})
  }
  documentRef.current=doc

  useEffect(() => {
    let live=true
    studioApi.templates().then((result) => {if(live){setTemplates(result.templates);setBackend('ready');setApiError('')}}).catch((error) => {if(live){setBackend('offline');setApiError(error.message)}})
    track('start')
    try {const saved=JSON.parse(localStorage.getItem(RECOVERY));if(saved?.document?.schemaVersion===1)setRecovery(saved)}catch{}
    return () => {live=false}
  },[])
  const install=(nextTemplate,nextDoc,nextRecord=null,nextCredentials=null) => {
    setTemplate(nextTemplate);setDoc(nextDoc);setRecord(nextRecord);setCredentials(nextCredentials);pendingCredentials.current=null
    setSurfaceId(nextTemplate.surfaces[0].id);setSelected(null);setHistory({past:[],future:[]});setQuote(null);setShare('');setNotice('')
  }
  useEffect(() => {
    if(initialized.current || backend==='loading')return
    initialized.current=true
    const params=new URLSearchParams(location.hash.slice(1)),id=params.get('design'),secret=params.get('key')
    if(id&&secret){setBusy(true);studioApi.load(id,secret).then((row) => install(row.template,row.document,row,{id,secret})).catch((e) => setNotice(e.message)).finally(() => setBusy(false));return}
    if(CUSTOMIZER){setBusy(true);studioApi.publishedCustomizer(CUSTOMIZER).then(({customizer,template}) => {setCustomizerName(customizer.name);install(template,blankDesign(template));track('choose',template.id)}).catch((e) => setCustomizerError(e.message)).finally(() => setBusy(false));return}
    const idFromUrl=new URLSearchParams(location.search).get('template'),chosen=templates.find((t) => t.id===idFromUrl)
    if(chosen){install(chosen,blankDesign(chosen));track('choose',chosen.id)}
  },[backend,templates])
  useEffect(() => {
    if(!doc||!template)return
    const timer=setTimeout(() => {
      try{localStorage.setItem(RECOVERY,JSON.stringify({document:doc,template,record,credentials}));setLocalError('')}
      catch{setLocalError('浏览器存储空间不足，请下载备份或保存到云端。')}
    },350)
    return () => clearTimeout(timer)
  },[doc,template,record,credentials])
  useEffect(() => {if(!quote)return;const timer=setInterval(() => setNow(Date.now()),1000);return () => clearInterval(timer)},[quote])
  const validation=useMemo(() => doc&&template?validateDesign(doc,template):null,[doc,template])
  const frozen=record&&record.state!=='draft',element=doc?.elements.find((e) => e.id===selected)
  const surface=template?.surfaces.find((s) => s.id===surfaceId)
  const mode=interactionFor(template)
  const visibleSurfaces=template && ['typography','imageSwap'].includes(mode)
    ? orderedCatalogItems(template,template.catalogLayout).flatMap((category) => category.items.map((item) => template.surfaces.find((surface) => surface.id === item.id.slice(8))))
    : template?.surfaces || []
  const change=(next,remember=true) => {
    if(frozen||busy)return
    if(remember)setHistory((h) => ({past:[...h.past,copy(documentRef.current)].slice(-40),future:[]}))
    setDoc(next);setQuote(null)
  }
  const updateElement=(patch) => change({...doc,elements:doc.elements.map((e) => e.id===selected?{...e,...patch}:e)})
  const rememberDrag=() => setHistory((h) => ({past:[...h.past,copy(documentRef.current)].slice(-40),future:[]}))
  const move=(id,x,y) => {
    const current=documentRef.current
    change({...current,elements:current.elements.map((e) => e.id===id?{...e,x:Math.round(x*10)/10,y:Math.round(y*10)/10}:e)},false)
  }
  const undo=() => {if(!history.past.length||frozen||busy)return;setDoc(history.past.at(-1));setHistory({past:history.past.slice(0,-1),future:[doc,...history.future]})}
  const redo=() => {if(!history.future.length||frozen||busy)return;setDoc(history.future[0]);setHistory({past:[...history.past,doc],future:history.future.slice(1)})}
  const choose=(t) => {
    if(busy)return
    if(doc&&!confirm('当前设计已保留在浏览器恢复区。切换品类前，建议先保存到云端或下载备份。继续？'))return
    install(t,blankDesign(t));track('choose',t.id);const url=new URL(location.href);url.searchParams.set('template',t.id);url.hash='';window.history.replaceState({},'',url)
  }
  const chooseWorkflow=(workflow) => {
    const first=templates.find((item) => interactionFor(item)===workflow.id)
    if(first)choose(first)
  }
  const add=(type,material,extra={}) => {
    if(frozen||busy)return
    if(doc.elements.length>=template.maxElements){setNotice(`最多 ${template.maxElements} 个元素。`);return}
    const physical=['assembly','patch','beads'].includes(template.process)
    const w=material?(physical?material.width:Math.min(surface.zone.width*.25,30)):Math.min(surface.zone.width*.65,type==='image'?60:80)
    const h=material?(physical?material.height:w):type==='text'?Math.min(12,surface.zone.height*.4):w
    const id=crypto.randomUUID(),e={id,surfaceId,type,x:surface.zone.x+surface.zone.width/2,y:surface.zone.y+surface.zone.height/2,widthMm:w,heightMm:h,rotation:0,color:material?.color||doc.threadColor,...(material?{materialId:material.id}:{}),...extra}
    change({...doc,elements:[...doc.elements,e]});setSelected(id)
  }
  const save=async (action='save') => {
    if(operation.current)return
    operation.current=true;setBusy(true);setNotice('')
    try {
      const normalized=normalizeDesign(doc,template)
      let access=credentials||pendingCredentials.current||designCredentials();pendingCredentials.current=access
      let saved=record
      if(!saved){saved=await studioApi.create(access.id,access.secret,normalized,CUSTOMIZER);setCredentials(access);setRecord(saved)}
      if(saved.state==='draft')saved=await studioApi.save(saved,access.secret,normalized,action)
      setDoc(saved.document);setTemplate(saved.template);setRecord(saved);setCredentials(access)
      const link=studioLocation();link.hash=new URLSearchParams({design:saved.id,key:access.secret}).toString();setShare(link.href)
      setNotice(action==='submit'?'制作申请已提交，设计已冻结。请保留私密设计链接以查看审核进度。':'设计已保存到后端。私密链接可恢复此设计，请只分享给你信任的人。')
      track(action==='submit'?'submit':'save',template.id,action==='submit'?normalized.elements.map((element) => element.materialId).filter(Boolean):[])
    }catch(error){setNotice(error.message)}finally{setBusy(false);operation.current=false}
  }
  const refresh=async () => {
    if(!record||!credentials)return
    setBusy(true);try{const row=await studioApi.load(record.id,credentials.secret);setRecord(row);if(row.state!=='draft'){setDoc(row.document);setTemplate(row.template)}setQuote(null);setNotice('已更新审核状态。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const deleteDraft=async () => {
    if (!record||!credentials||record.state!=='draft'||!confirm('永久删除这个设计草稿？删除后私密链接也会失效。')) return
    setBusy(true)
    try {await studioApi.deleteDesign(record.id,credentials.secret);try{localStorage.removeItem(RECOVERY)}catch{}location.assign(studioLocation().href)} catch (error) {setNotice(error.message);setBusy(false)}
  }
  const quoteDesign=async () => {
    setBusy(true);try{const result=await studioApi.quote(record,credentials.secret,country);setQuote(result);setNow(Date.now());setNotice('报价来自 Shopify。最终市场价格、库存、优惠和运费以购物车为准。');track('quote')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const fork=() => {
    const current=templates.find((t) => t.id===template.id)||template
    try{const draft=normalizeDesign({...doc,templateVersion:current.version},current);install(current,draft);const url=studioLocation();url.searchParams.set('template',current.id);window.history.replaceState({},'',url)}catch(e){setNotice(`无法自动复制到新模板：${e.message} 请先下载原设计再新建。`)}
  }
  const workflows=WORKFLOWS.map((workflow) => ({...workflow,products:templates.filter((t) => interactionFor(t)===workflow.id)}))

  if (customizerError) return <main className="studio-shell studio-gallery"><h1>此定制器暂不可用</h1><p role="alert">{customizerError}</p><p>请返回商品页，或联系商家获取新的链接。</p></main>
  return <div className="studio-shell">
    <header className="studio-header"><a className="studio-brand" href={studioLocation().href}>CHARMÉ <span>PRODUCT STUDIO</span></a>{!SHOP&&<nav><a href="/editor/">经典定制器</a><a href="/admin?tab=studio">商家后台 ↗</a></nav>}</header>
    {notice&&!template&&<div className="studio-notice" role="status">{notice}</div>}
    {!template ? <main className="studio-gallery">
      <div className="studio-hero"><div><span className="studio-eyebrow">ONE IDEA. FIVE WAYS TO CREATE.</span><h1>先选玩法，<br/><em>再选你的商品。</em></h1><p>相近的商品共享同一种定制方式。<br/>拖拽、打字、换图、拼装或旋转 3D 首饰，从熟悉的动作开始。</p></div><div className="studio-hero-note"><strong>{WORKFLOWS.length}</strong><span>种交互方式</span><p>{templates.length} 个商品模板<br/>一套保存与制作审核流程</p></div></div>
      {recovery&&<div className="studio-recovery"><span>继续上次的「{recovery.document.name}」</span><button onClick={() => {try{install(recovery.template,normalizeDesign(recovery.document,recovery.template),recovery.record,recovery.credentials)}catch(e){setNotice(e.message)}}}>恢复设计 →</button></div>}
      {backend==='offline'&&<div className="studio-notice">当前为本地预览模式：{apiError} 可以编辑、下载备份；云端保存需连接后端。</div>}
      <div className="studio-flow-heading"><span className="studio-eyebrow">CHOOSE HOW YOU CREATE</span><h2>你的创作方式</h2><p>进入工作台后，再选择具体的商品。</p></div>
      <div className="studio-workflow-grid">{workflows.map((workflow) => <WorkflowCard key={workflow.id} workflow={workflow} products={workflow.products} onSelect={chooseWorkflow}/>)}</div>
      <p className="studio-footnote">所有尺寸和材料为可配置示例。3D 为参数化预览；机器生产文件仍需制作方完成与核验。</p>
    </main> : <main className="studio-editor">
      <div className="studio-editor-head"><div>{!CUSTOMIZER&&<button className="studio-text-button" disabled={busy} onClick={() => {setTemplate(null);setDoc(null);setRecovery({document:doc,template,record,credentials});window.history.replaceState({},'',studioLocation())}}>← 选择交互方式</button>}<span className="studio-eyebrow">{WORKFLOWS.find((w) => w.id===mode)?.english}</span><h1>{customizerName||WORKFLOWS.find((w) => w.id===mode)?.name}</h1>{!CUSTOMIZER&&<label className="studio-product-select"><span>选择商品</span><select value={template.id} disabled={busy||!!frozen} onChange={(event) => {const next=templates.find((t) => t.id===event.target.value);if(next)choose(next)}}>{templates.filter((t) => interactionFor(t)===mode).map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>}<p>{template.name} · {PROCESSES[template.process].name} · 模板 v{template.version} · {labels[record?.state||'draft']}</p></div><div className="studio-head-actions"><button disabled={busy} onClick={() => downloadFile(`${template.id}-design.json`,JSON.stringify({format:'charme-design-backup',template,document:doc},null,2))}>下载备份</button><button disabled={busy} onClick={() => downloadFile(`${template.id}-review.json`,JSON.stringify(productionPack(doc,template),null,2))}>制作资料包</button>{record?.state==='draft'&&<button disabled={busy} onClick={deleteDraft}>删除草稿</button>}{frozen?<button onClick={fork} disabled={busy}>复制为新设计</button>:<button className="studio-primary" disabled={busy} onClick={() => save()}>{busy?'处理中…':'保存到云端'}</button>}</div></div>
      {(notice||localError)&&<div className="studio-notice" role="status">{notice||localError}</div>}
      {!template.enabled&&<div className="studio-sample-note">示例模板：可设计与保存。商家核对实物尺寸、材料、禁区并启用后，才能提交制作申请。</div>}
      {!CUSTOMIZER&&<div className="studio-sample-note">这是模板预览入口。新商店需先发布定制器，并从其专属顾客链接进入，才能提交制作申请。</div>}
      <div className="studio-workspace">
        <aside className="studio-panel studio-tools"><h2>{mode==='placement'?'设计素材':mode==='jewelry3d'?'珠子与吊坠':'定制内容'}</h2>
          <StudioCatalogTools key={template.id} template={template} document={doc} mode={mode} add={add} onChange={change} onError={setNotice} disabled={!!frozen||busy}/>
          <div className="studio-tool-group"><h3>导入备份</h3><input aria-label="导入设计备份" type="file" accept="application/json,.json" disabled={busy} onChange={async (event) => {const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>1000000)throw new Error('备份大于 1 MB。');const saved=JSON.parse(await file.text()),t=templates.find((v) => v.id===saved.document?.templateId);if(!t)throw new Error('备份品类不存在。');install(t,normalizeDesign({...saved.document,templateVersion:t.version},t));setNotice('已导入为新设计，请检查模板更新后的边界。')}catch(e){setNotice(e.message)}}}/></div>
        </aside>
        <section className="studio-stage-wrap"><div className="studio-stage-toolbar"><div className="studio-side-tabs">{visibleSurfaces.map((s) => <button key={s.id} className={s.id===surfaceId?'active':''} onClick={() => {setSurfaceId(s.id);setSelected(null)}}>{s.name}<small>{doc.elements.filter((e) => e.surfaceId===s.id).length}</small></button>)}</div><div><button aria-label="撤销" disabled={!history.past.length||!!frozen||busy} onClick={undo}>↶</button><button aria-label="重做" disabled={!history.future.length||!!frozen||busy} onClick={redo}>↷</button></div></div>
          <div className={`studio-stage studio-stage--${mode}`}>{mode==='jewelry3d'?<Suspense fallback={<div className="studio-3d-loading">正在准备 3D 模型…</div>}><JewelryScene template={template} document={doc}/></Suspense>:<StudioCanvas template={template} document={doc} surfaceId={surfaceId} selected={selected} onSelect={setSelected} onMove={move} onDragStart={rememberDrag} invalidIds={validation.invalidIds} readOnly={mode!=='placement'||!!frozen||busy}/>}</div>
          <div className="studio-ruler"><span>{mode==='jewelry3d'?`目标长度 ${template.circumferenceMm} mm`:`${surface.widthMm} × ${surface.heightMm} mm`}</span><span>{({placement:'拖动调整 · 方向键微调',typography:'打字与换字体 · 固定位置',jewelry3d:'拖动旋转 · 滚轮缩放',imageSwap:'只替换图片 · 固定位置',components:'选择部件 · 固定安装位'})[mode]}</span></div>
          <div className={`studio-validation ${validation.valid?'is-valid':''}`} role="status"><strong>{validation.valid?'✓ 布局检查通过':'请调整设计'}</strong>{validation.errors.map((s) => <p key={s}>{s}</p>)}{validation.warnings.map((s) => <p className="studio-warning" key={s}>{s}</p>)}</div>
          {template.process==='beads'&&<div className="studio-length"><strong>{beadMetrics(doc,template).totalMm} / {template.circumferenceMm} mm</strong><span>珠子 {beadMetrics(doc,template).beadsMm} mm ＋ 扣件 {template.claspMm} mm</span></div>}
          {['placement','jewelry3d'].includes(mode)&&<div className="studio-layer-list"><h3>{mode==='jewelry3d'?'珠子排列顺序':'当前设计面元素'}</h3>{doc.elements.filter((e) => e.surfaceId===surfaceId).map((e,i) => <div key={e.id} className={selected===e.id?'selected':''}><button onClick={() => setSelected(e.id)}>{i+1}. {e.text||MATERIALS.find((m) => m.id===e.materialId)?.name||'图像'}</button><button aria-label="前移元素" disabled={!!frozen||busy||i===0} onClick={() => {const all=[...doc.elements],at=all.findIndex((row) => row.id===e.id);let prev=at-1;while(prev>=0&&all[prev].surfaceId!==surfaceId)prev--;if(prev>=0){[all[at],all[prev]]=[all[prev],all[at]];change({...doc,elements:all})}}}>↑</button><button aria-label="删除元素" disabled={!!frozen||busy} onClick={() => {change({...doc,elements:doc.elements.filter((row) => row.id!==e.id)});if(selected===e.id)setSelected(null)}}>×</button></div>)}{!doc.elements.some((e) => e.surfaceId===surfaceId)&&<p className="studio-muted">从左侧添加一个元素，开始设计。</p>}</div>}
        </section>
        <aside className="studio-panel studio-inspector"><h2>{element&&mode==='placement'?'调整元素':'设计设置'}</h2>
          {element&&mode==='placement'?<><div className="studio-two-cols"><NumberField label="X · mm" value={element.x} min={-1000} step={0.1} disabled={!!frozen||busy} onChange={(x) => updateElement({x})}/><NumberField label="Y · mm" value={element.y} min={-1000} step={0.1} disabled={!!frozen||busy} onChange={(y) => updateElement({y})}/><NumberField label="宽 · mm" value={element.widthMm} min={.5} step={.5} disabled={!!frozen||busy||['assembly','patch'].includes(template.process)} onChange={(widthMm) => updateElement({widthMm})}/><NumberField label="高 · mm" value={element.heightMm} min={.5} step={.5} disabled={!!frozen||busy||['assembly','patch'].includes(template.process)} onChange={(heightMm) => updateElement({heightMm})}/></div><NumberField label="旋转 · °" value={element.rotation} min={-360} max={360} disabled={!!frozen||busy} onChange={(rotation) => updateElement({rotation})}/><label className="studio-field"><span>颜色 / 线色</span><input type="color" value={element.color} disabled={!!frozen||busy} onChange={(e) => updateElement({color:e.target.value})}/></label>{element.type==='text'&&<><label className="studio-field"><span>文字</span><input value={element.text} maxLength={template.maxTextLength} disabled={!!frozen||busy} onChange={(e) => updateElement({text:e.target.value})}/></label><label className="studio-field"><span>字体</span><select value={element.font} disabled={!!frozen||busy} onChange={(e) => updateElement({font:e.target.value})}>{FONT_FAMILIES.map((font) => <option key={font}>{font}</option>)}</select></label></>}<button className="studio-text-button" onClick={() => setSelected(null)}>返回设计设置</button></>:<><label className="studio-field"><span>设计名称</span><input value={doc.name} maxLength={80} disabled={!!frozen||busy} onChange={(e) => change({...doc,name:e.target.value})}/></label><label className="studio-field"><span>预览底色</span><input type="color" value={doc.color} disabled={!!frozen||busy} onChange={(e) => change({...doc,color:e.target.value})}/></label><label className="studio-field"><span>给制作方的说明</span><textarea value={doc.notes} maxLength={1000} disabled={!!frozen||busy} onChange={(e) => change({...doc,notes:e.target.value})}/></label><p className="studio-muted">材料：{template.material}</p>{template.productionNotes&&<p className="studio-muted">{template.productionNotes}</p>}</>}
          <div className="studio-tool-group"><h3>物料与设计摘要</h3>{billOfMaterials(doc,template).map((m) => <div className="studio-bom" key={m.key}><span>{m.surface} · {m.material}</span><strong>×{m.quantity}</strong></div>)}</div>
          <div className="studio-next-step"><span className="studio-eyebrow">NEXT STEP</span><h3>{record?.state==='reviewed'?'制作已确认':'交给制作方确认'}</h3><p>提交后冻结所有设计面。制作方核对物料和文件，再绑定最终整件商品报价。</p>{!frozen?<button className="studio-primary" disabled={busy||!validation.valid||!template.enabled} onClick={() => save('submit')}>提交制作申请</button>:<><p>{record.review?.notes}</p><button disabled={busy} onClick={refresh}>刷新审核状态</button></>}
          {record?.state==='reviewed'&&<><label className="studio-field"><span>报价国家 / 市场</span><select value={country} onChange={(e) => {setCountry(e.target.value);setQuote(null)}}>{[['GB','英国'],['US','美国'],['CN','中国'],['JP','日本'],['FR','法国'],['DE','德国'],['CA','加拿大'],['AU','澳大利亚']].map(([value,name]) => <option value={value} key={value}>{name}</option>)}</select></label><button disabled={busy||!record.review?.variantId} onClick={quoteDesign}>获取 Shopify 报价</button>{!record.review?.variantId&&<p>等待商家绑定最终商品。</p>}{quote&&<div className="studio-quote"><strong>{quote.currency} {quote.amount}</strong><p>税费、运费、优惠及实际市场价格以 Shopify 购物车为准。</p><button className="studio-primary" disabled={busy||now>=Date.parse(quote.expiresAt)} onClick={() => {studioApi.trackBeacon('cart',session.current,template.id,innerWidth<640?'mobile':'desktop');openStudioCart(quote.storeUrl,quote.items[0])}}>{now>=Date.parse(quote.expiresAt)?'报价已过期，请重新获取':'前往 Shopify 购物车'}</button></div>}</>}
          </div>
          {share&&<label className="studio-field"><span>私密设计链接（持有者可访问）</span><input value={share} readOnly onFocus={(e) => e.target.select()}/><button onClick={() => navigator.clipboard?.writeText(share).then(() => setNotice('私密链接已复制。')).catch(() => setNotice('请选中上方链接并复制。'))}>复制链接</button></label>}
          <p className="studio-muted">SVG / JSON 制作资料为审核用途。3D 为参数化预览，不是机器生产文件。</p>
        </aside>
      </div>
    </main>}
    <footer className="studio-footer"><span>CHARMÉ / MAKE IT YOURS</span><span><a href="/privacy/" target="_blank" rel="noreferrer">隐私政策</a> · <a href="/terms/" target="_blank" rel="noreferrer">服务条款</a></span></footer>
  </div>
}
