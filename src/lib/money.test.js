import test from 'node:test'
import assert from 'node:assert/strict'
import { convert, designPriceEstimate, formatMoney } from './money.js'

test('design totals round each charged unit before summing and discounting', () => {
  const previousWindow = globalThis.window
  globalThis.window = { CharmeConfig: { currency: { base: 'GBP', active: 'USD', rate: 37 / 26.99 } } }
  try {
    const charms = Array.from({ length: 10 }, () => ({ charmId: 'letter-a', price: 1 }))
    assert.equal(designPriceEstimate({ kind: 'phone', presentmentPrice: 37 }, charms, []).total, 57)
    const tote = designPriceEstimate({ kind: 'tote', presentmentPrice: 44 }, charms, [])
    assert.equal(tote.discountAmount, 4)
    assert.equal(tote.total, 60)
    const stones = Array.from({ length: 7 }, () => ({ collection: 'Filling Stones', price: 99 }))
    assert.equal(designPriceEstimate({ kind: 'phone', presentmentPrice: 37 }, stones).rawCharmTotal, 6)
    const bundles = charms.map((charm) => ({ ...charm, bundle: true }))
    assert.equal(designPriceEstimate({ kind: 'phone', presentmentPrice: 37 }, bundles, []).total, 39)
  } finally {
    globalThis.window = previousWindow
  }
})

test('formats catalogue GBP prices in the Shopify Markets presentment currency', () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    CharmeConfig: {
      locale: 'en-US',
      currency: { base: 'GBP', active: 'USD', rate: 1.25 },
    },
  }

  try {
    assert.equal(convert(16), 20)
    assert.equal(formatMoney(16), '$20.00')
    assert.equal(formatMoney(24, { whole: true }), '$30.00')
  } finally {
    globalThis.window = previousWindow
  }
})

test('rounds every converted price up to a whole presentment-currency unit', () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    CharmeConfig: {
      locale: 'en-US',
      currency: { base: 'GBP', active: 'USD', rate: 1.3765716 },
    },
  }

  try {
    assert.equal(convert(1), 2)
    assert.equal(formatMoney(1), '$2.00')
    assert.equal(formatMoney(1, { whole: true }), '$2.00')
  } finally {
    globalThis.window = previousWindow
  }
})

test('rounds zero-decimal currencies up to the next whole unit', () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    CharmeConfig: {
      locale: 'ja-JP',
      currency: { base: 'GBP', active: 'JPY', rate: 190.1 },
    },
  }

  try {
    assert.equal(convert(1.01), 193)
    assert.equal(formatMoney(1.01), '￥193')
  } finally {
    globalThis.window = previousWindow
  }
})