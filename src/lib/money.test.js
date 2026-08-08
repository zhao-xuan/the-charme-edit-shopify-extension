import test from 'node:test'
import assert from 'node:assert/strict'
import { convert, formatMoney } from './money.js'

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