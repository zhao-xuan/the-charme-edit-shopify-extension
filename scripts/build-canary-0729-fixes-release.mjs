import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_BASELINE = {
  'public/index.html': 'ba90931b4448df3f5d279abbcb0162ccec518a2b394c378db28d6207d8cf37c5',
  'public/assets/index-canary-cart.js': '2c80d8219dc1136bc1254e3597f93fb36b039950d229d35119e6e8d0979ad174',
  'public/assets/App-canary-cart.js': '75c88bbc4547f95b8e4d5d7036fbd57f68d99fc83cc59ec96a3c5271448259fd',
  'public/assets/index-CTwe4y6i.css': '354d0efd3f48fbb02ca51eb9a83d492bcc1fab167d7239d5c3a71b9c18d53943',
  'public/widget/charme-customizer.js': '049c1f8f9350d242e4df0554e7dedc29ef136c3d0cd802de44f36ded08ecb9f7',
}

const OLD_APP = 'App-canary-cart.js'
const OLD_ENTRY = 'index-canary-cart.js'
const NEW_APP = 'App-canary-0729-fixes.js'
const NEW_ENTRY = 'index-canary-0729-fixes.js'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : null
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before)
  const last = text.lastIndexOf(before)
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one marker, found ${first < 0 ? 0 : 'multiple'}`)
  }
  return text.slice(0, first) + after + text.slice(first + before.length)
}

const baselineArg = argument('baseline')
if (!baselineArg) throw new Error('Usage: node scripts/build-canary-0729-fixes-release.mjs --baseline <snapshot-root>')

const baselineRoot = resolve(baselineArg)
for (const [relativePath, expectedHash] of Object.entries(EXPECTED_BASELINE)) {
  const file = join(baselineRoot, relativePath)
  if (!existsSync(file)) throw new Error(`Missing baseline file: ${relativePath}`)
  const actualHash = sha256(file)
  if (actualHash !== expectedHash) {
    throw new Error(`Baseline drift in ${relativePath}: expected ${expectedHash}, got ${actualHash}`)
  }
}

const releaseParent = mkdtempSync(join(tmpdir(), 'charme-canary-0729-fixes.'))
const releaseRoot = join(releaseParent, 'release')
cpSync(baselineRoot, releaseRoot, { recursive: true, preserveTimestamps: true })
for (const [relativePath, expectedHash] of Object.entries(EXPECTED_BASELINE)) {
  const copiedHash = sha256(join(releaseRoot, relativePath))
  if (copiedHash !== expectedHash) throw new Error(`Copied baseline changed: ${relativePath}`)
}

const assetsDir = join(releaseRoot, 'public', 'assets')
const oldAppPath = join(assetsDir, OLD_APP)
const oldEntryPath = join(assetsDir, OLD_ENTRY)
let app = readFileSync(oldAppPath, 'utf8')
let entry = readFileSync(oldEntryPath, 'utf8')

if (app.includes('charmeCrossSellProduct') || app.includes('charmeCrossSellAccepted')) {
  throw new Error('Baseline already contains Canary fix identifiers')
}

app = replaceOnce(
  app,
  'function jf(e,t){var s,l;const n=t.find(c=>c.key===e.group),a=e.group==="apple"?"iphone-16-pro-max":(l=(s=n==null?void 0:n.products)==null?void 0:s[0])==null?void 0:l.id,r=wa(e.productId||a),i=(r==null?void 0:r.blankImage)||{};return Gn(e.image||i.white||i.default||i.natural||i.black||null)}',
  'function charmeCrossSellProduct(e,t){var s,l;const n=t.find(c=>c.key===e.group),a=e.group==="apple"?"iphone-16-pro-max":(l=(s=n==null?void 0:n.products)==null?void 0:s[0])==null?void 0:l.id;return wa(e.productId||a)}function jf(e,t){const n=charmeCrossSellProduct(e,t),a=(n==null?void 0:n.blankImage)||{};return Gn(e.image||a.white||a.default||a.natural||a.black||null)}',
  'frame product resolver',
)
app = replaceOnce(
  app,
  '(e.gelRender||e.linkedFinish)&&i?',
  'i?',
  'gel-driven case derivation',
)
app = replaceOnce(
  app,
  'o.useEffect(()=>{if(!Se.gelRender)return;const le=M==="black"?"black":"white";x!==le&&S(le)},[Se.gelRender,M,x]);',
  'o.useEffect(()=>{if(!Se.gelColours)return;const le=M==="black"?"black":"white";x!==le&&S(le)},[Se.gelColours,M,x]);',
  'gel-driven hidden case state',
)
app = replaceOnce(
  app,
  'h?f.jsxs(f.Fragment,{children:[!m.gelRender&&!m.linkedFinish&&f.jsx(fs,{title:Ge("picker.caseColour"),colours:u,value:n,onChange:s}),f.jsx(fs,{title:Ge("picker.gelColour"),colours:h,value:a,onChange:l})]}):f.jsx(fs,{title:Ge("picker.colour"),colours:u,value:n,onChange:s})',
  'h?f.jsx(fs,{title:Ge("picker.gelColour"),colours:h,value:a,onChange:l}):f.jsx(fs,{title:Ge("picker.colour"),colours:u,value:n,onChange:s})',
  'desktop gel-only control',
)
app = replaceOnce(
  app,
  '!Se.gelRender&&!Se.linkedFinish&&f.jsxs("label",{className:"mobile-head__field"',
  '!Ce&&f.jsxs("label",{className:"mobile-head__field"',
  'mobile gel-only control',
)
app = replaceOnce(
  app,
  '[W,F]=o.useState(!1),[A,T]=o.useState(!1),[G,V]=o.useState(!1),',
  '[W,F]=o.useState(!1),[A,T]=o.useState(!1),charmeCrossSellAccepted=o.useRef(!1),[G,V]=o.useState(!1),',
  'one-shot cross-sell state',
)
app = replaceOnce(
  app,
  'Ut=m.crossSell||{},rn=Array.isArray(Ut.options)?Ut.options.filter(le=>le&&le.label):[],mn=async le=>{const xe=Ut.enabled&&rn.length>0;e&&await e(xe?{...le,deferSurface:!0}:le),xe&&T(!0)},fn=le=>{T(!1);const xe=(Ut.discountCode||"").trim();xe&&typeof fetch<"u"&&fetch(`/discount/${encodeURIComponent(xe)}`,{mode:"no-cors"}).catch(()=>{}),le.group&&gt(le.group),le.productId&&Ze(le.productId),$([]),I(null),P(null),L(null)}',
  'Ut=m.crossSell||{},rn=Array.isArray(Ut.options)?Ut.options.filter(le=>le&&le.label):[],mn=async le=>{const xe=!charmeCrossSellAccepted.current&&Ut.enabled&&rn.length>0;e&&await e(xe?{...le,deferSurface:!0}:le),xe&&T(!0)},fn=le=>{T(!1),charmeCrossSellAccepted.current=!0;const xe=(Ut.discountCode||"").trim();xe&&typeof fetch<"u"&&fetch(`/discount/${encodeURIComponent(xe)}`,{mode:"no-cors"}).catch(()=>{}),le.group&&gt(le.group),le.productId&&Ze(le.productId),$([]),I(null),P(null),L(null)}',
  'one-shot cross-sell handlers',
)
app = replaceOnce(
  app,
  'children:rn.map((le,xe)=>f.jsxs("article",{className:"cross-sell-option",children:[jf(le,d)&&f.jsx("img",{className:"cross-sell-option__image",src:jf(le,d),alt:""}),f.jsx(nt,{type:"primary",size:"large",onClick:()=>fn(le),children:le.buttonLabel||le.label})]},xe))}',
  'children:rn.map((le,xe)=>f.jsxs("article",{className:"cross-sell-option",children:[(()=>{const Ye=charmeCrossSellProduct(le,d),xt=jf(le,d);return xt?f.jsx("img",{className:"cross-sell-option__image",src:xt,alt:""}):Ye&&Ye.kind==="frame"?f.jsx("div",{className:"cross-sell-option__image",style:{display:"grid",placeItems:"center",overflow:"hidden"},"aria-hidden":"true",children:f.jsx(NM,{product:Ye,color:Ye.caseColours[1],scale:.5})}):null})(),f.jsx(nt,{type:"primary",size:"large",onClick:()=>fn(le),children:le.buttonLabel||le.label})]},xe))}',
  'frame cross-sell fallback',
)

app = replaceOnce(app, `./${OLD_ENTRY}`, `./${NEW_ENTRY}`, 'App to entry chunk reference')
entry = replaceOnce(entry, `./${OLD_APP}`, `./${NEW_APP}`, 'entry to App chunk reference')

const indexPath = join(releaseRoot, 'public', 'index.html')
let index = readFileSync(indexPath, 'utf8')
index = replaceOnce(
  index,
  `    <script type="module" crossorigin src="/assets/${OLD_ENTRY}"></script>`,
  `    <script src="/canary-cart-bridge.js"></script>\n    <script type="module" crossorigin src="/assets/${NEW_ENTRY}"></script>`,
  'Canary preload and entry script',
)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
copyFileSync(join(repoRoot, 'public', 'canary-cart-bridge.js'), join(releaseRoot, 'public', 'canary-cart-bridge.js'))
writeFileSync(join(assetsDir, NEW_APP), app)
writeFileSync(join(assetsDir, NEW_ENTRY), entry)
writeFileSync(indexPath, index)

const outputFiles = {
  'public/index.html': sha256(indexPath),
  [`public/assets/${NEW_ENTRY}`]: sha256(join(assetsDir, NEW_ENTRY)),
  [`public/assets/${NEW_APP}`]: sha256(join(assetsDir, NEW_APP)),
  'public/canary-cart-bridge.js': sha256(join(releaseRoot, 'public', 'canary-cart-bridge.js')),
}
writeFileSync(
  join(releaseRoot, 'canary-0729-fixes-manifest.json'),
  `${JSON.stringify({ baseline: EXPECTED_BASELINE, outputFiles }, null, 2)}\n`,
)

console.log(releaseRoot)