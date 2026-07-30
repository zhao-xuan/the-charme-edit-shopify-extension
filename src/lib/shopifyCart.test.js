import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchVariantDetails, resolvePricedVariant } from './shopifyVariant.js'

test('bounds a variant request that never responds', async () => {
  const startedAt = Date.now()
  const variant = await fetchVariantDetails('/variants/slow.js', {
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 15,
  })

  assert.equal(variant, null)
  assert.ok(Date.now() - startedAt < 250)
})

test('keeps a direct charm variant when its live price matches', async () => {
  const variants = {
    direct: { available: true, price: 200 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['direct', 'fallback'], 2, async (id) => variants[id]),
    'direct',
  )
})

test('rejects wrong-price direct mappings and uses a same-price fallback', async () => {
  const variants = {
    wrong: { available: true, price: 300 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['wrong', 'fallback'], 2, async (id) => variants[id]),
    'fallback',
  )
})

test('rejects unavailable and missing charm variants', async () => {
  const variants = {
    unavailable: { available: false, price: 200 },
    fallback: { available: true, price: 200 },
  }

  assert.equal(
    await resolvePricedVariant(['unavailable', 'missing', 'fallback'], 2, async (id) => variants[id]),
    'fallback',
  )
})