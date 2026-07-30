// Build the base-case variant map from the "custom-charm-phone-case" product,
// keyed "<modelSlug>:<gel>" so cart mode can resolve model × gel → variant id.
// Bundled into the widget so the merchant needs no variant map for the base.
// Output: shopify/widget/variantmap-products.generated.json
import { writeFileSync } from 'fs'

const HANDLE = 'custom-charm-phone-case'
const STORE = 'thecharmeedit.com'

const productUrl = `https://${STORE}/products/${HANDLE}`
const productHtml = await fetch(productUrl, {
  headers: {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': 'Mozilla/5.0 (compatible; CharmeVariantMapBuilder/1.0)',
  },
}).then((res) => {
  if (!res.ok) throw new Error(`Could not load ${productUrl} (${res.status})`)
  return res.text()
})
const storefrontToken = /<meta\s+name=["']shopify-checkout-api-token["']\s+content=["']([^"']+)/i.exec(productHtml)?.[1]
if (!storefrontToken) throw new Error('Could not find the public Storefront API token')

const query = `
  query ProductVariants($handle: String!, $cursor: String) {
    product(handle: $handle) {
      handle
      variants(first: 250, after: $cursor) {
        nodes {
          id
          availableForSale
          selectedOptions { name value }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

const variants = []
let cursor = null
let productHandle = HANDLE
do {
  const res = await fetch(`https://${STORE}/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken,
    },
    body: JSON.stringify({ query, variables: { handle: HANDLE, cursor } }),
  })
  const body = await res.json()
  if (!res.ok || body.errors || !body.data?.product) {
    throw new Error(`Could not load complete Shopify variants: ${JSON.stringify(body.errors || body)}`)
  }
  productHandle = body.data.product.handle
  const connection = body.data.product.variants
  variants.push(...connection.nodes)
  cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null
} while (cursor)

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
  return s
    .replace(/\+/g, ' plus ')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const products = {}
for (const variant of variants) {
  const options = Object.fromEntries(variant.selectedOptions.map(({ name, value }) => [name, value]))
  if (!variant.availableForSale || options['Would you like a pop socket?']?.trim().toLowerCase() !== 'no') continue
  const gel = gelOf(options['Case & Gel Colour'] || '')
  const slug = slugOf(options['Phone Model'] || '')
  const id = Number(variant.id.split('/').pop())
  products[`${slug}:${gel}`] = id
}

writeFileSync('shopify/widget/variantmap-products.generated.json', JSON.stringify(products, null, 2) + '\n')
console.log('base product handle:', productHandle, '| variants:', variants.length)
console.log('wrote shopify/widget/variantmap-products.generated.json with', Object.keys(products).length, 'keys')
console.log('sample:', Object.entries(products).slice(0, 6).map(([k, v]) => `${k}=${v}`).join('  '))
console.log('iphone-16-pro-max keys:', Object.keys(products).filter((k) => k.startsWith('iphone-16-pro-max')).map((k) => k + '=' + products[k]).join('  '))
