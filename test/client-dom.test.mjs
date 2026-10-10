/**
 * Interaction tests: both badges and the settings page mounted together in a real DOM (jsdom),
 * sharing one controller. This file runs in its own process (node --test), so installing DOM
 * globals here cannot leak into the other test files.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { fakeHostFetch, fakeStorage, fakeTimers, serverState } from './client-env.mjs'

const NBSP = ' '
const require = createRequire(import.meta.url)

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1280 })
Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 })

const loads = []
dom.window.__ModuleLoader__ = { load: spec => loads.push(spec) }
await import('../lib/client.js')
const React = require('react')
const { act } = React
const { createRoot } = require('react-dom/client')
const exports = loads[0].factory(id => ({ react: React, 'react-dom': require('react-dom') })[id])
const t = exports.__test
const h = React.createElement

after(() => { dom.window.close() })

const rect = (box) => { dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top }) }
rect({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })

/** Mount `parts` in a fresh container with a fresh controller; returns helpers. */
async function mount({ wide = true, storage = fakeStorage(), fetchImpl = fakeHostFetch(), parts = ['header', 'side', 'settings'] } = {}) {
  const timers = fakeTimers()
  const controller = t.createController({ fetchImpl, timers, doc: dom.window.document, storage, lang: 'en', now: Date.now })
  const Header = t.createBadge(controller)
  const Side = t.createSidebarBadge(controller)
  const Settings = t.createSettings(controller)
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)
  const tree = (current = parts) => h(React.Fragment, null,
    current.includes('header') ? h(Header, { key: 'header' }) : null,
    current.includes('side') ? h(Side, { key: 'side', wide }) : null,
    current.includes('settings') ? h(Settings, { key: 'settings' }) : null)
  await act(async () => { root.render(tree()) })
  const $ = selector => container.querySelector(selector)
  const $$ = selector => [...dom.window.document.querySelectorAll(selector)]
  const click = async (element) => { await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)) }) }
  return {
    controller, fetchImpl, timers, container, root, $, $$, click, flush, tree,
    panels: () => $$('.dsh-ark-panel'),
    async rerender(current) { await act(async () => { root.render(tree(current)) }) },
    async dispose() {
      await act(async () => { root.unmount() })
      controller.dispose()
      container.remove()
    },
  }
}

test('both badges show the same amount from one shared state; the rail shows only the icon', async () => {
  const wide = await mount()
  await act(async () => { wide.controller.start() })
  await wide.flush()
  assert.equal(wide.$('.dsh-ark-badge').textContent, `1,234.50${NBSP}₽`)
  assert.equal(wide.$('.dsh-ark-side-text').textContent, `1,234.50${NBSP}₽`)
  assert.ok(wide.$('.dsh-ark-side svg'), 'the icon is there')
  assert.equal(wide.$('.dsh-ark-side-root').hasAttribute('data-rail'), false)
  await wide.dispose()

  const rail = await mount({ wide: false, parts: ['side'] })
  await act(async () => { rail.controller.start() })
  await rail.flush()
  assert.equal(rail.$('.dsh-ark-side-text'), null, 'no text in the 56 px rail: nothing to wrap or cut')
  assert.equal(rail.$('.dsh-ark-side').getAttribute('aria-label'), `Arckep: 1,234.50${NBSP}₽`)
  assert.equal(rail.$('.dsh-ark-side-root').hasAttribute('data-rail'), true)
  await rail.dispose()
})

test('two badges and the settings page make exactly the same requests as one badge did', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  assert.equal(m.fetchImpl.calls.length, 1, 'mounting any number of badges does not fetch; the controller polls once')
  assert.match(m.fetchImpl.calls[0].url, /^api\/arckep\.state\?/)
  await m.click(m.$('.dsh-ark-badge'))
  await m.flush()
  assert.equal(m.fetchImpl.calls.length, 2, 'opening a panel costs one state request, as before')
  await m.click(m.$('.dsh-ark-side'))
  await m.flush()
  assert.equal(m.fetchImpl.calls.length, 3, 'switching to the other panel is again one request')
  assert.ok(m.fetchImpl.calls.every(call => call.url.startsWith('api/arckep.state')))
  await m.dispose()
})

test('only one panel is open at a time, and clicking the other badge moves it', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  assert.equal(m.panels().length, 0)
  await m.click(m.$('.dsh-ark-badge'))
  assert.equal(m.panels().length, 1)
  assert.equal(m.$('.dsh-ark-badge').getAttribute('aria-expanded'), 'true')
  assert.equal(m.$('.dsh-ark-side').getAttribute('aria-expanded'), 'false')
  assert.equal(m.controller.getSnapshot().panel, 'header')

  // A real click is pointerdown (closes the other panel) followed by click (opens this one).
  await act(async () => { dom.window.document.querySelector('.dsh-ark-side').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })) })
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 1, 'never two panels')
  assert.equal(m.$('.dsh-ark-badge').getAttribute('aria-expanded'), 'false')
  assert.equal(m.$('.dsh-ark-side').getAttribute('aria-expanded'), 'true')
  assert.equal(m.controller.getSnapshot().panel, 'sidebar')

  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 0, 'the same badge toggles its panel')
  await m.dispose()
})

