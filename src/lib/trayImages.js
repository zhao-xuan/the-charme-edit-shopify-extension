export function loadTrayImage(image) {
  const src = image?.getAttribute('data-charm-src')
  if (src && image.getAttribute('src') !== src) image.setAttribute('src', src)
}

export function observeTrayImages(container, Observer = globalThis.IntersectionObserver) {
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
      observer.unobserve(entry.target)
    }
  }, { root: null, rootMargin: '0px', threshold: 0 })
  for (const image of images) observer.observe(image.parentElement)
  return () => observer.disconnect()
}
