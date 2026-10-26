import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(new URL('../components/ProductStage.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

test('rotation drag target is limited to the visible thumb, not the full ring', () => {
  const hitCircle = component.match(/<circle\s+className="charm-dial__hit"([\s\S]*?)\/>/)
  assert.ok(hitCircle)
  assert.match(hitCircle[1], /cx=\{tx\}/)
  assert.match(hitCircle[1], /cy=\{ty\}/)
  assert.match(hitCircle[1], /r=\{18\}/)
  assert.doesNotMatch(hitCircle[1], /cx=\{c\}|cy=\{c\}|r=\{R\}/)
})

test('rotation controls have a raised layer and an unmistakable draggable handle', () => {
  assert.match(styles, /\.charm-dial\s*\{[^}]*z-index:\s*100/s)
  assert.match(styles, /\.charm-dial__thumb\s*\{[^}]*fill:\s*#d4380d[^}]*stroke:\s*#fff/s)
  assert.match(styles, /\.charm-dial__icon\s*\{[^}]*stroke:\s*#fff/s)
})