test('Escape and a click outside close the panel', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 1)
  await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(m.panels().length, 0)
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 1)
  await act(async () => { dom.window.document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })) })
  assert.equal(m.panels().length, 0)
  await m.click(m.$('.dsh-ark-side'))
  await act(async () => { m.panels()[0].dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })) })
  assert.equal(m.panels().length, 1, 'a click inside the panel keeps it open')
  await m.dispose()
})

test('the panel shows the balance, spending, top models, forecast and age, from either badge', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  for (const selector of ['.dsh-ark-badge', '.dsh-ark-side']) {
    await m.click(m.$(selector))
    const text = m.panels()[0].textContent
    for (const fragment of ['Balance', `1,234.50${NBSP}₽`, 'Today', '7 days', '30 days', 'Top models', 'anthropic/claude-opus', 'Enough for about 12 days', 'Updated 2 min ago', 'Refresh']) {
      assert.ok(text.includes(fragment), `${selector}: ${fragment}`)
    }
    assert.equal(m.panels()[0].querySelectorAll('.dsh-ark-row-label').length - 3, 5, 'top 5 models')
    await m.click(m.$(selector))
  }
  await m.dispose()
})

test('a refresh in one place is visible in the other badge at once', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  await m.click(m.$('.dsh-ark-side'))
  m.fetchImpl.answer(200, serverState({ balance: { rub: '77.70', corporate: false, corporateName: null } }))
  const button = m.panels()[0].querySelector('.dsh-ark-button')
  await m.click(button)
  await m.flush()
  assert.equal(m.fetchImpl.calls.at(-1).init.method, 'POST')
  assert.equal(m.$('.dsh-ark-badge').textContent, `77.70${NBSP}₽`, 'the header badge changed too')
  assert.equal(m.$('.dsh-ark-side-text').textContent, `77.70${NBSP}₽`)
  assert.equal(m.$('.dsh-ark-badge').getAttribute('data-tone'), 'warn')
  assert.equal(m.$('.dsh-ark-side').getAttribute('data-tone'), 'warn', 'same warning rule in both')
  await m.dispose()
})

test('both badges follow the same warning rules (threshold and forecast under 3 days)', async () => {
  const forecast = await mount()
  forecast.fetchImpl.fallback = { status: 200, body: serverState({ usage: { ...serverState().usage, forecastDaysLeft: 2.5 } }) }
  await act(async () => { forecast.controller.start() })
  await forecast.flush()
  assert.equal(forecast.$('.dsh-ark-badge').getAttribute('data-tone'), 'warn')
  assert.equal(forecast.$('.dsh-ark-side').getAttribute('data-tone'), 'warn')
  await forecast.dispose()

  const noKey = await mount()
  noKey.fetchImpl.fallback = { status: 200, body: serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true } }) }
  await act(async () => { noKey.controller.start() })
  await noKey.flush()
  assert.equal(noKey.$('.dsh-ark-side-text').textContent, 'Arckep')
  assert.equal(noKey.$('.dsh-ark-side').getAttribute('data-tone'), 'muted')
  await noKey.click(noKey.$('.dsh-ark-side'))
  assert.match(noKey.panels()[0].textContent, /No arckep key set/)
  await noKey.dispose()

  for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden']]) {
    const m = await mount()
    m.fetchImpl.fallback = { status: 200, body: serverState({ status: 'error', balance: null, usage: null, error: { code, status } }) }
    await act(async () => { m.controller.start() })
    await m.flush()
    assert.equal(m.$('.dsh-ark-side').getAttribute('data-tone'), 'error', code)
    await m.click(m.$('.dsh-ark-side'))
    assert.ok(m.panels()[0].textContent.includes(code === 'unauthorized' ? 'rejected the key (401)' : 'balance:read'), code)
    await m.dispose()
  }

  const stale = await mount()
  stale.fetchImpl.fallback = { status: 200, body: serverState({ stale: true, error: { code: 'network' } }) }
  await act(async () => { stale.controller.start() })
  await stale.flush()
  assert.equal(stale.$('.dsh-ark-side').getAttribute('data-tone'), 'stale')
  await stale.click(stale.$('.dsh-ark-side'))
  assert.ok(stale.panels()[0].textContent.includes('data is out of date'))
  await stale.dispose()
})

