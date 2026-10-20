import { serializeCharms } from './designDrafts.js'

export function createDesignLink({ product, color, placed, wordGroups = [], sourceUrl, config = {} }) {
  const source = new URL(sourceUrl)
  const url = new URL('/editor/', 'https://charme-customizer.pages.dev')
  for (const key of ['country', 'currency', 'currency_rate', 'locale', 'cart_url', 'return_to']) {
    const value = source.searchParams.get(key)
    if (value) url.searchParams.set(key, value)
  }
  for (const [key, value] of Object.entries({
    country: config.country,
    currency: config.currency?.active,
    locale: config.locale,
  })) {
    if (!url.searchParams.has(key) && value) url.searchParams.set(key, value)
  }
  url.searchParams.set('product', product.id)
  url.searchParams.set('case', color.caseId || color.id)
  if (color.gelId) url.searchParams.set('gel', color.gelId)
  url.searchParams.set('cart_bridge', '1')

  const layout = {
    product: {
      id: product.id,
      colorId: color.caseId || color.id,
      gelId: color.gelId || null,
    },
    charms: serializeCharms(placed).map(({ cxMm, cyMm, rot, ...charm }) => ({
      ...charm,
      xMm: cxMm,
      yMm: cyMm,
      rotDeg: rot,
    })),
    wordGroups,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(layout))
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (encoded.length > 120000) throw new Error('Design is too large to save as a link.')
  url.hash = new URLSearchParams({ charme_layout: encoded }).toString()
  return url.href
}
