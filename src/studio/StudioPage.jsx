import { useEffect,useMemo,useRef,useState } from 'react'
import { PRODUCT_TEMPLATES,PROCESSES,MATERIALS } from './templates.js'
import { blankDesign,normalizeDesign,validateDesign,billOfMaterials,beadMetrics,productionPack,pngInfo,FONT_FAMILIES } from './model.js'
import { studioApi,designCredentials,downloadFile,readArtwork } from './api.js'
import StudioCanvas from './StudioCanvas.jsx'
import { submitStorefrontCartForm } from '../lib/storefrontCart.js'
import './studio.css'

const copy=(v) => JSON.parse(JSON.stringify(v))
const RECOVERY='charme.studio.recovery.v1'
const labels={draft:'草稿',submitted:'等待制作审核',reviewed:'已审核',declined:'需修改 · 请复制新设计'}
export function NumberField({label,value,onChange,min=0,max=1500,step=1,disabled=false}) {
  return <label className="studio-field"><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => {const value=e.target.valueAsNumber;if(Number.isFinite(value))onChange(value)}}/></label>
}

function TemplateCard({template,onSelect}) {
  const sample=blankDesign(template),s=template.surfaces[0]
  const m=MATERIALS.find((item) => item.processes.includes(template.process))
  if(m)sample.elements=[{id:'sample',surfaceId:s.id,type:template.process==='beads'?'bead':'motif',materialId:m.id,x:s.widthMm*.65,y:s.heightMm*.65,widthMm:Math.min(s.widthMm*.22,30),heightMm:Math.min(s.widthMm*.22,30),rotation:-8,color:m.color}]
  return <button className="studio-template-card" onClick={() => onSelect(template)}>
    <div className={`studio-card-art studio-art--${template.process}`}><StudioCanvas template={template} document={sample} surfaceId={s.id} readOnly mini/></div>
    <div className="studio-card-info"><span className="studio-eyebrow">{PROCESSES[template.process].name} · {template.surfaces.length} 个设计面</span><h3>{template.name}</h3><p>{template.description}</p><div className="studio-card-foot"><span>{template.enabled?'开放制作申请':'示例 · 待实物标定'}</span><span aria-hidden="true">↗</span></div></div>
  </button>
}

