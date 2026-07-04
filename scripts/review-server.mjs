// Interactive charm-mapping review server.
// ---------------------------------------------------------------------------
// Serves an editable review page: each customizer charm shows its current
// Shopify mapping; you can search/pick the correct Shopify variant (or mark
// "no match") and Save — which writes back to reference/charm-map-overrides.json
// so the correction is persisted and picked up by build-charm-variantmap.mjs.
//
// Run:  node scripts/review-server.mjs   → http://localhost:8091/
import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { extname, join, normalize } from 'path'

const ROOT = process.cwd()
const OVERRIDES = 'reference/charm-map-overrides.json'
const PORT = 8091

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const catalog = readJSON('src/data/catalog.json')
const charms = Array.isArray(catalog) ? catalog : catalog.charms || Object.values(catalog)
const shop = readJSON('reference/shopify-charms.json')
const draft = readJSON('reference/charm-map-draft.json')

const vinfo = new Map()
const options = []
for (const p of shop) {
  for (const v of p.variants) {
    const label = `${p.title.replace(/\s+/g, ' ').trim()} · ${v.title} · £${v.price}`
    vinfo.set(v.id, { product: p.title.replace(/\s+/g, ' ').trim(), vtitle: v.title, price: v.price })
    options.push(`<option value="${label} [${v.id}]"></option>`)
  }
}

const rep = new Map()
for (const c of charms) {
  if (!rep.has(c.name)) rep.set(c.name, { name: c.name, src: c.src, price: c.price, category: c.category, count: 0 })
  rep.get(c.name).count++
}
const rows = [...rep.values()].sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name))

function loadOverrides() {
  if (!existsSync(OVERRIDES)) return { _note: 'Manual charm→variant overrides. Saved from the review page.' }
  return readJSON(OVERRIDES)
}

function currentId(name, ov) {
  if (Object.prototype.hasOwnProperty.call(ov, name)) return ov[name]
  const m = draft[name] && draft[name].match
  return m ? m.id : null
}

function cardHTML(r, ov) {
  const id = currentId(r.name, ov)
  const cust = '/public' + r.src
  const isOverride = Object.prototype.hasOwnProperty.call(ov, r.name)
  const src = id == null ? 'none' : isOverride ? 'manual' : 'auto'
  const vi = id != null ? vinfo.get(id) : null
  const shopImg = id != null ? `<img class="shop" src="/reference/_match/shopify/${id}.jpg" onerror="this.style.opacity=.15">` : `<div class="noimg">no&nbsp;match</div>`
  const label = vi ? `${vi.product} · <i>${vi.vtitle}</i> · £${vi.price}` : 'charmByPrice £' + r.price
  return `<div class="card ${src}" data-name="${encodeURIComponent(r.name)}">
    <div class="imgs"><img src="${cust}" loading="lazy"><span class="arrow">→</span><span class="target">${shopImg}</span></div>
    <div class="lbl"><b>${r.name}</b> <span class="badge">${src}</span> <span class="muted">${r.category} £${r.price} ×${r.count}</span><br>
      <span class="cur muted">${label}</span></div>
    <div class="edit">
      <input list="vlist" class="pick" placeholder="search Shopify charm…">
      <button class="save">Save</button><button class="nomatch">No match</button>
    </div>
  </div>`
}

