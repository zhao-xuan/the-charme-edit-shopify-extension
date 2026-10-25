import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCT_TEMPLATES, MATERIALS } from './templates.js'
import { blankDesign, normalizeDesign, normalizeTemplate, validateDesign, artworkSvg, beadMetrics } from './model.js'

test('every product category has a valid, distinct base template and a design surface', () => {
  assert.equal(PRODUCT_TEMPLATES.length, 19)
  assert.equal(new Set(PRODUCT_TEMPLATES.map((t) => t.id)).size, 19)
  for (const template of PRODUCT_TEMPLATES) {
    assert.ok(template.surfaces.length > 0, template.id)
    assert.equal(template.enabled, false)
    assert.deepEqual(normalizeDesign(blankDesign(template), template), blankDesign(template))
    assert.ok(validateDesign(blankDesign(template), template).errors.length > 0)
  }
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
