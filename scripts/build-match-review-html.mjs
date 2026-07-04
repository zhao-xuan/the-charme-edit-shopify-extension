// Build a visual review page: each customizer charm next to the Shopify variant
// it was mapped to, so the mapping can be eyeballed. Output: charm-review.html
// (at repo root — serve from root so both image folders resolve).
import { readFileSync, writeFileSync } from 'fs'

const draft = JSON.parse(readFileSync('reference/charm-map-draft.json', 'utf8'))
const overrides = JSON.parse(readFileSync('reference/charm-map-overrides.json', 'utf8'))
const cat = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'))
const charms = Array.isArray(cat) ? cat : cat.charms || Object.values(cat)
const shop = JSON.parse(readFileSync('reference/shopify-charms.json', 'utf8'))

// variant id -> info
const vinfo = new Map()
for (const p of shop) for (const v of p.variants) vinfo.set(v.id, { product: p.title.replace(/\s+/g, ' ').trim(), vtitle: v.title, price: v.price })

// distinct name -> representative customizer image + price + count + category
const rep = new Map()
for (const c of charms) {
  if (!rep.has(c.name)) rep.set(c.name, { name: c.name, src: c.src, price: c.price, category: c.category, count: 0 })
  rep.get(c.name).count++
}

// name -> { id, source } (override wins)
function mapping(name) {
  if (Object.prototype.hasOwnProperty.call(overrides, name)) return { id: overrides[name], source: 'manual' }
  const m = draft[name] && draft[name].match
  return { id: m ? m.id : null, source: 'auto' }
}

const rows = [...rep.values()].sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name))

let mapped = 0, none = 0
const cards = rows.map((r) => {
  const { id, source } = mapping(r.name)
  const cust = 'public' + r.src
  if (id == null) {
    none++
    return `<div class="card none">
      <div class="imgs"><img src="${cust}" loading="lazy"><span class="arrow">→</span><div class="noimg">no match<br>charmByPrice £${r.price}</div></div>
      <div class="lbl"><b>${r.name}</b> <span class="badge">${source}</span><br><span class="muted">${r.category} · £${r.price} · ×${r.count}</span></div>
    </div>`
  }
  mapped++
  const vi = vinfo.get(id) || { product: '??', vtitle: '', price: '?' }
  const pmis = String(vi.price) !== String(r.price)
  return `<div class="card ${source}">
    <div class="imgs"><img src="${cust}" loading="lazy"><span class="arrow">→</span><img src="reference/_match/shopify/${id}.jpg" loading="lazy" onerror="this.style.opacity=.2"></div>
    <div class="lbl"><b>${r.name}</b> <span class="badge">${source}</span><br>
      <span class="muted">→ ${vi.product} <i>${vi.vtitle}</i></span><br>
      <span class="${pmis ? 'pmis' : 'muted'}">customizer £${r.price} ${pmis ? '≠' : '='} Shopify £${vi.price}</span> · <span class="muted">${id}</span></div>
  </div>`
})

const html = `<!doctype html><meta charset="utf-8"><title>Charm mapping review</title>
<style>
  body{font-family:system-ui,Arial;margin:16px;background:#fafafa}
  h1{font-size:18px} .sum{margin:8px 0 16px;color:#444}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
  .card{border:2px solid #ddd;border-radius:8px;padding:8px;background:#fff}
  .card.manual{border-color:#7aa7d6}.card.none{border-color:#e0a0a0;background:#fff7f7}
  .imgs{display:flex;align-items:center;gap:6px;height:96px}
  .imgs img{width:88px;height:88px;object-fit:contain;background:#fff;border:1px solid #eee}
  .noimg{width:88px;height:88px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;color:#b00;background:#fdeaea;border:1px solid #f0caca}
  .arrow{color:#999;font-size:18px}
  .lbl{font-size:12px;margin-top:6px;line-height:1.4}
  .muted{color:#777}.pmis{color:#c67600;font-weight:600}
  .badge{font-size:10px;background:#eef;border:1px solid #ccd;border-radius:4px;padding:0 4px;color:#446}
  .card.none .badge{background:#fee;border-color:#dcc;color:#a44}
  .filters{position:sticky;top:0;background:#fafafa;padding:8px 0}
  button{margin-right:6px;padding:4px 10px;cursor:pointer}
</style>
<h1>Charm mapping review</h1>
<div class="sum">${rows.length} distinct charms · <b>${mapped}</b> mapped to a Shopify variant · <b>${none}</b> no match (charmByPrice fallback). Blue=my visual judgment, plain=auto keyword match, red=no equivalent. Orange = price differs.</div>
<div class="filters">
  <button onclick="f('all')">All</button>
  <button onclick="f('manual')">My judgments</button>
  <button onclick="f('auto')">Auto</button>
  <button onclick="f('none')">No match</button>
  <button onclick="f('pmis')">Price mismatch</button>
</div>
<div class="grid" id="g">${cards.join('\n')}</div>
<script>
  function f(k){document.querySelectorAll('.card').forEach(c=>{
    let show = k==='all' || c.classList.contains(k) || (k==='pmis'&&c.querySelector('.pmis'));
    c.style.display = show?'':'none';
  });}
</script>`

writeFileSync('charm-review.html', html)
console.log('wrote charm-review.html —', rows.length, 'cards,', mapped, 'mapped,', none, 'none')