export default function StudioPage() {
  const [templates,setTemplates]=useState(PRODUCT_TEMPLATES),[backend,setBackend]=useState('loading'),[apiError,setApiError]=useState('')
  const [filter,setFilter]=useState('全部'),[search,setSearch]=useState('')
  const [template,setTemplate]=useState(null),[doc,setDoc]=useState(null),[record,setRecord]=useState(null),[credentials,setCredentials]=useState(null)
  const [surfaceId,setSurfaceId]=useState(''),[selected,setSelected]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [history,setHistory]=useState({past:[],future:[]}),[textValue,setTextValue]=useState('YOUR STORY'),[country,setCountry]=useState('GB'),[quote,setQuote]=useState(null),[now,setNow]=useState(Date.now())
  const [share,setShare]=useState(''),[recovery,setRecovery]=useState(null),[localError,setLocalError]=useState('')
  const documentRef=useRef(doc),pendingCredentials=useRef(null),initialized=useRef(false),operation=useRef(false)
  documentRef.current=doc

  useEffect(() => {
    let live=true
    studioApi.templates().then((result) => {if(live){setTemplates(result.templates);setBackend('ready');setApiError('')}}).catch((error) => {if(live){setBackend('offline');setApiError(error.message)}})
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
    const idFromUrl=new URLSearchParams(location.search).get('template'),chosen=templates.find((t) => t.id===idFromUrl)
    if(chosen)install(chosen,blankDesign(chosen))
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
    install(t,blankDesign(t));const url=new URL(location.href);url.searchParams.set('template',t.id);url.hash='';window.history.replaceState({},'',url)
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
      if(!saved){saved=await studioApi.create(access.id,access.secret,normalized);setCredentials(access);setRecord(saved)}
      if(saved.state==='draft')saved=await studioApi.save(saved,access.secret,normalized,action)
      setDoc(saved.document);setTemplate(saved.template);setRecord(saved);setCredentials(access)
      const link=new URL('/studio/',location.origin);link.hash=new URLSearchParams({design:saved.id,key:access.secret}).toString();setShare(link.href)
      setNotice(action==='submit'?'制作申请已提交，设计已冻结。请保留私密设计链接以查看审核进度。':'设计已保存到后端。私密链接可恢复此设计，请只分享给你信任的人。')
    }catch(error){setNotice(error.message)}finally{setBusy(false);operation.current=false}
  }
  const refresh=async () => {
    if(!record||!credentials)return
    setBusy(true);try{const row=await studioApi.load(record.id,credentials.secret);setRecord(row);if(row.state!=='draft'){setDoc(row.document);setTemplate(row.template)}setQuote(null);setNotice('已更新审核状态。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const quoteDesign=async () => {
    setBusy(true);try{const result=await studioApi.quote(record,credentials.secret,country);setQuote(result);setNow(Date.now());setNotice('报价来自 Shopify。最终市场价格、库存、优惠和运费以购物车为准。')}catch(e){setNotice(e.message)}finally{setBusy(false)}
  }
  const fork=() => {
    const current=templates.find((t) => t.id===template.id)||template
    try{const draft=normalizeDesign({...doc,templateVersion:current.version},current);install(current,draft);window.history.replaceState({},'',`/studio/?template=${current.id}`)}catch(e){setNotice(`无法自动复制到新模板：${e.message} 请先下载原设计再新建。`)}
  }
  const groups=['全部',...new Set(templates.map((t) => t.group))]
  const shown=templates.filter((t) => (filter==='全部'||t.group===filter)&&`${t.name}${t.description}`.toLowerCase().includes(search.toLowerCase()))

  return <div className="studio-shell">
    <header className="studio-header"><a className="studio-brand" href="/studio/">CHARMÉ <span>PRODUCT STUDIO</span></a><nav><a href="/editor/">经典定制器</a><a href="/admin?tab=studio">商家后台 ↗</a></nav></header>
    {notice&&!template&&<div className="studio-notice" role="status">{notice}</div>}
    {!template ? <main className="studio-gallery">
      <div className="studio-hero"><div><span className="studio-eyebrow">ONE IDEA. MANY POSSIBILITIES.</span><h1>把你的灵感，<br/><em>做成每一种日常。</em></h1><p>从贴片包袋到专属刻字，为不同材质选择合适的设计方式。<br/>先设计，再由制作方核对尺寸、材料与工艺。</p></div><div className="studio-hero-note"><strong>{templates.length}</strong><span>个独立商品模板</span><p>多面编辑 · 真实尺寸<br/>设计备份 · 制作审核</p></div></div>
      {recovery&&<div className="studio-recovery"><span>继续上次的「{recovery.document.name}」</span><button onClick={() => {try{install(recovery.template,normalizeDesign(recovery.document,recovery.template),recovery.record,recovery.credentials)}catch(e){setNotice(e.message)}}}>恢复设计 →</button></div>}
      {backend==='offline'&&<div className="studio-notice">当前为本地预览模式：{apiError} 可以编辑、下载备份；云端保存需连接后端。</div>}
      <div className="studio-gallery-tools"><div className="studio-filters">{groups.map((group) => <button key={group} className={filter===group?'active':''} onClick={() => setFilter(group)}>{group}</button>)}</div><input aria-label="搜索品类" placeholder="搜索品类…" value={search} onChange={(e) => setSearch(e.target.value)}/></div>
      <div className="studio-template-grid">{shown.map((t) => <TemplateCard key={t.id} template={t} onSelect={choose}/>)}</div>
      {!shown.length&&<p className="studio-empty">没有匹配的品类。</p>}
      <p className="studio-footnote">模板尺寸和图案为可配置示例。3D、刺绣机器文件和雕刻路径暂缓；设计页会显示每种工艺的待接入能力。</p>
    </main> : <main className="studio-editor">
      <div className="studio-editor-head"><div><button className="studio-text-button" disabled={busy} onClick={() => {setTemplate(null);setDoc(null);setRecovery({document:doc,template,record,credentials});window.history.replaceState({},'','/studio/')}}>← 所有品类</button><h1>{template.name}</h1><p>{PROCESSES[template.process].name} · 模板 v{template.version} · {labels[record?.state||'draft']}</p></div><div className="studio-head-actions"><button disabled={busy} onClick={() => downloadFile(`${template.id}-design.json`,JSON.stringify({format:'charme-design-backup',template,document:doc},null,2))}>下载备份</button><button disabled={busy} onClick={() => downloadFile(`${template.id}-review.json`,JSON.stringify(productionPack(doc,template),null,2))}>制作资料包</button>{frozen?<button onClick={fork} disabled={busy}>复制为新设计</button>:<button className="studio-primary" disabled={busy} onClick={() => save()}>{busy?'处理中…':'保存到云端'}</button>}</div></div>
      {(notice||localError)&&<div className="studio-notice" role="status">{notice||localError}</div>}
      {!template.enabled&&<div className="studio-sample-note">示例模板：可设计与保存。商家核对实物尺寸、材料、禁区并启用后，才能提交制作申请。</div>}
      <div className="studio-workspace">
        <aside className="studio-panel studio-tools"><h2>设计素材</h2><p className="studio-muted">示例素材用于布局；实物与可生产性需制作方确认。</p>
          <div className="studio-materials">{MATERIALS.filter((m) => m.processes.includes(template.process)).map((m) => <button key={m.id} disabled={!!frozen||busy} onClick={() => add(template.process==='beads'?'bead':'motif',m)}><span style={{background:m.color}}/><strong>{m.name}</strong><small>{m.width} × {m.height} mm</small></button>)}</div>
          {PROCESSES[template.process].accepts.includes('text')&&<div className="studio-tool-group"><h3>添加文字</h3><input aria-label="设计文字" value={textValue} maxLength={template.maxTextLength} onChange={(e) => setTextValue(e.target.value)}/><button disabled={!!frozen||busy||!textValue.trim()} onClick={() => add('text',null,{text:textValue,font:'sans-serif'})}>＋ 添加文字</button></div>}
          {PROCESSES[template.process].accepts.includes('image')&&<div className="studio-tool-group"><h3>上传图案</h3><input aria-label="上传图案" type="file" accept="image/png,image/jpeg,image/webp" disabled={!!frozen||busy} onChange={async (event) => {const file=event.target.files[0];event.target.value='';if(!file)return;try{const src=await readArtwork(file);add('image',null,{src,pixels:pngInfo(src)})}catch(e){setNotice(e.message)}}}/><p className="studio-muted">图片会优化为 PNG。缩放后仍需满足工艺分辨率。</p></div>}
          <div className="studio-tool-group"><h3>导入备份</h3><input aria-label="导入设计备份" type="file" accept="application/json,.json" disabled={busy} onChange={async (event) => {const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>1000000)throw new Error('备份大于 1 MB。');const saved=JSON.parse(await file.text()),t=templates.find((v) => v.id===saved.document?.templateId);if(!t)throw new Error('备份品类不存在。');install(t,normalizeDesign({...saved.document,templateVersion:t.version},t));setNotice('已导入为新设计，请检查模板更新后的边界。')}catch(e){setNotice(e.message)}}}/></div>
        </aside>
        <section className="studio-stage-wrap"><div className="studio-stage-toolbar"><div className="studio-side-tabs">{template.surfaces.map((s) => <button key={s.id} className={s.id===surfaceId?'active':''} onClick={() => {setSurfaceId(s.id);setSelected(null)}}>{s.name}<small>{doc.elements.filter((e) => e.surfaceId===s.id).length}</small></button>)}</div><div><button aria-label="撤销" disabled={!history.past.length||!!frozen||busy} onClick={undo}>↶</button><button aria-label="重做" disabled={!history.future.length||!!frozen||busy} onClick={redo}>↷</button></div></div>
          <div className={`studio-stage studio-stage--${template.process}`}><StudioCanvas template={template} document={doc} surfaceId={surfaceId} selected={selected} onSelect={setSelected} onMove={move} onDragStart={rememberDrag} invalidIds={validation.invalidIds} readOnly={!!frozen||busy}/></div>
          <div className="studio-ruler"><span>{surface.widthMm} × {surface.heightMm} mm</span><span>{template.process==='beads'?'按列表顺序串联珠子':'拖动调整 · 选中后可用方向键微调'}</span></div>
          <div className={`studio-validation ${validation.valid?'is-valid':''}`} role="status"><strong>{validation.valid?'✓ 布局检查通过':'请调整设计'}</strong>{validation.errors.map((s) => <p key={s}>{s}</p>)}{validation.warnings.map((s) => <p className="studio-warning" key={s}>{s}</p>)}</div>
          {template.process==='beads'&&<div className="studio-length"><strong>{beadMetrics(doc,template).totalMm} / {template.circumferenceMm} mm</strong><span>珠子 {beadMetrics(doc,template).beadsMm} mm ＋ 扣件 {template.claspMm} mm</span></div>}
          <div className="studio-layer-list"><h3>{template.process==='beads'?'串珠顺序':'当前设计面元素'}</h3>{doc.elements.filter((e) => e.surfaceId===surfaceId).map((e,i) => <div key={e.id} className={selected===e.id?'selected':''}><button onClick={() => setSelected(e.id)}>{i+1}. {e.text||MATERIALS.find((m) => m.id===e.materialId)?.name||'图像'}</button><button aria-label="前移元素" disabled={!!frozen||busy||i===0} onClick={() => {const all=[...doc.elements],at=all.findIndex((row) => row.id===e.id);let prev=at-1;while(prev>=0&&all[prev].surfaceId!==surfaceId)prev--;if(prev>=0){[all[at],all[prev]]=[all[prev],all[at]];change({...doc,elements:all})}}}>↑</button><button aria-label="删除元素" disabled={!!frozen||busy} onClick={() => {change({...doc,elements:doc.elements.filter((row) => row.id!==e.id)});if(selected===e.id)setSelected(null)}}>×</button></div>)}{!doc.elements.some((e) => e.surfaceId===surfaceId)&&<p className="studio-muted">从左侧添加一个元素，开始设计。</p>}</div>
        </section>
        <aside className="studio-panel studio-inspector"><h2>{element?'调整元素':'设计设置'}</h2>
          {element?<><div className="studio-two-cols"><NumberField label="X · mm" value={element.x} min={-1000} step={0.1} disabled={!!frozen||busy||template.process==='beads'} onChange={(x) => updateElement({x})}/><NumberField label="Y · mm" value={element.y} min={-1000} step={0.1} disabled={!!frozen||busy||template.process==='beads'} onChange={(y) => updateElement({y})}/><NumberField label="宽 · mm" value={element.widthMm} min={.5} step={.5} disabled={!!frozen||busy||['assembly','patch','beads'].includes(template.process)} onChange={(widthMm) => updateElement({widthMm})}/><NumberField label="高 · mm" value={element.heightMm} min={.5} step={.5} disabled={!!frozen||busy||['assembly','patch','beads'].includes(template.process)} onChange={(heightMm) => updateElement({heightMm})}/></div><NumberField label="旋转 · °" value={element.rotation} min={-360} max={360} disabled={!!frozen||busy||template.process==='beads'} onChange={(rotation) => updateElement({rotation})}/><label className="studio-field"><span>颜色 / 线色</span><input type="color" value={element.color} disabled={!!frozen||busy} onChange={(e) => updateElement({color:e.target.value})}/></label>{element.type==='text'&&<><label className="studio-field"><span>文字</span><input value={element.text} maxLength={template.maxTextLength} disabled={!!frozen||busy} onChange={(e) => updateElement({text:e.target.value})}/></label><label className="studio-field"><span>字体</span><select value={element.font} disabled={!!frozen||busy} onChange={(e) => updateElement({font:e.target.value})}>{FONT_FAMILIES.map((font) => <option key={font}>{font}</option>)}</select></label></>}<button className="studio-text-button" onClick={() => setSelected(null)}>返回设计设置</button></>:<><label className="studio-field"><span>设计名称</span><input value={doc.name} maxLength={80} disabled={!!frozen||busy} onChange={(e) => change({...doc,name:e.target.value})}/></label><label className="studio-field"><span>预览底色</span><input type="color" value={doc.color} disabled={!!frozen||busy} onChange={(e) => change({...doc,color:e.target.value})}/></label><label className="studio-field"><span>给制作方的说明</span><textarea value={doc.notes} maxLength={1000} disabled={!!frozen||busy} onChange={(e) => change({...doc,notes:e.target.value})}/></label><p className="studio-muted">材料：{template.material}</p>{template.productionNotes&&<p className="studio-muted">{template.productionNotes}</p>}</>}
          <div className="studio-tool-group"><h3>物料与设计摘要</h3>{billOfMaterials(doc,template).map((m) => <div className="studio-bom" key={m.key}><span>{m.surface} · {m.material}</span><strong>×{m.quantity}</strong></div>)}</div>
          <div className="studio-next-step"><span className="studio-eyebrow">NEXT STEP</span><h3>{record?.state==='reviewed'?'制作已确认':'交给制作方确认'}</h3><p>提交后冻结所有设计面。制作方核对物料和文件，再绑定最终整件商品报价。</p>{!frozen?<button className="studio-primary" disabled={busy||!validation.valid||!template.enabled} onClick={() => save('submit')}>提交制作申请</button>:<><p>{record.review?.notes}</p><button disabled={busy} onClick={refresh}>刷新审核状态</button></>}
          {record?.state==='reviewed'&&<><label className="studio-field"><span>报价国家 / 市场</span><select value={country} onChange={(e) => {setCountry(e.target.value);setQuote(null)}}>{[['GB','英国'],['US','美国'],['CN','中国'],['JP','日本'],['FR','法国'],['DE','德国'],['CA','加拿大'],['AU','澳大利亚']].map(([value,name]) => <option value={value} key={value}>{name}</option>)}</select></label><button disabled={busy||!record.review?.variantId} onClick={quoteDesign}>获取 Shopify 报价</button>{!record.review?.variantId&&<p>等待商家绑定最终商品。</p>}{quote&&<div className="studio-quote"><strong>{quote.currency} {quote.amount}</strong><p>税费、运费、优惠及实际市场价格以 Shopify 购物车为准。</p><button className="studio-primary" disabled={busy||now>=Date.parse(quote.expiresAt)} onClick={() => submitStorefrontCartForm(quote.storeUrl,quote.items)}>{now>=Date.parse(quote.expiresAt)?'报价已过期，请重新获取':'前往 Shopify 购物车'}</button></div>}</>}
          </div>
          {share&&<label className="studio-field"><span>私密设计链接（持有者可访问）</span><input value={share} readOnly onFocus={(e) => e.target.select()}/><button onClick={() => navigator.clipboard?.writeText(share).then(() => setNotice('私密链接已复制。')).catch(() => setNotice('请选中上方链接并复制。'))}>复制链接</button></label>}
          <p className="studio-muted">SVG / JSON 制作资料为审核用途。未承诺自动生成机器文件或 3D 模型。</p>
        </aside>
      </div>
    </main>}
    <footer className="studio-footer"><span>CHARMÉ / MAKE IT YOURS</span><span>设计与工艺，都值得被认真对待。</span></footer>
  </div>
}
