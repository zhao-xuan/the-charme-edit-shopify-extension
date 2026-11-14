import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const adminView = app.slice(
  app.indexOf('function isAdminView()'),
  app.indexOf('/** Covers the editor routes'),
)

function isAdminViewAt(location) {
  return vm.runInNewContext(`${adminView}\nisAdminView()`, {
    window: { location },
    URLSearchParams,
  })
}

test('storefront editor stays customer-facing with Shopify shop context', () => {
  assert.equal(isAdminViewAt({
    hostname: 'design.thecharmeedit.com',
    pathname: '/editor/',
    search: '?product=iphone-18-pro-max&shop=7ftyeu-0m.myshopify.com&variant=57172232536442',
    hash: '',
  }), false)
})

test('Shopify embedded and explicit admin routes still select the admin', () => {
  for (const location of [
    { hostname: 'design.thecharmeedit.com', pathname: '/', search: '?host=abc&shop=store.myshopify.com', hash: '' },
    { hostname: 'design.thecharmeedit.com', pathname: '/admin', search: '', hash: '' },
    { hostname: 'design.thecharmeedit.com', pathname: '/', search: '?admin', hash: '' },
    { hostname: 'admin.charme-customizer.pages.dev', pathname: '/', search: '', hash: '' },
  ]) {
    assert.equal(isAdminViewAt(location), true)
  }
})
