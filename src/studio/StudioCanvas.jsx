import { useRef } from 'react'
import { MATERIALS } from './templates.js'
import { motifMarkup } from './model.js'

export function ProductOutline({surface,fill='#f4eadd'}) {
  const w=surface.widthMm,h=surface.heightMm,shape=surface.shape
  if (['hoop','pendant'].includes(shape)) return <ellipse cx={w/2} cy={h/2} rx={w/2-1} ry={h/2-1} fill={fill} stroke="#b5a78e" strokeWidth="1"/>
  return <g>
    <rect x="0.5" y="0.5" width={w-1} height={h-1} rx={shape==='phone'?9:shape==='tag'?7:shape==='pouch'?10:3} fill={fill} stroke="#b5a78e" strokeWidth="1"/>
    {shape==='pouch' && <path d={`M5 10H${w-5}`} stroke="#b5a78e" strokeDasharray="2 2"/>}
    {shape==='bag' && <path d={`M${w*.25} 8Q${w*.5} ${h*.25} ${w*.75} 8`} fill="none" stroke="#b5a78e" strokeWidth="2"/>}
    {shape==='shirt' && <path d={`M${w*.35} 2Q${w*.5} ${h*.12} ${w*.65} 2M${w*.15} 5L${w*.15} ${h*.25}M${w*.85} 5L${w*.85} ${h*.25}`} fill="none" stroke="#b5a78e"/>}
    {shape==='book' && <path d={`M12 2V${h-2}`} stroke="#b5a78e"/>}
    {shape==='wrap' && <path d={`M${w*.5} 0V${h}`} stroke="#b5a78e" strokeDasharray="2 4"/>}
    {shape==='beads' && <path d={`M5 ${h/2}H${w-5}`} stroke="#b5a78e"/>}
  </g>
}

export function ElementArtwork({element}) {
  const e=element
  if (e.type==='text') {
    const lines=String(e.text).split('\n')
    const fontSize=Math.min(e.heightMm/Math.max(1,lines.length)*.8,e.widthMm/Math.max(5,...lines.map((line) => line.length)) * 1.6)
    return <text textAnchor="middle" fontFamily={e.font} fontSize={fontSize} fill={e.color}>{lines.map((line,i) => <tspan key={i} x="0" y={(i-(lines.length-1)/2)*fontSize*1.2+fontSize*.35}>{line}</tspan>)}</text>
  }
  if (e.type==='image') return <image href={e.src} x={-e.widthMm/2} y={-e.heightMm/2} width={e.widthMm} height={e.heightMm} preserveAspectRatio="xMidYMid slice"/>
  if (e.type==='component') {
    const w=e.widthMm,h=e.heightMm
    if (e.slotId==='handle') return <g fill="none" stroke={e.color} strokeWidth={Math.max(4,h*.38)} strokeLinecap="round"><path d={`M${-w*.43} ${h*.28} Q0 ${-h*.85} ${w*.43} ${h*.28}`}/></g>
    if (e.slotId==='pocket') return <g><rect x={-w/2} y={-h/2} width={w} height={h} rx={Math.min(w,h)*.1} fill={e.color}/>{e.materialId==='quilted-pocket'&&<path d={`M${-w/2} 0L0 ${-h/2}L${w/2} 0L0 ${h/2}Z`} fill="none" stroke="#eee6d9" strokeWidth="2"/>}</g>
    if (e.slotId==='shell') return <rect x={-w/2} y={-h/2} width={w} height={h} rx="8" fill={e.color}/>
    return <g><circle r={Math.min(w,h)*.44} fill={e.color}/><circle r={Math.min(w,h)*.27} fill="none" stroke="#fff8eb" strokeWidth="1.5"/></g>
  }
  const shape=MATERIALS.find((m) => m.id===e.materialId)?.shape
  return <g transform={`scale(${e.widthMm/24} ${e.heightMm/24})`} fill={e.color} dangerouslySetInnerHTML={{__html:motifMarkup(shape)}}/>
}

export default function StudioCanvas({template,document,surfaceId,selected,onSelect,onMove,onDragStart,invalidIds=[],readOnly=false,mini=false}) {
  const svg=useRef(null),drag=useRef(null)
  const s=template.surfaces.find((surface) => surface.id===surfaceId) || template.surfaces[0]
  const items=document.elements.filter((e) => e.surfaceId===s.id)
  const point=(event) => {
    const p=svg.current.createSVGPoint();p.x=event.clientX;p.y=event.clientY
    return p.matrixTransform(svg.current.getScreenCTM().inverse())
  }
  const isBeads=template.process==='beads'
  return <svg ref={svg} viewBox={`-8 -8 ${s.widthMm+16} ${s.heightMm+16}`} className={`studio-canvas ${mini?'studio-canvas--mini':''}`} role="img" aria-label={`${template.name} · ${s.name}设计预览`}>
    <ProductOutline surface={s} fill={document.color}/>
    {!mini && !isBeads && <rect x={s.zone.x} y={s.zone.y} width={s.zone.width} height={s.zone.height} fill="none" stroke="#87a797" strokeWidth="0.7" strokeDasharray="3 2" pointerEvents="none"/>}
    {s.keepouts.map((r,i) => <g key={i} pointerEvents="none"><rect x={r.x} y={r.y} width={r.width} height={r.height} rx="2" fill="#b69c8b" opacity="0.3" stroke="#9a6558" strokeDasharray="2 2"/>{!mini && <text x={r.x+r.width/2} y={r.y+r.height/2} fontSize={Math.min(5,r.width/6)} textAnchor="middle" fill="#714b40">{r.label}</text>}</g>)}
    {items.map((e,index) => {
      const x=isBeads ? 10+items.slice(0,index).reduce((n,b) => n+b.widthMm,0)+e.widthMm/2 : e.x
      const y=isBeads ? s.heightMm/2 : e.y
      return <g key={e.id} transform={`translate(${x} ${y}) rotate(${e.rotation})`} tabIndex={readOnly||mini?-1:0} role="button" aria-label={`选择${e.text || MATERIALS.find((m) => m.id===e.materialId)?.name || '图像'}`}
        style={{cursor:readOnly?'default':isBeads?'pointer':'grab',touchAction:'none'}}
        onPointerDown={(event) => {
          if (readOnly || mini) return
          event.preventDefault();event.stopPropagation();onSelect?.(e.id)
          if (isBeads) return
          onDragStart?.();const p=point(event);drag.current={id:e.id,dx:p.x-e.x,dy:p.y-e.y};event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {if(drag.current?.id===e.id){const p=point(event);onMove?.(e.id,p.x-drag.current.dx,p.y-drag.current.dy)}}}
        onPointerUp={() => {drag.current=null}} onPointerCancel={() => {drag.current=null}}
        onKeyDown={(event) => {
          if (readOnly || mini) return
          if (event.key==='Enter'||event.key===' ') {event.preventDefault();onSelect?.(e.id)}
          const step=event.altKey ? 0.1 : 1,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key]
          if(delta&&!isBeads){event.preventDefault();onDragStart?.();onMove?.(e.id,e.x+delta[0],e.y+delta[1])}
        }}>
        <rect x={-e.widthMm/2-1} y={-e.heightMm/2-1} width={e.widthMm+2} height={e.heightMm+2} fill="transparent" stroke={invalidIds.includes(e.id)?'#c45247':selected===e.id?'#2b6651':'none'} strokeWidth=".7" strokeDasharray="2 1"/>
        <ElementArtwork element={e}/>
      </g>
    })}
  </svg>
}
