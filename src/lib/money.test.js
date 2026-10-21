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

test('uses Shopify contextual variant prices for the cart-matching presentment total', () => {
  const previousWindow = globalThis.window
  globalThis.window = {
    CharmeConfig: {
      locale: 'ja-JP',
      currency: { base: 'GBP', active: 'JPY', rate: 190.1 },
    },
  }

  try {
    const letter = { charmId: 'letter-a', price: 1, presentmentPrice: 300 }
    const product = { kind: 'phone', presentmentPrice: 5000 }
    const estimate = designPriceEstimate(product, [letter], [])
    assert.equal(estimate.rawCharmTotal, 300)
    assert.equal(estimate.total, 5300)

    const stones = Array.from({ length: 7 }, () => ({
      collection: 'Filling Stones',
      price: 99,
    }))
    const grouped = designPriceEstimate(
      { kind: 'phone', presentmentPrice: 5000 },
      stones,
      [{
        id: 'filling-stones',
        collection: 'Filling Stones',
        quantity: 6,
        price: 1.5,
        presentmentPrice: 1200,
      }],
    )
    assert.equal(grouped.rawCharmTotal, 2400)
    assert.equal(grouped.total, 7400)

    const tote = designPriceEstimate(
      { kind: 'tote', presentmentPrice: 5000 },
      Array.from({ length: 10 }, () => ({ charmId: 'patch', price: 1, presentmentPrice: 300 })),
      [],
      { applyToteDiscount: false },
    )
    assert.equal(tote.discountAmount, 0)
    assert.equal(tote.total, 8000)
  } finally {
    globalThis.window = previousWindow
  }
})