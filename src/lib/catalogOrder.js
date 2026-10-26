export function orderByTaxonomy(items, taxonomy) {
  const categoryOrder = taxonomy?.categoryOrder || []
  const subOrder = taxonomy?.subOrder || {}
  const itemOrder = taxonomy?.patchOrder || {}
  const categoryIndex = new Map(categoryOrder.map((value, index) => [value, index]))
  return [...items].sort((left, right) => {
    const leftCategory = left.category || 'unique'
    const rightCategory = right.category || 'unique'
    const categoryDelta = (categoryIndex.get(leftCategory) ?? Infinity) - (categoryIndex.get(rightCategory) ?? Infinity)
    if (categoryDelta) return categoryDelta
    if (leftCategory !== rightCategory) return leftCategory.localeCompare(rightCategory)
    const subIndex = new Map((subOrder[leftCategory] || []).map((value, index) => [value, index]))
    const leftSub = left.collection || 'Custom patches'
    const rightSub = right.collection || 'Custom patches'
    const subDelta = (subIndex.get(leftSub) ?? Infinity) - (subIndex.get(rightSub) ?? Infinity)
    if (subDelta) return subDelta
    if (leftSub !== rightSub) return leftSub.localeCompare(rightSub)
    const patchIndex = new Map((itemOrder[`${leftCategory}::${leftSub}`] || []).map((value, index) => [value, index]))
    return (patchIndex.get(left.id) ?? Infinity) - (patchIndex.get(right.id) ?? Infinity)
  })
}