test('the sidebar setting removes only the sidebar badge, and closes its open panel', async () => {
  const storage = fakeStorage()
  const m = await mount({ storage })
  await act(async () => { m.controller.start() })
  await m.flush()
  assert.equal(m.$$('.dsh-ark-side').length, 1)
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 1)
  await act(async () => { m.controller.setPrefs({ sidebarBadge: false }) })
  assert.equal(m.$$('.dsh-ark-side').length, 0)
  assert.equal(m.panels().length, 0, 'its panel closed with it')
  assert.equal(m.$$('.dsh-ark-badge').length, 1, 'the header badge stays')
  assert.equal(m.$('.dsh-ark-side-root'), null, 'nothing left in the footer')
  assert.equal(JSON.parse(storage.map.get('dsh-arckep:prefs:v1')).sidebarBadge, false)
  await act(async () => { m.controller.resetPrefs() })
  assert.equal(m.$$('.dsh-ark-side').length, 1, 'default is on')
  await m.dispose()
})

test('the settings checkbox switches the sidebar badge on and off', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  const checkbox = [...m.$$('.dsh-ark-check')].find(label => label.textContent.includes('Show the balance in the sidebar')).querySelector('input')
  assert.equal(checkbox.checked, true, 'on by default')
  await m.click(checkbox)
  assert.equal(m.$$('.dsh-ark-side').length, 0)
  assert.equal(checkbox.checked, false)
  await m.click(checkbox)
  assert.equal(m.$$('.dsh-ark-side').length, 1)
  await m.dispose()
})

test('the saved setting is respected after a reload', async () => {
  const storage = fakeStorage({ data: { 'dsh-arckep:prefs:v1': JSON.stringify({ sidebarBadge: false }) } })
  const m = await mount({ storage })
  await act(async () => { m.controller.start() })
  await m.flush()
  assert.equal(m.$$('.dsh-ark-side').length, 0)
  assert.equal(m.$$('.dsh-ark-badge').length, 1)
  await m.dispose()
})

test('a badge that goes away closes its own panel (no orphaned open state)', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  await m.click(m.$('.dsh-ark-badge'))
  assert.equal(m.controller.getSnapshot().panel, 'header')
  await m.rerender(['side', 'settings'])
  assert.equal(m.controller.getSnapshot().panel, null)
  assert.equal(m.panels().length, 0)
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.panels().length, 1, 'the other badge still works')
  await m.dispose()
})

test('the panel always stays inside the viewport: above the sidebar foot, below the header, also at 420 px', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  const place = async (selector, box, width, height) => {
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: height })
    rect(box)
    await m.click(m.$(selector))
    const style = m.panels()[0].style
    const result = { top: style.top, bottom: style.bottom, left: style.left, right: style.right, maxHeight: style.maxHeight }
    await m.click(m.$(selector))
    return result
  }
  // Sidebar foot on a wide screen: opens upwards from the badge, left-aligned with it.
  assert.deepEqual(await place('.dsh-ark-side', { left: 12, right: 268, top: 708, bottom: 744, width: 256, height: 36 }, 1280, 800),
    { top: '', bottom: '98px', left: '12px', right: '', maxHeight: '694px' })
  // Narrow screen with the badge at the far right: the panel is pulled back inside.
  const narrow = await place('.dsh-ark-side', { left: 400, right: 420, top: 700, bottom: 736, width: 20, height: 36 }, 420, 800)
  assert.equal(narrow.left, '92px', '420 - 320 - 8')
  assert.ok(Number.parseInt(narrow.left, 10) + 320 <= 420 - 8)
  // Very little room above: the panel scrolls instead of leaving the screen.
  const tight = await place('.dsh-ark-side', { left: 12, right: 268, top: 100, bottom: 136, width: 256, height: 36 }, 1280, 800)
  assert.equal(tight.maxHeight, '120px', 'never smaller than 120 px, scrolls inside')
  // Header badge: below it, right-aligned.
  assert.deepEqual(await place('.dsh-ark-badge', { left: 1160, right: 1232, top: 13, bottom: 37, width: 72, height: 24 }, 1280, 800),
    { top: '43px', bottom: '', left: '', right: '48px', maxHeight: '' })
  await m.dispose()
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 })
  rect({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
})

test('unmounting everything leaves no panel, no timer and no listener behind', async () => {
  const m = await mount()
  await act(async () => { m.controller.start() })
  await m.flush()
  await m.click(m.$('.dsh-ark-side'))
  assert.equal(m.timers.pending, 1, 'one scheduled poll')
  await m.dispose()
  assert.equal(m.timers.pending, 0)
  assert.equal(dom.window.document.querySelectorAll('.dsh-ark-panel').length, 0)
  assert.equal(m.fetchImpl.calls.at(-1).init.signal.aborted, true, 'in-flight request signal aborted on dispose')
})
