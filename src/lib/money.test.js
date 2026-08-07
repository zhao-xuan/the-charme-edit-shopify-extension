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
    assert.equal(formatMoney(24, { whole: true }), '$30')
  } finally {
    globalThis.window = previousWindow
  }
})