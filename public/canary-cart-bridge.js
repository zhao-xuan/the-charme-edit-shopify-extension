(function () {
  if (!/^\/editor\/?$/.test(window.location.pathname)) return

  var STOREFRONT_HOSTS = {
    'thecharmeedit.com': true,
    'www.thecharmeedit.com': true,
    '7ftyeu-0m.myshopify.com': true,
  }
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  function decodeJson(encoded) {
    if (!encoded || encoded.length > 200000) return null
    try {
      var base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
      while (base64.length % 4) base64 += '='
      var binary = atob(base64)
      var bytes = new Uint8Array(binary.length)
      for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch (error) {
      return null
    }
  }

  function encodeJson(value) {
    var bytes = new TextEncoder().encode(JSON.stringify(value))
    var binary = ''
    for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  function editLayout() {
    var saved = decodeJson(hashParams.get('charme_layout'))
    var product = saved && saved.product
    if (!product || !product.id || !Array.isArray(saved.charms)) return null
    return {
      productId: product.id,
      caseColourId: (product.caseColour && product.caseColour.id) || product.colorId,
      gelColourId: product.gelId || (product.gelColour && product.gelColour.id) || undefined,
      charms: saved.charms.map(function (charm) {
        return {
          charmId: charm.charmId,
          shopifyVariantId: charm.shopifyVariantId,
          src: charm.src,
          name: charm.name,
          category: charm.category,
          collection: charm.collection,
          type: charm.type,
          price: charm.price,
          bundle: charm.bundle,
          cxMm: charm.xMm,
          cyMm: charm.yMm,
          wMm: charm.wMm,
          hMm: charm.hMm,
          rot: charm.rotDeg,
          scale: charm.scale,
        }
      }),
    }
  }

  var layout = editLayout()
  if (layout) {
    var search = new URLSearchParams(window.location.search)
    search.set('seed', '1')
    search.set('product', layout.productId)
    if (layout.caseColourId) search.set('case', layout.caseColourId)
    if (layout.gelColourId) search.set('gel', layout.gelColourId)
    history.replaceState(null, '', window.location.pathname + '?' + search.toString() + window.location.hash)

    var seedAttempts = 0
    var seedTimer = window.setInterval(function () {
      seedAttempts += 1
      if (typeof window.__charmeSeedLayout === 'function') {
        window.clearInterval(seedTimer)
        window.__charmeSeedLayout(layout)
      } else if (seedAttempts >= 200) {
        window.clearInterval(seedTimer)
      }
    }, 50)
  }

  function formItems(form) {
    var items = []
    new FormData(form).forEach(function (rawValue, name) {
      var value = String(rawValue)
      var field = /^items\[(\d+)\]\[(id|quantity)\]$/.exec(name)
      var property = /^items\[(\d+)\]\[properties\]\[([^\]]+)\]$/.exec(name)
      if (field) {
        var fieldIndex = Number(field[1])
        items[fieldIndex] = items[fieldIndex] || { quantity: 1, properties: {} }
        items[fieldIndex][field[2]] = Number(value)
      } else if (property) {
        var propertyIndex = Number(property[1])
        items[propertyIndex] = items[propertyIndex] || { quantity: 1, properties: {} }
        items[propertyIndex].properties[property[2]] = value
      }
    })
    return items.filter(function (item) {
      return item && Number.isSafeInteger(item.id) && item.id > 0 &&
        Number.isSafeInteger(item.quantity) && item.quantity > 0
    })
  }

  var nativeSubmit = HTMLFormElement.prototype.submit
  HTMLFormElement.prototype.submit = function () {
    try {
      var action = new URL(this.action, window.location.href)
      if (
        String(this.method).toLowerCase() === 'post' &&
        action.pathname.replace(/\/+$/, '') === '/cart/add' &&
        STOREFRONT_HOSTS[action.hostname]
      ) {
        var items = formItems(this)
        if (!items.length || items.length > 100) throw new Error('Invalid cart payload')
        var returnToInput = this.querySelector('input[name="return_to"]')
        var cartUrl = new URL(returnToInput ? returnToInput.value : '/cart', action.origin)
        if (cartUrl.origin !== action.origin || cartUrl.pathname.replace(/\/+$/, '') !== '/cart') {
          cartUrl = new URL('/cart', action.origin)
        }
        var replaceDesignToken = hashParams.get('charme_edit_token') || ''
        var payload = {
          version: 1,
          items: items,
        }
        if (/^[A-Za-z0-9_-]{1,128}$/.test(replaceDesignToken)) {
          payload.replaceDesignToken = replaceDesignToken
        }
        cartUrl.hash = 'charme-cart=' + encodeJson(payload)
        window.location.assign(cartUrl.href)
        return
      }
    } catch (error) {
      console.error('[Charmé] cart bridge failed', error)
    }
    return nativeSubmit.call(this)
  }
})()