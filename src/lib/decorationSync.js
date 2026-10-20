export const variantName = (variant) =>
  /^default title$/i.test(variant.title || '')
    ? variant.productTitle
    : `${variant.productTitle} - ${variant.title}`

export function decorationSyncPreview(variants, records, keyword = '') {
  const rule = keyword.trim().toLowerCase()
  const matches = (variant) => !rule || `${variant.productTitle} ${variant.title} ${variant.handle}`.toLowerCase().includes(rule)
  const linked = new Set(records.map((record) => String(record.shopifyVariantId || '')))
  const byId = new Map(variants.map((variant) => [String(variant.id), variant]))
  return {
    missing: variants.filter((variant) => matches(variant) && !linked.has(String(variant.id))),
    existing: records.map((record) => ({
      ...record,
      variant: byId.get(String(record.shopifyVariantId || '')) || null,
    })).filter((record) => !record.variant || matches(record.variant)),
  }
}

export function importedDecoration(kind, variant) {
  if (!/^\d+$/.test(String(variant.id))) throw new Error('Invalid Shopify variant ID')
  if (!variant.imageUrl) throw new Error('This variant has no Shopify image')
  if (!Number.isFinite(variant.price) || variant.price < 0) throw new Error('Invalid Shopify price')
  return {
    id: `shopify-${kind}-${variant.id}`,
    name: variantName(variant),
    collection: variant.productTitle || 'Shopify imports',
    category: kind === 'charm' ? 'gold' : 'unique',
    tier: 'midi',
    type: 2,
    price: variant.price,
    shopifyVariantId: String(variant.id),
    src: variant.imageUrl,
    widthMm: 16,
    heightMm: 16,
    minScale: 1,
    maxScale: 1,
    hidden: false,
    source: 'shopify-import',
  }
}

export async function applyDecorationSync({ kind, variants, records, variantIds, existingIds, reprocessExisting = false, save, storeImage }) {
  const byVariant = new Map(variants.map((variant) => [String(variant.id), variant]))
  const byRecord = new Map(records.map((record) => [record.id, record]))
  const linked = new Set(records.map((record) => String(record.shopifyVariantId || '')))
  const result = { created: [], updated: [], skipped: [], failed: [] }
  for (const variantId of new Set(variantIds)) {
    const key = `variant:${variantId}`
    try {
      if (linked.has(variantId)) {
        result.skipped.push(key)
        continue
      }
      const variant = byVariant.get(variantId)
      if (!variant) throw new Error('Shopify variant no longer exists; scan again')
      const record = importedDecoration(kind, variant)
      if (byRecord.has(record.id)) throw new Error('Import ID already belongs to another record; review its variant link')
      const image = await storeImage(record, key)
      const saved = { ...record, src: image.url, ...(kind === 'patch' ? { imageFileId: image.id } : {}) }
      await save(saved, kind === 'charm' ? { image: image.id } : {})
      linked.add(variantId)
      result.created.push(key)
    } catch (error) {
      result.failed.push({ key, error: error.message })
    }
  }
  for (const id of new Set(existingIds)) {
    const key = `existing:${id}`
    try {
      const record = byRecord.get(id)
      if (!record) throw new Error('Catalogue item no longer exists; scan again')
      const variant = byVariant.get(String(record.shopifyVariantId || ''))
      if (!variant) throw new Error('The linked Shopify variant is missing')
      if (!Number.isFinite(variant.price) || variant.price < 0) throw new Error('Invalid Shopify price')
      const updated = { ...record, price: variant.price }
      let images = {}
      if (reprocessExisting) {
        const image = await storeImage(record, key)
        updated.src = image.url
        if (kind === 'patch') updated.imageFileId = image.id
        else images = { image: image.id }
      }
      await save(updated, images)
      result.updated.push(key)
    } catch (error) {
      result.failed.push({ key, error: error.message })
    }
  }
  return result
}
