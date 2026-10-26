import { MATERIALS, PROCESSES, templateById, interactionFor } from './templates.js'
import { normalizeCatalogLayout } from './catalogLayout.js'

export const SCHEMA_VERSION = 1
export const MAX_DESIGN_BYTES = 900_000
export const FONT_FAMILIES = ['sans-serif', 'serif', 'monospace']
const text = (v, max = 120) => String(v ?? '').trim().slice(0, max)
const finite = (v, min, max, fallback) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : fallback
const color = (v, fallback = '#263f38') => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback
const ident = (v) => /^[a-zA-Z0-9_-]{1,80}$/.test(v || '')
const clone = (value) => JSON.parse(JSON.stringify(value))

export function normalizeTemplate(raw) {
  const base = templateById(raw?.id)
  if (!base) throw new Error('请选择已有商品品类。')
  const result = clone(base)
  result.interaction = base.interaction
  result.slots = clone(base.slots || [])
  result.catalogLayout = normalizeCatalogLayout(base, raw.catalogLayout)
  result.name = text(raw.name || base.name, 80)
  result.description = text(raw.description || base.description, 300)
  result.enabled = raw.enabled === true
  result.calibrated = raw.calibrated === true
  result.material = text(raw.material || base.material, 80)
  result.productionNotes = text(raw.productionNotes, 1000)
  result.finish = color(raw.finish, base.finish)
  result.maxElements = finite(raw.maxElements, 1, 120, base.maxElements)
  result.minDpi = finite(raw.minDpi, 72, 600, base.minDpi)
  result.minFeatureMm = finite(raw.minFeatureMm, 0.2, 20, base.minFeatureMm)
  result.maxTextLength = finite(raw.maxTextLength, 1, 120, base.maxTextLength)
  if (base.process === 'beads') {
    result.circumferenceMm = finite(raw.circumferenceMm, 80, 1000, base.circumferenceMm)
    result.claspMm = finite(raw.claspMm, 0, 100, base.claspMm)
    if (result.claspMm >= result.circumferenceMm) throw new Error('扣件长度必须小于成品长度。')
  }
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length !== base.surfaces.length) throw new Error('请保留此品类的全部设计面。')
  result.surfaces = base.surfaces.map((original) => {
    const s = raw.surfaces.find((row) => row.id === original.id)
    if (!s) throw new Error('设计面不完整。')
    const widthMm = finite(s.widthMm, 20, 1500, null), heightMm = finite(s.heightMm, 20, 1500, null)
    if (!widthMm || !heightMm) throw new Error('尺寸须在 20–1500 mm 之间。')
    const rect = (r) => {
      const x = finite(r?.x, 0, widthMm, null), y = finite(r?.y, 0, heightMm, null)
      const width = finite(r?.width, 0.1, widthMm, null), height = finite(r?.height, 0.1, heightMm, null)
      if ([x, y, width, height].includes(null) || x + width > widthMm + 0.001 || y + height > heightMm + 0.001) throw new Error('可定制区域 / 禁区必须位于设计面内。')
      return { x, y, width, height }
    }
    if (!Array.isArray(s.keepouts) || s.keepouts.length > 20) throw new Error('每个设计面最多 20 个禁区。')
    return { ...original, name: text(s.name || original.name, 40), widthMm, heightMm,
      zone: rect(s.zone), keepouts: s.keepouts.map((r) => ({ ...rect(r), label: text(r.label, 40) })) }
  })
  if (result.enabled && !result.calibrated) throw new Error('请先核对实物尺寸、材料和禁区，再开放制作申请。')
  return result
}

export function blankDesign(template) {
  const components = interactionFor(template) === 'components' ? (template.slots || []).map((slot) => ({
    id:`slot-${slot.id}`, surfaceId:slot.surfaceId, type:'component', slotId:slot.id,
    materialId:slot.defaultMaterialId, x:slot.x, y:slot.y, widthMm:slot.widthMm,
    heightMm:slot.heightMm, rotation:0, color:MATERIALS.find((m) => m.id===slot.defaultMaterialId)?.color || '#263f38',
  })) : []
  return { schemaVersion: SCHEMA_VERSION, templateId: template.id, templateVersion: template.version,
    name: `${template.name}设计`, color: template.finish, elements: components, notes: '', threadColor: template.threadColors[0] }
}

