import { MATERIALS, PROCESSES, interactionFor } from './templates.js'

export function catalogItems(template) {
  const mode = interactionFor(template)
  if (mode === 'placement') {
    const items = MATERIALS.filter((material) => material.processes.includes(template.process)).map((material) => ({ id: `material:${material.id}`, name: material.name }))
    if (PROCESSES[template.process].accepts.includes('text')) items.push({ id: 'action:text', name: '添加文字' })
    if (PROCESSES[template.process].accepts.includes('image')) items.push({ id: 'action:image', name: '上传图案' })
    return items
  }
  if (mode === 'jewelry3d') return MATERIALS.filter((material) => material.processes.includes('beads')).map((material) => ({ id: `material:${material.id}`, name: material.name }))
  if (mode === 'components') return (template.slots || []).map((slot) => ({ id: `slot:${slot.id}`, name: slot.name }))
  return template.surfaces.map((surface) => ({ id: `surface:${surface.id}`, name: surface.name }))
}

export function defaultCatalogLayout(template) {
  const mode = interactionFor(template)
  const name = mode === 'jewelry3d' ? '珠子与吊坠' : mode === 'typography' ? '文字内容位' : mode === 'imageSwap' ? '图片位置' : mode === 'components' ? '商品部件' : '设计素材'
  return { categories: [{ id: 'default', name, itemIds: catalogItems(template).map((item) => item.id) }] }
}

export function normalizeCatalogLayout(template, raw) {
  const defaults = defaultCatalogLayout(template)
  if (raw == null) return defaults
  const categories = raw.categories
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 12) throw new Error('分类须为 1–12 个。')
  const expected = new Set(catalogItems(template).map((item) => item.id))
  const seenCategories = new Set(), seenItems = new Set()
  const normalized = categories.map((category) => {
    const id = String(category?.id || '')
    const name = String(category?.name || '').trim()
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || seenCategories.has(id) || !name || name.length > 40) throw new Error('分类名称或编号无效。')
    if (!Array.isArray(category.itemIds)) throw new Error('分类选项无效。')
    seenCategories.add(id)
    const itemIds = category.itemIds.map(String)
    for (const itemId of itemIds) {
      if (!expected.has(itemId) || seenItems.has(itemId)) throw new Error('分类选项重复或不适用于此品类。')
      seenItems.add(itemId)
    }
    return { id, name, itemIds }
  })
  if (seenItems.size !== expected.size) throw new Error('请为此品类的每个选项指定分类。')
  return { categories: normalized }
}

export function orderedCatalogItems(template, layout) {
  const items = new Map(catalogItems(template).map((item) => [item.id, item]))
  const categories = normalizeCatalogLayout(template, layout).categories
  return categories.map((category) => ({ ...category, items: category.itemIds.map((id) => items.get(id)) }))
}
