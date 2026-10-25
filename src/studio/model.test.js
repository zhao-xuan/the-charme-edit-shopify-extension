import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCT_TEMPLATES, MATERIALS, WORKFLOWS, interactionFor } from './templates.js'
import { blankDesign, normalizeDesign, normalizeTemplate, validateDesign, artworkSvg, beadMetrics, productionPack } from './model.js'

test('every product category has a valid, distinct base template and a design surface', () => {
  assert.equal(PRODUCT_TEMPLATES.length, 25)
  assert.equal(new Set(PRODUCT_TEMPLATES.map((t) => t.id)).size, 25)
  assert.equal(WORKFLOWS.length, 5)
  assert.deepEqual(new Set(PRODUCT_TEMPLATES.map(interactionFor)),new Set(WORKFLOWS.map((w) => w.id)))
  for (const template of PRODUCT_TEMPLATES) {
    assert.ok(template.surfaces.length > 0, template.id)
    assert.equal(template.enabled, false)
    assert.deepEqual(normalizeDesign(blankDesign(template), template), blankDesign(template))
    assert.equal(validateDesign(blankDesign(template), template).valid,interactionFor(template)==='components')
  }
})

test('typing uses one fixed text area and rejects draggable artwork', () => {
  const template=PRODUCT_TEMPLATES.find((t) => t.id==='engraved-tag')
  const design=blankDesign(template)
  design.elements=[{id:'message',surfaceId:'front',type:'text',text:'Hello',font:'serif',color:'#263f38',x:500,y:500,widthMm:1,heightMm:1,rotation:90}]
  const normalized=normalizeDesign(design,template)
  assert.equal(normalized.elements[0].rotation,0)
  assert.equal(normalized.elements[0].x,template.surfaces[0].zone.x+template.surfaces[0].zone.width/2)
  assert.equal(validateDesign(normalized,template).valid,true)
  assert.throws(()=>normalizeDesign({...design,elements:[{...design.elements[0],type:'motif'}]},template),/编辑方式/)
  assert.throws(()=>normalizeDesign({...design,elements:[design.elements[0],{...design.elements[0],id:'another'}]},template),/一个内容位/)
})

test('fixed image replacement ignores client positions and disallows text', () => {
  const template=PRODUCT_TEMPLATES.find((t) => t.id==='photo-card')
  const design=blankDesign(template)
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  design.elements=[{id:'photo',surfaceId:'front',type:'image',src:png,x:999,y:999,widthMm:1,heightMm:1,rotation:45,color:'#263f38'}]
  const image=normalizeDesign(design,template).elements[0]
  assert.equal(image.rotation,0)
  assert.equal(image.widthMm,template.surfaces[0].zone.width)
  assert.equal(image.y,template.surfaces[0].zone.y+template.surfaces[0].zone.height/2)
  assert.throws(()=>normalizeDesign({...design,elements:[{...design.elements[0],type:'text',text:'bad'}]},template),/编辑方式/)
})

test('component slots are complete, fixed, and restricted to their options', () => {
  const template=PRODUCT_TEMPLATES.find((t) => t.id==='modular-bag')
  const design=blankDesign(template)
  assert.equal(validateDesign(design,template).valid,true)
  const moved={...design,elements:design.elements.map((e)=>({...e,x:999,rotation:30}))}
  const normalized=normalizeDesign(moved,template)
  assert.equal(normalized.elements[0].x,template.slots[0].x)
  assert.equal(normalized.elements[0].rotation,0)
  assert.throws(()=>normalizeDesign({...design,elements:design.elements.slice(1)},template),/组件位/)
  assert.throws(()=>normalizeDesign({...design,elements:design.elements.map((e,i)=>i===0?{...e,materialId:'plain-shell'}:e)},template),/组件与槽位/)
  assert.match(artworkSvg(design,template,'front'),/帆布提手/)
})

test('jewelry review includes an ordered parametric 3D recipe', () => {
  const template=PRODUCT_TEMPLATES.find((t)=>t.id==='pendant-necklace')
  const design=blankDesign(template)
  design.elements=[{id:'one',surfaceId:'sequence',type:'bead',materialId:'pearl',x:20,y:20,widthMm:8,heightMm:8,color:'#f3e7d4',rotation:0}]
  const pack=productionPack(normalizeDesign(design,template),template)
  assert.equal(pack.modelRecipe.type,'parametric-jewelry')
  assert.deepEqual(pack.modelRecipe.sequence.map((part)=>part.materialId),['pearl'])
  assert.match(pack.disclaimer,/不包含制造级 3D 网格/)
})

test('template activation requires merchant calibration', () => {
  const template = PRODUCT_TEMPLATES[0]
  assert.throws(() => normalizeTemplate({ ...template, enabled: true }), /先核对/)
  const calibrated = normalizeTemplate({ ...template, calibrated: true, enabled: true })
  assert.equal(calibrated.enabled, true)
  assert.throws(() => normalizeTemplate({ ...template, surfaces: [{ ...template.surfaces[0], zone: { x: 70, y: 1, width: 20, height: 20 } }] }), /设计面内/)
})

test('physical decoration placement rejects camera keepout and overlapping pieces', () => {
  const template = PRODUCT_TEMPLATES.find((t) => t.id === 'phone-charms')
  const motif = MATERIALS.find((m) => m.id === 'heart')
  const design = blankDesign(template)
  design.elements = [{ id: 'a', surfaceId: 'back', type: 'motif', materialId: motif.id, x: 22, y: 25, widthMm: motif.width, heightMm: motif.height, rotation: 0, color: motif.color }]
  assert.match(validateDesign(design, template).errors.join(' '), /禁区/)
  design.elements[0].x = 52
  design.elements[0].y = 90
  design.elements.push({ ...design.elements[0], id: 'b' })
  assert.match(validateDesign(design, template).errors.join(' '), /重叠/)
})

test('bead length and review SVG are computed from the submitted design', () => {
  const template = PRODUCT_TEMPLATES.find((t) => t.id === 'bead-bracelet')
  const design = blankDesign(template)
  design.elements = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, surfaceId: 'sequence', type: 'bead', materialId: 'pearl', x: 20, y: 20, widthMm: 8, heightMm: 8, rotation: 0, color: '#f3e7d4' }))
  assert.equal(beadMetrics(design, template).totalMm, 215)
  assert.match(validateDesign(design, template).errors.join(' '), /超出目标长度/)
  const print = PRODUCT_TEMPLATES.find((t) => t.id === 'poster-print')
  const art = blankDesign(print)
  art.name = '<script>alert(1)</script>'
  assert.match(artworkSvg(art, print, 'front'), /&lt;script&gt;/)
  assert.doesNotMatch(artworkSvg(art, print, 'front'), /<script>/)
})
