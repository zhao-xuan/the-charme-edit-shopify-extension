import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const script = html.match(/<script data-charme-startup>([\s\S]*?)<\/script>/)[1]

function startupHarness() {
  const message = { textContent: 'Loading your design studio...' }
  const reload = { hidden: true }
  const events = {}
  const errors = []
  let mounted = false
  let timeout
  const startup = {
    role: 'status',
    setAttribute(name, value) { this[name] = value },
    querySelector: (selector) => selector === '[data-startup-message]' ? message : reload,
  }
  vm.runInNewContext(script, {
    document: { getElementById: () => mounted ? null : startup },
    window: { addEventListener: (name, callback) => { events[name] = callback } },
    console: { error: (message) => errors.push(message) },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 30000)
      timeout = callback
    },
  })
  return { startup, message, reload, events, errors, timeout: () => timeout(), mount: () => { mounted = true } }
}

test('HTML displays startup status before any application modules or APIs load', () => {
  assert.match(html, /id="charme-startup" role="status"/)
  assert.match(html, /Loading your design studio/)
  assert.match(html, /<noscript>Please enable JavaScript/)
  assert.ok(html.indexOf('id="charme-startup"') < html.indexOf('<script type="module"'))
  assert.match(html, /data-startup-reload[^>]+onclick="location.reload\(\)"/)
})

test('stalled startup exposes a visible, logged failure and retry after 30 seconds', () => {
  const api = startupHarness()
  api.timeout()
  assert.equal(api.startup.role, 'alert')
  assert.match(api.message.textContent, /could not load/)
  assert.equal(api.reload.hidden, false)
  assert.equal(api.errors.length, 1)
})

test('entry module and lazy module failures immediately expose retry', () => {
  for (const event of ['error', 'vite:preloadError']) {
    const api = startupHarness()
    api.events[event]({ target: { tagName: 'SCRIPT', type: 'module' } })
    assert.equal(api.reload.hidden, false)
    assert.equal(api.startup.role, 'alert')
  }
})

test('unrelated resource failures do not replace the loading status', () => {
  const api = startupHarness()
  api.events.error({ target: { tagName: 'IMG' } })
  assert.equal(api.reload.hidden, true)
  assert.equal(api.errors.length, 0)
})

test('startup watchdog leaves a mounted application untouched', () => {
  const api = startupHarness()
  api.mount()
  api.timeout()
  api.events['vite:preloadError']()
  assert.equal(api.errors.length, 0)
  assert.equal(api.reload.hidden, true)
})