function pageHTML() {
  const ov = loadOverrides()
  const cards = rows.map((r) => cardHTML(r, ov)).join('\n')
  return `<!doctype html><meta charset="utf-8"><title>Charm mapping — editable</title>
<style>
 body{font-family:system-ui,Arial;margin:14px;background:#fafafa}
 h1{font-size:18px} .sum{color:#555;margin:6px 0}
 .filters{position:sticky;top:0;background:#fafafa;padding:8px 0;z-index:5}
 button{padding:4px 10px;cursor:pointer;margin-right:4px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
 .card{border:2px solid #ddd;border-radius:8px;padding:8px;background:#fff}
 .card.manual{border-color:#4f8fd6}.card.none{border-color:#e0a0a0;background:#fff7f7}.card.saved{box-shadow:0 0 0 3px #bfe6bf}
 .imgs{display:flex;align-items:center;gap:6px;height:92px}
 .imgs img{width:84px;height:84px;object-fit:contain;background:#fff;border:1px solid #eee}
 .noimg{width:84px;height:84px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#b00;background:#fdeaea;border:1px solid #f0caca}
 .arrow{color:#999}.lbl{font-size:12px;margin:6px 0;line-height:1.4}.muted{color:#777}
 .badge{font-size:10px;background:#eef;border:1px solid #ccd;border-radius:4px;padding:0 4px;color:#446}
 .edit{display:flex;gap:4px}.pick{flex:1;padding:3px}
</style>
<h1>Charm mapping — click a charm, pick the correct Shopify item, Save</h1>
<div class="sum">${rows.length} charms. Type in a box to search Shopify variants (by product / part name), pick one, press <b>Save</b>. Use <b>No match</b> if none fits. Saves to reference/charm-map-overrides.json.</div>
<div class="filters">
 <button onclick="F('all')">All</button><button onclick="F('manual')">My/edited</button><button onclick="F('auto')">Auto</button><button onclick="F('none')">No match</button>
 <input id="q" placeholder="filter by charm name…" oninput="Q(this.value)" style="padding:4px;width:200px">
</div>
<datalist id="vlist">${options.join('')}</datalist>
<div class="grid" id="g">${cards}</div>
<script>
 function F(k){document.querySelectorAll('.card').forEach(c=>{c.style.display=(k==='all'||c.classList.contains(k))?'':'none'})}
 function Q(v){v=v.toLowerCase();document.querySelectorAll('.card').forEach(c=>{c.style.display=decodeURIComponent(c.dataset.name).toLowerCase().includes(v)?'':'none'})}
 async function save(card,id){
   const name=decodeURIComponent(card.dataset.name);
   const r=await fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,id})});
   if(r.ok){card.classList.add('saved');const d=await r.json();
     card.classList.remove('auto','none');card.classList.add('manual');
     card.querySelector('.cur').innerHTML=d.label;
     const t=card.querySelector('.target');
     t.innerHTML = id==null?'<div class="noimg">no&nbsp;match</div>':'<img class="shop" src="/reference/_match/shopify/'+id+'.jpg?'+Date.now()+'">';
   } else alert('save failed');
 }
 document.querySelectorAll('.card').forEach(card=>{
   card.querySelector('.save').onclick=()=>{
     const v=card.querySelector('.pick').value;const m=v.match(/\\[(\\d+)\\]\\s*$/);
     if(!m){alert('Pick an item from the dropdown first.');return;}
     save(card,Number(m[1]));
   };
   card.querySelector('.nomatch').onclick=()=>save(card,null);
 });
</script>`
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' }

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(pageHTML())
  }
  if (req.method === 'POST' && url === '/api/save') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const { name, id } = JSON.parse(body)
        const ov = loadOverrides()
        ov[name] = id === null ? null : Number(id)
        writeFileSync(OVERRIDES, JSON.stringify(ov, null, 2))
        const vi = id == null ? null : vinfo.get(Number(id))
        const label = vi ? `${vi.product} · <i>${vi.vtitle}</i> · £${vi.price}` : 'charmByPrice'
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, label }))
      } catch (e) {
        res.writeHead(400)
        res.end('bad')
      }
    })
    return
  }
  // static files under repo root (images)
  if (req.method === 'GET' && (url.startsWith('/public/') || url.startsWith('/reference/'))) {
    const fp = normalize(join(ROOT, url))
    if (!fp.startsWith(ROOT) || !existsSync(fp) || !statSync(fp).isFile()) {
      res.writeHead(404)
      return res.end('nf')
    }
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' })
    return res.end(readFileSync(fp))
  }
  res.writeHead(404)
  res.end('nf')
}).listen(PORT, () => console.log(`review server → http://localhost:${PORT}/`))