// Customer art is flattened PNG only. Read dimensions from the bytes, never from client metadata.
export function pngInfo(src) {
  if (typeof src !== 'string' || src.length > 350_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) throw new Error('图片须为小于 260 KB 的 PNG。')
  let bin
  try { bin = atob(src.slice(22)) } catch { throw new Error('图片编码无效。') }
  if (bin.length < 45 || bin.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bin.slice(12, 16) !== 'IHDR') throw new Error('PNG 图片无效。')
  const uint = (at) => ((bin.charCodeAt(at) * 0x1000000) + (bin.charCodeAt(at + 1) << 16) + (bin.charCodeAt(at + 2) << 8) + bin.charCodeAt(at + 3))
  const width = uint(16), height = uint(20)
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('图片像素超出支持范围。')
  return { width, height }
}

export function normalizeDesign(raw, template) {
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION || raw.templateId !== template.id) throw new Error('设计版本或品类不匹配。')
  if (raw.templateVersion !== template.version) throw new Error('模板已更新，请重新载入模板后创建新设计。')
  if (!Array.isArray(raw.elements) || raw.elements.length > template.maxElements) throw new Error(`此模板最多 ${template.maxElements} 个元素。`)
  const interaction = interactionFor(template)
  const allowed = { typography:['text'], imageSwap:['image'], jewelry3d:['bead'], components:['component'] }[interaction]
  if (allowed && raw.elements.some((e) => !allowed.includes(e.type))) throw new Error('此编辑方式不支持该元素。')
  if (['typography','imageSwap'].includes(interaction) && new Set(raw.elements.map((e) => e.surfaceId)).size !== raw.elements.length) throw new Error('每个设计面只能有一个内容位。')
  if (interaction === 'components' && (raw.elements.length !== (template.slots || []).length || new Set(raw.elements.map((e) => e.slotId)).size !== raw.elements.length)) throw new Error('请为每个组件位选择一种部件。')
  const ids = new Set()
  const elements = raw.elements.map((e) => {
    if (!ident(e.id) || ids.has(e.id)) throw new Error('元素标识重复或无效。')
    ids.add(e.id)
    const surface = template.surfaces.find((s) => s.id === e.surfaceId)
    if (!surface || !PROCESSES[template.process].accepts.includes(e.type)) throw new Error('此工艺不支持该元素或设计面。')
    const material = MATERIALS.find((m) => m.id === e.materialId)
    if (['motif', 'bead', 'component'].includes(e.type) && (!material || !material.processes.includes(template.process))) throw new Error('材料不适用于此工艺。')
    const slot = interaction === 'components' ? (template.slots || []).find((s) => s.id === e.slotId && s.surfaceId === e.surfaceId) : null
    if (interaction === 'components' && (!slot || !slot.choices.includes(e.materialId))) throw new Error('组件与槽位不匹配。')
    const fixed = ['assembly', 'patch', 'beads'].includes(template.process)
    const zone = surface.zone
    const widthMm = slot ? slot.widthMm : interaction === 'imageSwap' ? zone.width : interaction === 'typography' ? zone.width * .72 : fixed ? material.width : finite(e.widthMm, 0.5, 1500, null)
    const heightMm = slot ? slot.heightMm : interaction === 'imageSwap' ? zone.height : interaction === 'typography' ? Math.min(zone.height * .45, 34) : fixed ? material.height : finite(e.heightMm, 0.5, 1500, null)
    const x = slot ? slot.x : ['typography','imageSwap'].includes(interaction) ? zone.x+zone.width/2 : finite(e.x, -1500, 3000, null)
    const y = slot ? slot.y : ['typography','imageSwap'].includes(interaction) ? zone.y+zone.height/2 : finite(e.y, -1500, 3000, null)
    const rotation = finite(e.rotation, -360, 360, 0)
    if ([x, y, widthMm, heightMm].includes(null)) throw new Error('元素位置或尺寸无效。')
    const out = { id: e.id, surfaceId: e.surfaceId, type: e.type, x, y, widthMm, heightMm, rotation: interaction === 'placement' ? rotation : 0,
      color: color(e.color, material?.color), ...(material ? { materialId: material.id } : {}) }
    if (slot) out.slotId = slot.id
    if (e.type === 'text') {
      if (!String(e.text || '').trim() || [...String(e.text)].length > template.maxTextLength) throw new Error(`文字须为 1–${template.maxTextLength} 个字符。`)
      out.text = text(e.text, 240)
      out.font = FONT_FAMILIES.includes(e.font) ? e.font : 'sans-serif'
    }
    if (e.type === 'image') { out.pixels = pngInfo(e.src); out.src = e.src }
    return out
  })
  const document = { ...blankDesign(template), name: text(raw.name || template.name, 80), notes: text(raw.notes, 1000),
    color: color(raw.color, template.finish), threadColor: color(raw.threadColor, template.threadColors[0]), elements }
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_DESIGN_BYTES) throw new Error('设计文件过大，请减少图片。')
  return document
}

