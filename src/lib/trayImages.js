// Only the small selection tiles use resized images; the design keeps its original artwork.
export function patchImageUrl(src, maxWidth = 192) {
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com' || !url.pathname.startsWith('/s/files/')) return src
    const width = Number(url.searchParams.get('width'))
    if (!width || width > maxWidth) url.searchParams.set('width', String(maxWidth))
    return url.href
  } catch {
    return src
  }
}

export const patchThumbnailUrl = (src) => patchImageUrl(src, 192)

export function fallbackTrayImage(image) {
  const original = image?.getAttribute('data-original-src')
  if (original && image.getAttribute('src') !== original) image.setAttribute('src', original)
}

export function loadTrayImage(image) {
  const src = image?.getAttribute('data-charm-src')
  if (src && image.getAttribute('src') !== src) image.setAttribute('src', src)
}

export function observeTrayImages(container, Observer = globalThis.IntersectionObserver, prefetchAdjacent = false) {
  if (!container) return () => {}
  const images = [...container.querySelectorAll('img[data-charm-src]')]
    .filter((image) => image.getAttribute('src') !== image.getAttribute('data-charm-src'))
  if (!images.length) return () => {}
  if (typeof Observer !== 'function') {
    console.warn('[Charme] IntersectionObserver unavailable; loading tray thumbnails without deferral')
    images.forEach(loadTrayImage)
    return () => {}
  }
  const observer = new Observer((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRect.width <= 0 || entry.intersectionRect.height <= 0) continue
      const image = entry.target.querySelector('img[data-charm-src]')
      loadTrayImage(image)
      if (prefetchAdjacent) {
        let card = image?.closest?.('.charm-card')
        for (let i = 0; i < 2 && card; i++) {
          card = card.nextElementSibling
          loadTrayImage(card?.querySelector('img[data-charm-src]'))
        }
      }
      observer.unobserve(entry.target)
    }
  }, { root: null, rootMargin: '0px', threshold: 0 })
  for (const image of images) observer.observe(image.parentElement)
  return () => observer.disconnect()
}
