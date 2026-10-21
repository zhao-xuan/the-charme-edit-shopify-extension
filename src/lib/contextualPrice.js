export function marketEstimateContext(price, storefrontCurrency) {
  const amount = Number(price?.amount)
  const baseAmount = Number(price?.baseAmount)
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(price?.currency)) return null
  if (price.currency === 'GBP') return { base: 'GBP', active: 'GBP', rate: 1 }
  const storefrontRate = Number(storefrontCurrency?.rate)
  if (storefrontCurrency?.active === price.currency && Number.isFinite(storefrontRate) && storefrontRate > 0) {
    return { base: 'GBP', active: price.currency, rate: storefrontRate }
  }
  if (price.baseCurrency !== 'GBP' || !Number.isFinite(baseAmount) || baseAmount <= 0) return null
  return { base: 'GBP', active: price.currency, rate: amount / baseAmount }
}

export async function fetchPriceJson(endpoint, { signal, fetchImpl = fetch, timeoutMs = 8000, attempts = 2, ...options } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new Error('contextual_price_cancelled')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let timer
    try {
      return await Promise.race([
        fetchImpl(endpoint, {
          ...options,
          cache: 'no-store',
          headers: { accept: 'application/json', ...options.headers },
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(`contextual_price_http_${response.status}`)
          return response.json()
        }),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('contextual_price_timeout')) }, timeoutMs)
        }),
      ])
    } catch (error) {
      if (signal?.aborted || attempt === attempts - 1) throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

}

export async function fetchContextualPrice(endpoint, options) {
  const price = await fetchPriceJson(endpoint, options)
  if (!marketEstimateContext(price)) throw new Error('contextual_price_invalid')
  return price
}