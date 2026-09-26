export function marketEstimateContext(price) {
  const amount = Number(price?.amount)
  const baseAmount = Number(price?.baseAmount)
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(price?.currency)) return null
  if (price.currency === 'GBP') return { base: 'GBP', active: 'GBP', rate: 1 }
  if (price.baseCurrency !== 'GBP' || !Number.isFinite(baseAmount) || baseAmount <= 0) return null
  return { base: 'GBP', active: price.currency, rate: amount / baseAmount }
}

export async function fetchContextualPrice(endpoint, { signal, fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw new Error('contextual_price_cancelled')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let timer
    try {
      return await Promise.race([
        fetchImpl(endpoint, { headers: { accept: 'application/json' }, signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error(`contextual_price_http_${response.status}`)
          const price = await response.json()
          if (!marketEstimateContext(price)) throw new Error('contextual_price_invalid')
          return price
        }),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('contextual_price_timeout')) }, timeoutMs)
        }),
      ])
    } catch (error) {
      if (signal?.aborted || attempt === 1) throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}