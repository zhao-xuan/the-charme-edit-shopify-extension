export function storefrontCartFields(items, returnTo = '/cart') {
  const fields = []
  items.forEach((item, index) => {
    fields.push([`items[${index}][id]`, String(item.id)])
    fields.push([`items[${index}][quantity]`, String(item.quantity || 1)])
    Object.entries(item.properties || {}).forEach(([key, value]) => {
      if (value == null) return
      fields.push([`items[${index}][properties][${key}]`, String(value)])
    })
  })
  fields.push(['return_to', returnTo])
  return fields
}

function trustedCartUrl(storeUrl, cartDestination) {
  const storeOrigin = new URL(storeUrl).origin
  const requestedCartUrl = new URL(cartDestination, storeOrigin)
  return requestedCartUrl.origin === storeOrigin
    ? requestedCartUrl
    : new URL('/cart', storeOrigin)
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function storefrontCartBridgeUrl(
  storeUrl,
  items,
  cartDestination = '/cart',
  replaceDesignToken,
) {
  const cartUrl = trustedCartUrl(storeUrl, cartDestination)
  const payload = {
    version: 1,
    items,
    ...(replaceDesignToken ? { replaceDesignToken } : {}),
  }
  cartUrl.hash = `charme-cart=${base64UrlEncode(JSON.stringify(payload))}`
  return cartUrl.href
}

export function submitStorefrontCartBridge(
  storeUrl,
  items,
  cartDestination = '/cart',
  replaceDesignToken,
) {
  if (typeof window === 'undefined') throw new Error('Cart navigation requires a browser.')
  const cartUrl = trustedCartUrl(storeUrl, cartDestination)
  window.location.href = items.length
    ? storefrontCartBridgeUrl(storeUrl, items, cartUrl, replaceDesignToken)
    : cartUrl.href
}

export function submitStorefrontCartForm(storeUrl, items, cartDestination = '/cart') {
  if (typeof document === 'undefined') throw new Error('Cart navigation requires a browser.')
  const storeOrigin = new URL(storeUrl).origin
  const cartUrl = trustedCartUrl(storeUrl, cartDestination)

  if (!items.length) {
    window.location.href = cartUrl.href
    return
  }

  const form = document.createElement('form')
  form.method = 'post'
  form.action = new URL('/cart/add', storeOrigin).href
  form.acceptCharset = 'UTF-8'
  form.hidden = true

  storefrontCartFields(items, `${cartUrl.pathname}${cartUrl.search}`).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
}