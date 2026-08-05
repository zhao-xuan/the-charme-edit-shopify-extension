import assert from 'node:assert/strict'
import test from 'node:test'

import { apiBaseFor, assetBaseFor, PROD_API_BASE } from './apiBase.js'

test('canonical production and local hosts use their same-origin API', () => {
  assert.equal(apiBaseFor('charme-customizer.pages.dev'), '')
  assert.equal(apiBaseFor('localhost'), '')
  assert.equal(apiBaseFor('127.0.0.1'), '')
})

test('Pages previews use the production Shopify-backed API', () => {
  assert.equal(apiBaseFor('4d54715d.charme-customizer.pages.dev'), PROD_API_BASE)
  assert.equal(apiBaseFor('canary-0729.charme-customizer.pages.dev'), PROD_API_BASE)
})

test('Pages previews load bundled assets from their deployment origin', () => {
  assert.equal(assetBaseFor('charme-customizer.pages.dev'), '')
  assert.equal(assetBaseFor('4d54715d.charme-customizer.pages.dev'), '')
  assert.equal(assetBaseFor('canary-0729.charme-customizer.pages.dev'), '')
})

test('storefronts load bundled assets from production Pages by default', () => {
  assert.equal(assetBaseFor('shop.example.com'), PROD_API_BASE)
})

test('an explicit API base remains authoritative', () => {
  assert.equal(apiBaseFor('preview.example.com', 'https://example.test/api/'), 'https://example.test/api')
  assert.equal(assetBaseFor('preview.example.com', 'https://example.test/api/'), 'https://example.test/api')
})