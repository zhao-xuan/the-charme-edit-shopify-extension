import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(new URL('../components/ProductStage.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

test('rotation drag target follows the enlarged arrow arc, not the full ring or a small dot', () => {
  const hit = component.match(/<path\s+className="charm-dial__hit"([\s\S]*?)\/>/)
  assert.ok(hit)
  assert.match(hit[1], /d=\{arc\}/)
  assert.match(component, /Math\.max\(44, charmRadius \+ 26\)/)
  assert.match(component, /const halfArc = 50 \* Math\.PI \/ 180/)
  assert.doesNotMatch(component, /<circle[^]*?className="charm-dial__thumb"/)
  assert.match(styles, /\.charm-dial__hit\s*\{[^}]*stroke-width:\s*44[^}]*pointer-events:\s*stroke/s)
})

test('rotation controls have a raised layer and an unmistakable draggable handle', () => {
  assert.match(styles, /\.charm-dial\s*\{[^}]*z-index:\s*100/s)
  assert.match(styles, /\.charm-dial__arrow\s*\{[^}]*stroke:\s*#d4380d/s)
  assert.match(styles, /\.charm-dial__arrow-contrast\s*\{[^}]*stroke:\s*#fff/s)
  assert.match(component, /arrowHead\(-endX, -1\).*arrowHead\(endX, 1\)/)
})

test('grabbing either end of the arc preserves the initial charm angle and cleans up capture', () => {
  assert.match(component, /dragOffset\.current = angleFrom\(e\.clientX, e\.clientY\) - rot/)
  assert.match(component, /angleFrom\(e\.clientX, e\.clientY\) - dragOffset\.current/)
  assert.match(component, /onLostPointerCapture=\{end\}/)
})
