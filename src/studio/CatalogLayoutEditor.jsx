import { useState } from 'react'
import { catalogItems, defaultCatalogLayout } from './catalogLayout.js'

const move = (items, from, to) => {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

export default function CatalogLayoutEditor({ template, onChange, disabled }) {
  const [name, setName] = useState('')
  const layout = template.catalogLayout || defaultCatalogLayout(template)
  const categories = layout.categories
  const labels = new Map(catalogItems(template).map((item) => [item.id, item.name]))
  const update = (next) => onChange({ ...template, catalogLayout: { categories: next } })
  const updateCategory = (index, patch) => update(categories.map((category, at) => at === index ? { ...category, ...patch } : category))
  const moveItem = (fromCategory, fromIndex, toCategory) => {
    const next = structuredClone(categories)
    const [id] = next[fromCategory].itemIds.splice(fromIndex, 1)
    next[toCategory].itemIds.push(id)
    update(next)
  }
  const addCategory = () => {
    const label = name.trim()
    if (!label || categories.length >= 12) return
    update([...categories, { id: crypto.randomUUID(), name: label.slice(0, 40), itemIds: [] }])
    setName('')
  }
  return <div className="studio-catalog-editor">
    <p className="studio-muted">此排序只影响当前商品品类的顾客选项。新增分类后可把下方选项移入；保存模板新版本后才会生效。</p>
    {categories.map((category, index) => <section className="studio-catalog-category" key={category.id}>
      <div className="studio-catalog-heading"><label className="studio-field"><span>分类名称</span><input aria-label={`分类 ${index + 1} 名称`} value={category.name} maxLength={40} disabled={disabled} onChange={(event) => updateCategory(index, { name: event.target.value })}/></label><div className="studio-catalog-actions"><button type="button" disabled={disabled || index === 0} aria-label={`上移分类 ${category.name}`} onClick={() => update(move(categories,index,index-1))}>↑</button><button type="button" disabled={disabled || index === categories.length - 1} aria-label={`下移分类 ${category.name}`} onClick={() => update(move(categories,index,index+1))}>↓</button><button type="button" disabled={disabled || categories.length === 1 || category.itemIds.length > 0} onClick={() => update(categories.filter((_,at) => at !== index))}>删除空分类</button></div></div>
      {category.itemIds.length === 0 && <p className="studio-muted">暂无选项；从其他分类选择“移动到此分类”。</p>}
      {category.itemIds.map((id, itemIndex) => <div className="studio-catalog-item" key={id}><span>{labels.get(id)}</span><div className="studio-catalog-actions"><button type="button" disabled={disabled || itemIndex === 0} aria-label={`上移 ${labels.get(id)}`} onClick={() => updateCategory(index, { itemIds: move(category.itemIds,itemIndex,itemIndex-1) })}>↑</button><button type="button" disabled={disabled || itemIndex === category.itemIds.length - 1} aria-label={`下移 ${labels.get(id)}`} onClick={() => updateCategory(index, { itemIds: move(category.itemIds,itemIndex,itemIndex+1) })}>↓</button>{categories.length > 1 && <select aria-label={`移动 ${labels.get(id)} 到分类`} disabled={disabled} value={category.id} onChange={(event) => moveItem(index,itemIndex,categories.findIndex((entry) => entry.id === event.target.value))}>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}</div></div>)}
    </section>)}
    <div className="studio-catalog-add"><input aria-label="新分类名称" value={name} maxLength={40} disabled={disabled || categories.length >= 12} placeholder="新分类名称" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCategory() }}/><button type="button" disabled={disabled || !name.trim() || categories.length >= 12} onClick={addCategory}>＋ 添加分类</button></div>
  </div>
}
