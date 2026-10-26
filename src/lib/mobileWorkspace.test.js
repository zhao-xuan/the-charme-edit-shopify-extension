import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('mobile charm selector reserves a visible browsing area on first load and remains resizable', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  assert.match(source, /\[trayPct, setTrayPct\] = useState\(42\)/)
  assert.match(source, /className="mobile-tray" style=\{\{ flexBasis: `\$\{trayPct\}%` \}\}/)
  assert.match(css.match(/\.mobile-tray\s*\{([^}]+)\}/)[1], /flex: 0 1 42%/)
  assert.match(source, /setTrayPct\(clamp\(\+pct\.toFixed\(1\), 12, 78\)\)/)
})

test('mobile category tabs fit their labels and retain a constrained scroll wrapper', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  const tabs = css.match(/\.mobile-cat-seg\s*\{([^}]+)\}/)[1]
  assert.match(tabs, /width: max-content/)
  assert.match(tabs, /min-width: 0/)
  assert.doesNotMatch(tabs, /min-width: 100%/)
  const wrapper = css.match(/\.mobile-cat-bar\s*\{([^}]+)\}/)[1]
  assert.match(wrapper, /align-self: flex-start/)
  assert.match(wrapper, /max-width: 100%/)
  assert.match(wrapper, /overflow-x: auto/)
})

test('mobile totes omit the redundant Patches category switch without hiding the patch tray', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /product\.kind !== 'tote' && \(\s*<div className="mobile-cat-bar">/)
  assert.match(source, /t\(product\.kind === 'tote' \? 'step2\.mobileTitleTote' : 'step2\.mobileTitle'\)/)
  assert.match(source, /<div className="mobile-tray-body">\s*\{product\.kind === 'tote' && patchDiscountNotice\}\s*\{mobileTray\}/)
})

test('mobile price and validation notices share a permanently reserved status area', () => {
  const source = readFileSync(new URL('../customizer/CustomizerPage.jsx', import.meta.url), 'utf8')
  const status = source.slice(
    source.indexOf('            <div className="mobile-order-requirements"'),
    source.indexOf('          <div className="mobile-order-footer">'),
  )
  assert.match(status, /role="status"/)
  assert.doesNotMatch(status, /\bhidden=/)
  assert.match(status, /className="mobile-order-price-note"[^]*<\/div>}\s*<\/div>\s*<\/div>/)

  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  const rule = css.match(/\.mobile-order-requirements\s*\{([^}]+)\}/)[1]
  assert.match(rule, /(?:^|\n)\s*height: calc\(2\.8em \+ 10px\)/)
  assert.match(rule, /flex: 0 0 auto/)
  assert.match(rule, /overflow-y: auto/)
})