function bounds(e) {
  const a = e.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  const points = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => ({ x: e.x + x*e.widthMm/2*c-y*e.heightMm/2*s, y: e.y+x*e.widthMm/2*s+y*e.heightMm/2*c }))
  return { points, x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)),
    right: Math.max(...points.map((p) => p.x)), bottom: Math.max(...points.map((p) => p.y)) }
}
const intersects = (a, b) => a.x < b.right - 0.01 && a.right > b.x + 0.01 && a.y < b.bottom - 0.01 && a.bottom > b.y + 0.01

export function beadMetrics(document, template) {
  const beadsMm = document.elements.reduce((sum, e) => sum + (MATERIALS.find((m) => m.id === e.materialId)?.width || 0), 0)
  return { beadsMm, claspMm: template.claspMm, totalMm: beadsMm + template.claspMm,
    remainingMm: template.circumferenceMm - beadsMm - template.claspMm }
}

export function validateDesign(document, template) {
  const errors = [], warnings = [], invalidIds = new Set()
  const issue = (e, msg) => { errors.push(msg); if (e) invalidIds.add(e.id) }
  const interaction = interactionFor(template)
  if (document.elements.length < template.minElements) errors.push('请至少添加一个设计元素。')
  if (interaction === 'components' && document.elements.length !== (template.slots || []).length) errors.push('请为每个组件位选择部件。')
  if (template.process === 'beads') {
    const metrics = beadMetrics(document, template)
    if (metrics.remainingMm < 0) errors.push(`珠串与扣件超出目标长度 ${Math.abs(metrics.remainingMm).toFixed(1)} mm。`)
    else if (metrics.remainingMm > 12) warnings.push(`还有 ${metrics.remainingMm.toFixed(1)} mm 留白，制作方需确认排布与线长。`)
  } else {
    const placed = []
    for (const e of document.elements) {
      const surface = template.surfaces.find((s) => s.id === e.surfaceId)
      if (!surface) { issue(e, '设计面不存在。'); continue }
      const b = bounds(e), z = surface.zone
      if (b.x < z.x-0.01 || b.y < z.y-0.01 || b.right > z.x+z.width+0.01 || b.bottom > z.y+z.height+0.01) issue(e, `${surface.name}有元素超出安全区域。`)
      if (['hoop', 'pendant'].includes(surface.shape) && b.points.some((p) => ((p.x-surface.widthMm/2)/(surface.widthMm/2))**2+((p.y-surface.heightMm/2)/(surface.heightMm/2))**2 > 1)) issue(e, `${surface.name}有元素超出圆形边界。`)
      if (surface.keepouts.some((r) => intersects(b, { x:r.x,y:r.y,right:r.x+r.width,bottom:r.y+r.height }))) issue(e, `${surface.name}有元素进入禁区。`)
      if (interaction !== 'components' && !PROCESSES[template.process].overlap && placed.some((p) => p.surfaceId === e.surfaceId && intersects(b,p.bounds))) issue(e, `${surface.name}实体元素有重叠，请留出制作间距。`)
      placed.push({ surfaceId:e.surfaceId, bounds:b })
      if (Math.min(e.widthMm,e.heightMm) < template.minFeatureMm) issue(e,'元素小于此工艺允许的最小细节。')
      if (e.type === 'image') {
        const dpi = Math.min(e.pixels.width/e.widthMm,e.pixels.height/e.heightMm)*25.4
        if (dpi < template.minDpi) issue(e, `图片有效分辨率 ${Math.round(dpi)} DPI，低于 ${template.minDpi} DPI；请缩小图片或更换清晰原图。`)
      }
      if (e.type === 'text' && e.heightMm / Math.max(1, String(e.text).split('\n').length) < template.minFeatureMm) issue(e,'文字高度小于工艺要求。')
    }
  }
  if (template.deferred.length) warnings.push(...template.deferred.map((s) => `${s}尚未自动生成，需制作方审核。`))
  return { errors:[...new Set(errors)], warnings:[...new Set(warnings)], invalidIds:[...invalidIds], valid:errors.length === 0 }
}

