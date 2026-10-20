import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createDesignLink } from './designLink.js'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const decoder = app.slice(app.indexOf('function decodeEditorLayout('), app.indexOf('function editorEditState('))
const decode = (encoded) => vm.runInNewContext(`${decoder}\ndecodeEditorLayout(encoded)`, {
  encoded, atob, Uint8Array, TextDecoder,
})

for (const kind of ['phone', 'tote', 'frame']) {
  test(`${kind} backup link restores exact layout and market without cart replacement`, () => {
    const placed = ['front', 'back'].slice(0, kind === 'tote' ? 2 : 1).map((toteSide, index) => ({
      charmId: `letter-${index}`,
      name: '字母 é',
      src: '/assets/letter.png',
      baseWmm: 8,
      baseHmm: 10,
      cxMm: 20.125,
      cyMm: 30.625,
      rot: 37,
      scale: 1.25,
      toteSide,
      groupId: 'word-1',
      groupLabel: 'AB',
    }))
    const wordGroups = [{ id: 'word-1', label: 'AB', broken: false }]
    const url = new URL(createDesignLink({
      product: { id: `${kind}-model` },
      color: { caseId: 'black', gelId: 'white' },
      placed,
      wordGroups,
      sourceUrl: 'https://thecharmeedit.com/products/example?country=JP&currency=JPY&currency_rate=190&variant=123&seed=1#charme_edit_token=old',
    }))
    assert.equal(url.origin, 'https://charme-customizer.pages.dev')
    assert.equal(url.pathname, '/editor/')
    assert.equal(url.searchParams.get('country'), 'JP')
    assert.equal(url.searchParams.get('currency'), 'JPY')
    assert.equal(url.searchParams.get('product'), `${kind}-model`)
    assert.equal(url.searchParams.get('cart_bridge'), '1')
    assert.equal(url.searchParams.has('variant'), false)
    assert.equal(url.searchParams.has('seed'), false)
    const hash = new URLSearchParams(url.hash.slice(1))
    assert.equal(hash.has('charme_edit_token'), false)
    const restored = decode(hash.get('charme_layout'))
    assert.equal(restored.productId, `${kind}-model`)
    assert.equal(restored.caseColourId, 'black')
    assert.equal(restored.gelColourId, 'white')
    assert.equal(restored.charms.length, placed.length)
    assert.equal(restored.charms[0].name, '字母 é')
    assert.equal(restored.charms[0].cxMm, 20.125)
    assert.equal(restored.charms[0].cyMm, 30.625)
    assert.equal(restored.charms[0].rot, 37)
    assert.equal(restored.charms[0].scale, 1.25)
    assert.equal(restored.charms[0].wMm, 8)
    assert.equal(restored.charms[0].groupId, 'word-1')
    assert.equal(restored.wordGroups[0].label, wordGroups[0].label)
    if (kind === 'tote') assert.equal(restored.charms[1].toteSide, 'back')
  })
}

test('embedded widget links forward configured market and fail explicitly above the restore size limit', () => {
  const input = {
    product: { id: 'frame-5x7' },
    color: { id: 'white' },
    placed: [],
    sourceUrl: 'https://thecharmeedit.com/products/frame',
    config: { country: 'US', currency: { active: 'USD' }, locale: 'en' },
  }
  const url = new URL(createDesignLink(input))
  assert.equal(url.searchParams.get('country'), 'US')
  assert.equal(url.searchParams.get('currency'), 'USD')
  assert.equal(url.searchParams.get('locale'), 'en')
  assert.throws(() => createDesignLink({
    ...input, placed: [{ name: 'a'.repeat(120000) }],
  }), /too large/)
})
