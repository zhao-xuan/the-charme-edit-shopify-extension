import { useState } from 'react'
import { MATERIALS } from './templates.js'
import { pngInfo } from './model.js'
import { readArtwork } from './api.js'
import { orderedCatalogItems } from './catalogLayout.js'
import { TypographyTools, ImageSwapTools, ComponentTools } from './WorkflowTools.jsx'

function sections(items) {
  return items.reduce((groups, item) => {
    if (item.id.startsWith('material:') && groups.at(-1)?.kind === 'materials') groups.at(-1).items.push(item)
    else groups.push(item.id.startsWith('material:') ? { kind:'materials', items:[item] } : { kind:item.id, items:[item] })
    return groups
  }, [])
}

export default function StudioCatalogTools({ template, document, mode, add, onChange, onError, disabled }) {
  const [textValue, setTextValue] = useState('YOUR STORY')
  const categories = orderedCatalogItems(template, template.catalogLayout)
  return <div className="studio-catalog-tools">
    {mode === 'placement' && <p className="studio-muted">把装饰拖到商品的设计面上；实物与可生产性需制作方确认。</p>}
    {mode === 'jewelry3d' && <p className="studio-muted">按添加顺序排列珠子；在模型上拖动可旋转查看。模型几何由设计数据生成。</p>}
    {categories.map((category) => <section className="studio-catalog-tool-category" key={category.id}><h3>{category.name}</h3>
      {(mode === 'placement' || mode === 'jewelry3d') && sections(category.items).map((section,index) => section.kind === 'materials' ? <div className="studio-materials" key={`${category.id}-${index}`}>{section.items.map((item) => {
        const material = MATERIALS.find((entry) => entry.id === item.id.slice(9))
        return <button key={item.id} disabled={disabled} onClick={() => add(mode === 'jewelry3d' ? 'bead' : 'motif',material)}><span style={{background:material.color}}/><strong>{material.name}</strong><small>{material.width}{mode === 'jewelry3d' ? ' mm' : ` × ${material.height} mm`}</small></button>
      })}</div> : section.kind === 'action:text' ? <div className="studio-tool-group" key={section.kind}><h3>添加文字</h3><input aria-label="设计文字" value={textValue} maxLength={template.maxTextLength} onChange={(event) => setTextValue(event.target.value)}/><button disabled={disabled || !textValue.trim()} onClick={() => add('text',null,{text:textValue,font:'sans-serif'})}>＋ 添加文字</button></div> : <div className="studio-tool-group" key={section.kind}><h3>上传图案</h3><input aria-label="上传图案" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => {const file=event.target.files[0];event.target.value='';if(!file)return;try{const src=await readArtwork(file);add('image',null,{src,pixels:pngInfo(src)})}catch(error){onError(error.message)}}}/><p className="studio-muted">图片会优化为 PNG。缩放后仍需满足工艺分辨率。</p></div>)}
      {mode === 'typography' && <TypographyTools template={template} document={document} onChange={onChange} disabled={disabled} surfaces={category.items.map((item) => template.surfaces.find((surface) => surface.id === item.id.slice(8)))}/>}
      {mode === 'imageSwap' && <ImageSwapTools template={template} document={document} onChange={onChange} onError={onError} disabled={disabled} surfaces={category.items.map((item) => template.surfaces.find((surface) => surface.id === item.id.slice(8)))}/>}
      {mode === 'components' && <ComponentTools template={template} document={document} onChange={onChange} disabled={disabled} slots={category.items.map((item) => template.slots.find((slot) => slot.id === item.id.slice(5)))}/>}
    </section>)}
  </div>
}
