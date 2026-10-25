import { MATERIALS } from './templates.js'
import { pngInfo } from './model.js'
import { readArtwork } from './api.js'

const surfaceZone = (surface) => ({
  x: surface.zone.x + surface.zone.width / 2,
  y: surface.zone.y + surface.zone.height / 2,
})

export function TypographyTools({ template, document, onChange, disabled }) {
  const update = (surface, patch) => {
    const existing = document.elements.find((e) => e.surfaceId === surface.id)
    const value = { ...existing, ...patch }
    const elements = document.elements.filter((e) => e.surfaceId !== surface.id)
    if (value.text?.trim()) {
      elements.push({ id: existing?.id || `text-${surface.id}`, surfaceId:surface.id, type:'text',
        ...surfaceZone(surface), widthMm:surface.zone.width*.72,
        heightMm:Math.min(surface.zone.height*.45,34), rotation:0,
        text:value.text, font:value.font || 'serif', color:value.color || document.threadColor })
    }
    onChange({ ...document, elements })
  }
  return <div className="studio-workflow-controls">
    <p className="studio-muted">文字会自动放入预设内容位；无需拖动。制作前仍需确认字体与工艺。</p>
    {template.surfaces.map((surface) => {
      const element = document.elements.find((e) => e.surfaceId === surface.id)
      return <div className="studio-slot-editor" key={surface.id}>
        <strong>{surface.name}</strong>
        <label className="studio-field"><span>定制文字</span><textarea value={element?.text || ''} maxLength={template.maxTextLength} rows={surface.id==='inside'?4:2} disabled={disabled} placeholder="输入想说的话…" onChange={(event) => update(surface,{text:event.target.value})}/></label>
        <div className="studio-two-cols"><label className="studio-field"><span>字体</span><select value={element?.font || 'serif'} disabled={disabled} onChange={(event) => update(surface,{text:element?.text || '',font:event.target.value})}><option value="serif">经典衬线</option><option value="sans-serif">现代无衬线</option><option value="monospace">等宽字</option></select></label><label className="studio-field"><span>字色</span><input type="color" value={element?.color || document.threadColor} disabled={disabled} onChange={(event) => update(surface,{text:element?.text || '',color:event.target.value})}/></label></div>
      </div>
    })}
  </div>
}

export function ImageSwapTools({ template, document, onChange, onError, disabled }) {
  const replace = async (surface, file) => {
    if (!file) return
    try {
      const src = await readArtwork(file)
      const old = document.elements.find((e) => e.surfaceId === surface.id)
      const image = { id:old?.id || `image-${surface.id}`,surfaceId:surface.id,type:'image',
        ...surfaceZone(surface),widthMm:surface.zone.width,heightMm:surface.zone.height,
        rotation:0,color:document.threadColor,src,pixels:pngInfo(src) }
      onChange({ ...document,elements:[...document.elements.filter((e) => e.surfaceId !== surface.id),image] })
    } catch (error) { onError(error.message) }
  }
  return <div className="studio-workflow-controls"><p className="studio-muted">仅替换固定图片位。图片无法拖动；预览会从中心裁切以填满区域。</p>
    {template.surfaces.map((surface) => {
      const image = document.elements.find((e) => e.surfaceId === surface.id)
      return <div className="studio-slot-editor" key={surface.id}><strong>{surface.name}</strong>
        <label className="studio-image-picker"><span>{image?'替换当前图片':'选择图片'}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={async (event) => {const file=event.target.files?.[0];event.target.value='';await replace(surface,file)}}/></label>
        {image&&<div className="studio-image-meta"><span>{image.pixels.width} × {image.pixels.height} px</span><button disabled={disabled} onClick={() => onChange({...document,elements:document.elements.filter((e) => e.surfaceId!==surface.id)})}>移除</button></div>}
      </div>
    })}
  </div>
}

export function ComponentTools({ template, document, onChange, disabled }) {
  const choose = (slot, material) => onChange({ ...document, elements:document.elements.map((element) => element.slotId===slot.id
    ? {...element,materialId:material.id,color:material.color} : element) })
  return <div className="studio-workflow-controls"><p className="studio-muted">每个部件都有固定安装位；选择选项即可替换，不需要拖动。</p>
    {template.slots.map((slot) => <div className="studio-slot-editor" key={slot.id}><strong>{slot.name}</strong><div className="studio-component-choices">{slot.choices.map((id) => {
      const material=MATERIALS.find((item) => item.id===id)
      const selected=document.elements.find((e) => e.slotId===slot.id)?.materialId===id
      return <button key={id} disabled={disabled} className={selected?'active':''} onClick={() => choose(slot,material)} aria-pressed={selected}><span style={{background:material.color}}/>{material.name}</button>
    })}</div></div>)}
  </div>
}
