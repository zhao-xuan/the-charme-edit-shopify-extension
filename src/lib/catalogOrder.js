/** Saved entries come first; unlisted entries retain their first-seen order. */
export function orderList(items, order) {
  const available = new Set(items)
  const head = [...new Set(order || [])].filter((value) => available.has(value))
  const seen = new Set(head)
  return [...head, ...items.filter((value) => !seen.has(value))]
}

export function phoneCategoryKey(category) {
  const key = String(category || '').trim().toLowerCase()
  if (key === 'natural') return 'unique'
  if (key === 'colorful') return 'colourful'
  return ['gold', 'silver', 'colourful', 'unique'].includes(key) ? key : category
}

export function phoneTaxonomy(taxonomy = {}) {
  const mergeOrders = (orders, normalizeKey) => {
    const merged = {}
    for (const [key, values] of Object.entries(orders || {})) {
      const normalized = normalizeKey(key)
      merged[normalized] = [...new Set([...(merged[normalized] || []), ...values])]
    }
    return merged
  }
  return {
    categoryOrder: [...new Set((taxonomy.categoryOrder || []).map(phoneCategoryKey))],
    subOrder: mergeOrders(taxonomy.subOrder, phoneCategoryKey),
    charmOrder: mergeOrders(taxonomy.charmOrder, (key) => {
      const split = key.indexOf('::')
      return split < 0 ? key : `${phoneCategoryKey(key.slice(0, split))}${key.slice(split)}`
    }),
  }
}

export function orderByTaxonomy(items, taxonomy) {
  const categoryOf = (item) => item.category || 'unique'
  const collectionOf = (item) => item.collection || 'Custom patches'
  const indexOf = (values, order) => new Map(orderList([...new Set(values)], order).map((value, index) => [value, index]))
  const categoryIndex = indexOf(items.map(categoryOf), taxonomy?.categoryOrder)
  const subIndexes = new Map()
  const itemIndexes = new Map()
  const itemOrder = taxonomy?.charmOrder || taxonomy?.patchOrder || {}
  for (const category of categoryIndex.keys()) {
    const members = items.filter((item) => categoryOf(item) === category)
    const subIndex = indexOf(members.map(collectionOf), taxonomy?.subOrder?.[category])
    subIndexes.set(category, subIndex)
    for (const collection of subIndex.keys()) {
      const key = `${category}::${collection}`
      itemIndexes.set(key, indexOf(members.filter((item) => collectionOf(item) === collection).map((item) => item.id), itemOrder[key]))
    }
  }
  return [...items].sort((left, right) => {
    const leftCategory = categoryOf(left)
    const rightCategory = categoryOf(right)
    const categoryDelta = categoryIndex.get(leftCategory) - categoryIndex.get(rightCategory)
    if (categoryDelta) return categoryDelta
    const subIndex = subIndexes.get(leftCategory)
    const leftSub = collectionOf(left)
    const rightSub = collectionOf(right)
    const subDelta = subIndex.get(leftSub) - subIndex.get(rightSub)
    if (subDelta) return subDelta
    const itemIndex = itemIndexes.get(`${leftCategory}::${leftSub}`)
    return itemIndex.get(left.id) - itemIndex.get(right.id)
  })
}