export function billOfMaterials(document, template) {
  const rows = new Map()
  for (const e of document.elements) {
    const mat = MATERIALS.find((m) => m.id === e.materialId)
    const key = `${e.surfaceId}:${e.materialId || e.type}:${e.color}`
    const row = rows.get(key) || { key, surface:template.surfaces.find((s) => s.id === e.surfaceId)?.name,
      material:mat?.name || (e.type === 'text' ? '文字' : '客户图像'), color:e.color, quantity:0 }
    row.quantity++
    rows.set(key,row)
  }
  return [...rows.values()]
}

const escapeXml = (value) => String(value).replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
export function artworkSvg(document, template, surfaceId) {
  const s = template.surfaces.find((surface) => surface.id === surfaceId)
  const elements = document.elements.filter((e) => e.surfaceId === s.id).map((e,index) => {
    const x = template.process === 'beads' ? 10 + document.elements.slice(0,index).reduce((n,b) => n+b.widthMm,0)+e.widthMm/2 : e.x
    const y = template.process === 'beads' ? s.heightMm/2 : e.y
    const fill = escapeXml(e.color), w = e.widthMm, h = e.heightMm
    let shape = `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${Math.min(w,h)/4}" fill="${fill}"/>`
    if (e.type === 'text') {
      const lines=String(e.text).split('\n'),fontSize=Math.min(h/Math.max(1,lines.length)*.8,w/Math.max(5,...lines.map((line) => line.length))*1.6)
      shape = `<text text-anchor="middle" font-family="${e.font}" font-size="${fontSize}" fill="${fill}">${lines.map((line,i) => `<tspan x="0" y="${(i-(lines.length-1)/2)*fontSize*1.2+fontSize*.35}">${escapeXml(line)}</tspan>`).join('')}</text>`
    }
    else if (e.type === 'image') shape = `<image x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${escapeXml(e.src)}"/>`
    else if (e.type === 'component') shape = `<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="${Math.min(w,h)/5}" fill="${fill}" stroke="#ffffff" stroke-width="0.8"/><text y="3" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(9,w/7)}" fill="#263f38">${escapeXml(MATERIALS.find((m) => m.id===e.materialId)?.name || '部件')}</text>`
    else shape = `<g transform="scale(${w/24} ${h/24})" fill="${fill}">${motifMarkup(MATERIALS.find((m) => m.id === e.materialId)?.shape)}</g>`
    return `<g transform="translate(${x} ${y}) rotate(${e.rotation})">${shape}</g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.widthMm}mm" height="${s.heightMm}mm" viewBox="0 0 ${s.widthMm} ${s.heightMm}"><title>${escapeXml(document.name)} — ${escapeXml(s.name)} — REVIEW ONLY</title><desc>Design review artwork. Fonts are not outlined. Not a certified machine or print file.</desc>${elements}</svg>`
}
export function motifMarkup(shape) {
  if (shape === 'heart') return '<path d="M0 10C-18 0-11-15 0-5C11-15 18 0 0 10Z"/>'
  if (shape === 'star') return '<path d="M0-12 3.5-4 12-4 5 2 7.5 11 0 6-7.5 11-5 2-12-4-3.5-4Z"/>'
  if (shape === 'flower') return '<path d="M0-5C-10-18-18-5-7 0C-20 9-5 17 0 7C6 19 19 8 7 0C20-7 7-18 0-5Z"/>'
  return '<circle r="11"/>'
}

export function productionPack(document, template) {
  return { format:'charme-production-review', version:1, disclaimer:'制作审核资料；包含参数化首饰预览配方，不包含制造级 3D 网格、刺绣机器文件、字体转曲、刀路或经供应商认证的印刷原稿。',
    document:clone(document), template:clone(template), validation:validateDesign(document,template),
    materials:billOfMaterials(document,template), ...(template.process === 'beads' ? {length:beadMetrics(document,template)} : {}),
    ...(interactionFor(template) === 'jewelry3d' ? { modelRecipe: { type:'parametric-jewelry', shape:template.id==='bead-bracelet'?'bracelet':'necklace', sequence:document.elements.map((e) => ({ materialId:e.materialId, diameterMm:e.widthMm, color:e.color })), claspMm:template.claspMm, targetLengthMm:template.circumferenceMm } } : {}),
    surfaces:template.surfaces.map((s) => ({ id:s.id,name:s.name,svg:artworkSvg(document,template,s.id) })) }
}
