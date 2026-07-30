export async function fetchVariantDetails(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {},
) {
  const controller =
    typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null
  let timeoutId
  const request = Promise.resolve()
    .then(() =>
      fetchImpl(url, {
        headers: { Accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
      }),
    )
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return request

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller?.abort()
      resolve(null)
    }, timeoutMs)
  })
  const result = await Promise.race([request, timeout])
  clearTimeout(timeoutId)
  return result
}

export async function resolvePricedVariant(candidates, expectedPrice, loadVariant) {
  const expectedCents = Math.round(Number(expectedPrice) * 100)
  for (const id of [...new Set(candidates.filter(Boolean).map(String))]) {
    const variant = await loadVariant(id)
    if (variant?.available !== false && Number(variant?.price) === expectedCents) return id
  }
  return null
}