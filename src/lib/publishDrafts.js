export function pendingPublishPlan(draft, catalog) {
  const liveCharms = new Set(catalog.charms.map((item) => item.id))
  const liveProducts = new Set(catalog.products.map((item) => item.id))
  const charms = draft.customCharms || []
  const products = draft.customProducts || []
  return {
    charms: charms.filter((item) => !liveCharms.has(item.id)),
    products: products.filter((item) => !liveProducts.has(item.id)),
    alreadyPublished: [
      ...charms.filter((item) => liveCharms.has(item.id)).map((item) => ({ field: 'customCharms', item })),
      ...products.filter((item) => liveProducts.has(item.id)).map((item) => ({ field: 'customProducts', item })),
    ],
  }
}

export function removePublishedDraft(draft, field, id) {
  return { ...draft, [field]: (draft[field] || []).filter((item) => item.id !== id) }
}

export async function publishPendingDrafts(draft, { fetchCatalog, addCharms, addProduct, onConfirmed }) {
  const catalog = await fetchCatalog()
  if (!Array.isArray(catalog.charms) || !Array.isArray(catalog.products)) throw new Error('Invalid catalogue response; no drafts were published.')
  const plan = pendingPublishPlan(draft, catalog)
  const unlinked = plan.charms.filter((item) => !/^\d+$/.test(String(item.shopifyVariantId || '')))
  if (unlinked.length) {
    throw new Error(`No drafts were published. Link a Shopify variant for: ${unlinked.map((item) => item.name || item.id).join(', ')}. Use Pending drafts below to link them or discard unwanted drafts.`)
  }
  for (const { field, item } of plan.alreadyPublished) await onConfirmed(field, item.id)
  // Confirm each item separately, so a later failure cannot replay earlier
  // successes and overwrite their subsequently edited artwork or dimensions.
  for (const item of plan.charms) {
    await addCharms([item])
    await onConfirmed('customCharms', item.id)
  }
  for (const item of plan.products) {
    await addProduct(item)
    await onConfirmed('customProducts', item.id)
  }
  return { charms: plan.charms.length, products: plan.products.length, alreadyPublished: plan.alreadyPublished.length }
}
