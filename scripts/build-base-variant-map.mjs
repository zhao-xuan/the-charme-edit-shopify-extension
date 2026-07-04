// Build the base-case variant map from the "custom-charm-phone-case" product,
// keyed "<modelSlug>:<gel>" so cart mode can resolve model × gel → variant id.
// Bundled into the widget so the merchant needs no variant map for the base.
// Output: shopify/widget/variantmap-products.generated.json
import { writeFileSync } from 'fs'

const HANDLE = 'custom-charm-phone-case'
const STORE = 'thecharmeedit.com'

const res = await fetch(`https://${STORE}/products/${HANDLE}.js`)
const p = await res.json()

const gelOf = (caseGel) => {
  const s = caseGel.toLowerCase()
  if (/glitter/.test(s)) return 'glitter'
  if (/white gel/.test(s)) return 'white'
  if (/black/.test(s)) return 'black'
  return 'white'
}
const slugOf = (model) => {
  const s = model.trim().toLowerCase()
  if (/^any other/.test(s)) return 'other'
  return s.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

const products = {}
for (const v of p.variants) {
  const gel = gelOf(v.option1 || '')
  const slug = slugOf(v.option2 || '')
  products[`${slug}:${gel}`] = v.id
}

writeFileSync('shopify/widget/variantmap-products.generated.json', JSON.stringify(products, null, 2) + '\n')
console.log('base product handle:', p.handle, '| variants:', p.variants.length)
console.log('wrote shopify/widget/variantmap-products.generated.json with', Object.keys(products).length, 'keys')
console.log('sample:', Object.entries(products).slice(0, 6).map(([k, v]) => `${k}=${v}`).join('  '))
console.log('iphone-16-pro-max keys:', Object.keys(products).filter((k) => k.startsWith('iphone-16-pro-max')).map((k) => k + '=' + products[k]).join('  '))
