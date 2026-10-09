import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { fakeDocument, fakeHostFetch, fakeStorage, fakeTimers, loadClient, serverState, snapshotOf } from './client-env.mjs'

const NBSP = ' '
const KEY_TYPED = 'ark_test_0000_typed_in_ui'

// ------------------------------------------------------------------- loader contract

test('lib/client.js registers one lazy-CJS factory and requires only platform modules', async () => {
  const { loads, required, exports } = await loadClient()
  assert.equal(loads.length, 1)
  assert.equal(loads[0].id, 'dsh-arckep')
  assert.equal(typeof loads[0].factory, 'function')
  assert.deepEqual([...new Set(required)].sort(), ['react', 'react-dom'])
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
})

test('the factory only ever asks for modules in DSH\'s shared platform table', async () => {
  const { required, exports } = await loadClient()
  const seen = new Set(required)
  // Requires happen at factory time; apply() must not need anything else.
  for (const id of seen) assert.ok(['react', 'react-dom'].includes(id), id)
  assert.equal(typeof exports.apply, 'function')
})

// --------------------------------------------------------------------------- money

test('formatMoney: "1 234,50 ₽" with non-breaking spaces and a decimal comma (ru)', async () => {
  const { t } = await loadClient()
  assert.equal(t.formatMoney('1234.5', 'ru'), `1${NBSP}234,50${NBSP}₽`)
  assert.equal(t.formatMoney('0', 'ru'), `0,00${NBSP}₽`)
  assert.equal(t.formatMoney('150.00', 'ru'), `150,00${NBSP}₽`)
  assert.equal(t.formatMoney('1234567.891', 'ru'), `1${NBSP}234${NBSP}567,89${NBSP}₽`)
  assert.equal(t.formatMoney('999999999999999', 'ru'), `999${NBSP}999${NBSP}999${NBSP}999${NBSP}999,00${NBSP}₽`)
  assert.equal(t.formatMoney('12', 'ru'), `12,00${NBSP}₽`)
  assert.equal(t.formatMoney('1234.5', 'en'), `1,234.50${NBSP}₽`)
  assert.equal(t.formatMoney('1234.5', 'zh'), `1${NBSP}234,50${NBSP}₽`, 'unknown language falls back to the ruble style')
})

test('formatMoney rounds half-up to kopecks exactly, without floating point', async () => {
  const { t } = await loadClient()
  const r = value => t.formatMoney(value, 'en').replace(`${NBSP}₽`, '')
  assert.equal(r('0.005'), '0.01')
  assert.equal(r('0.004'), '0.00')
  assert.equal(r('1.005'), '1.01', 'the classic float trap: 1.005 is 1.00499999... as a float')
  assert.equal(r('2.675'), '2.68')
  assert.equal(r('0.994'), '0.99')
  assert.equal(r('0.995'), '1.00')
  assert.equal(r('99.999'), '100.00')
  assert.equal(r('10.0000000001'), '10.00')
  assert.equal(r('-12.345'), '-12.35')
  assert.equal(r('-0.004'), '0.00', 'no "-0.00"')
  assert.equal(r('-0'), '0.00')
  assert.equal(r('123456789012345.999'), '123,456,789,012,346.00')
})

test('formatMoney returns null for anything that is not a plain decimal string', async () => {
  const { t } = await loadClient()
  for (const bad of ['abc', '', '1e5', '1,5', '1 000', null, undefined, 12, {}, '1.', '.5', '--1']) {
    assert.equal(t.formatMoney(bad, 'ru'), null, JSON.stringify(bad))
  }
})

test('the ruble sign is on every formatted amount, in both languages', async () => {
  const { t } = await loadClient()
  for (const lang of ['ru', 'en']) {
    for (const amount of ['0', '5', '1234.5', '-3.2']) assert.ok(t.formatMoney(amount, lang).endsWith(`${NBSP}₽`))
  }
})

// ----------------------------------------------------------------------- language

test('pickLanguage: ru -> ru, en -> en, other known locale -> en, unknown -> browser, else ru', async () => {
  const { t } = await loadClient()
  assert.equal(t.pickLanguage('ru'), 'ru')
  assert.equal(t.pickLanguage('ru-RU'), 'ru')
  assert.equal(t.pickLanguage('RU'), 'ru')
  assert.equal(t.pickLanguage('en'), 'en')
  assert.equal(t.pickLanguage('en-GB'), 'en')
  assert.equal(t.pickLanguage('zh'), 'en')
  assert.equal(t.pickLanguage('ja', ['ru']), 'en', 'a known DSH locale wins over the browser list')
  assert.equal(t.pickLanguage(undefined, ['de-DE', 'en-US']), 'en')
  assert.equal(t.pickLanguage(undefined, ['de-DE', 'ru-RU']), 'ru')
  assert.equal(t.pickLanguage('', undefined), 'ru', 'nothing known: Russian')
  assert.equal(t.pickLanguage(null, []), 'ru')
  assert.equal(t.pickLanguage(undefined, ['de', 'fr']), 'ru')
})

test('both dictionaries have the same keys and placeholders, and no empty text', async () => {
  const { t } = await loadClient()
  const { ru, en } = t.DICT
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort())
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
  for (const key of Object.keys(ru)) {
    assert.ok(ru[key].trim() !== '' && en[key].trim() !== '', key)
    assert.equal(placeholders(ru[key]), placeholders(en[key]), `placeholders of ${key}`)
  }
  assert.match(ru.settingsTitle, /[а-яё]/i)
  assert.doesNotMatch(en.settingsTitle, /[а-яё]/i)
})

test('every error code the Host or the routes can produce has a translated message', async () => {
  const { t } = await loadClient()
  const sources = ['api.js', 'service.js', 'routes.js'].map(file => readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8')).join('\n')
  const codes = new Set([
    ...[...sources.matchAll(/new ArckepError\('([a-z_]+)'/g)].map(m => m[1]),
    ...[...sources.matchAll(/new HttpError\(\d+, '([a-z_]+)'\)/g)].map(m => m[1]),
    ...[...sources.matchAll(/return '([a-z_]+)'/g)].map(m => m[1]).filter(code => /^(redirect|unauthorized|payment_required|forbidden|not_found|rate_limited|server_error|http_error)$/.test(code)),
    'network', 'timeout', 'host', 'empty', 'internal',
  ])
  codes.delete('aborted') // never reaches the UI: an aborted refresh is dropped silently
  assert.ok(codes.size >= 15, `found ${[...codes]}`)
  for (const code of codes) {
    assert.ok(`err.${code}` in t.DICT.ru, `missing ru text for ${code}`)
    assert.ok(`err.${code}` in t.DICT.en, `missing en text for ${code}`)
  }
})

test('formatAgo: just now / minutes / hours / days', async () => {
  const { t } = await loadClient()
  const ru = t.makeTranslator('ru')
  const en = t.makeTranslator('en')
  assert.equal(t.formatAgo(0, ru), 'только что')
  assert.equal(t.formatAgo(59_999, ru), 'только что')
  assert.equal(t.formatAgo(60_000, ru), '1 мин назад')
  assert.equal(t.formatAgo(59 * 60_000, en), '59 min ago')
  assert.equal(t.formatAgo(60 * 60_000, en), '1 h ago')
  assert.equal(t.formatAgo(25 * 3_600_000, ru), '1 дн. назад')
  assert.equal(t.formatAgo(-5000, en), 'just now')
})

// -------------------------------------------------------------------------- view

test('deriveView: low-balance warning uses a strict "below" comparison on exact decimals', async () => {
  const { t } = await loadClient()
  const tone = (rub, prefs = {}, extra = {}) => t.deriveView(snapshotOf({
    overrides: prefs,
    server: serverState({ balance: { rub, corporate: false, corporateName: null }, ...extra }),
  }), 1_760_000_000_000).tone
  assert.equal(tone('99.99'), 'warn')
  assert.equal(tone('100.00'), 'ok')
  assert.equal(tone('100.01'), 'ok')
  assert.equal(tone('0.00'), 'warn')
  assert.equal(tone('-1.00'), 'warn')
  assert.equal(tone('500', { warnBelowRub: 600 }), 'warn')
  assert.equal(tone('500', { warnBelowRub: 0 }), 'ok')
  assert.equal(tone('99.999', { warnBelowRub: 100 }), 'warn', '99.999 < 100 even though it rounds to 100,00')
})

test('deriveView: a forecast under 3 days warns, 3 days does not, a missing forecast is ignored', async () => {
  const { t } = await loadClient()
  const tone = forecast => t.deriveView(snapshotOf({
    server: serverState({ usage: { ...serverState().usage, forecastDaysLeft: forecast } }),
  }), 1_760_000_000_000).tone
  assert.equal(tone(2.9), 'warn')
  assert.equal(tone(0), 'warn')
  assert.equal(tone(3), 'ok')
  assert.equal(tone(12), 'ok')
  assert.equal(tone(null), 'ok')
  const unavailable = t.deriveView(snapshotOf({ server: serverState({ usage: { state: 'unavailable', required: null } }) }), 1_760_000_000_000)
  assert.equal(unavailable.tone, 'ok')
  assert.equal(unavailable.forecast, null)
})

test('deriveView: kinds and tones for every state', async () => {
  const { t } = await loadClient()
  const view = (partial) => t.deriveView(snapshotOf(partial), 1_760_000_000_000)
  assert.equal(view({ server: null }).kind, 'loading')
  assert.equal(view({ server: null }).badgeText, '…')
  assert.equal(view({ server: null, hostError: true }).kind, 'error')
  const noKey = view({ server: serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true } }) })
  assert.equal(noKey.kind, 'no_key')
  assert.equal(noKey.tone, 'muted')
  assert.equal(noKey.badgeText, 'Arckep')
  const error = view({ server: serverState({ status: 'error', balance: null, usage: null, error: { code: 'unauthorized', status: 401 } }) })
  assert.equal(error.kind, 'error')
  assert.equal(error.tone, 'error')
  const stale = view({ server: serverState({ stale: true, error: { code: 'server_error', status: 503 } }) })
  assert.equal(stale.kind, 'ok')
  assert.equal(stale.stale, true)
  assert.equal(stale.tone, 'stale')
  assert.match(stale.title, /данные устарели/)
  const hostDown = view({ hostError: true })
  assert.equal(hostDown.stale, true, 'last data kept while DSH itself is unreachable')
  assert.equal(hostDown.errorCode, 'host')
  assert.equal(view({}).money, `1${NBSP}234,50${NBSP}₽`)
  assert.equal(view({ lang: 'en' }).money, `1,234.50${NBSP}₽`)
})

test('deriveView: "updated N min ago" combines the Host timestamp with local elapsed time', async () => {
  const { t } = await loadClient()
  const base = snapshotOf({ receivedAt: 1_760_000_000_000 })
  assert.equal(t.deriveView(base, 1_760_000_000_000).ageMs, 120_000)
  assert.equal(t.deriveView(base, 1_760_000_000_000 + 180_000).ageMs, 300_000)
  assert.equal(t.deriveView(snapshotOf({ server: serverState({ fetchedAt: null }) }), 0).ageMs, null)
})

// --------------------------------------------------------------------- controller

function makeController(t, { storage = fakeStorage(), doc = fakeDocument(), fetchImpl = fakeHostFetch(), timers = fakeTimers(), lang = 'ru', now = () => 1_760_000_000_000 } = {}) {
  const controller = t.createController({ fetchImpl, timers, doc, storage, lang, now })
  return { controller, storage, doc, fetchImpl, timers }
}

test('controller: first poll is a GET with credentials and the default view; next poll is scheduled', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  controller.start()
  await timers.advance(0)
  assert.equal(fetchImpl.calls.length, 1)
  const [call] = fetchImpl.calls
  assert.equal(call.url, 'api/arckep.state?keyOnly=0&interval=300', 'document-relative, never absolute')
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.credentials, 'include')
  assert.equal(call.init.cache, 'no-store')
  assert.equal(controller.getSnapshot().server.status, 'ok')
  assert.deepEqual(timers.delays(), [300_000])
  controller.dispose()
})

test('controller: polls again after the interval, not before', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  controller.start()
  await timers.advance(0)
  await timers.advance(299_999)
  assert.equal(fetchImpl.calls.length, 1)
  await timers.advance(1)
  assert.equal(fetchImpl.calls.length, 2)
  controller.dispose()
})

test('controller: nothing is fetched while the page is hidden; polling resumes when it is shown', async () => {
  const { t } = await loadClient()
  const doc = fakeDocument()
  let clock = 1_760_000_000_000
  const { controller, fetchImpl, timers } = makeController(t, { doc, now: () => clock })
  controller.start()
  await timers.advance(0)
  doc.visibilityState = 'hidden'
  clock += 300_000
  await timers.advance(300_000)
  assert.equal(fetchImpl.calls.length, 1, 'hidden: tick only reschedules')
  assert.equal(timers.pending, 1)
  doc.visibilityState = 'visible'
  doc.fire('visibilitychange')
  await timers.advance(0)
  assert.equal(fetchImpl.calls.length, 2, 'visible again and overdue: refresh')
  controller.dispose()
})

test('controller: dispose clears the timer, aborts requests, removes listeners and ignores late answers', async () => {
  const { t } = await loadClient()
  const doc = fakeDocument()
  let release
  const fetchImpl = fakeHostFetch()
  fetchImpl.fallback = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    release = () => resolve({ ok: true, status: 200, json: async () => serverState() })
  })
  const { controller, timers } = makeController(t, { doc, fetchImpl })
  controller.start()
  await timers.advance(0)
  assert.equal(doc.listeners.size, 1)
  controller.dispose()
  assert.equal(timers.pending, 0)
  assert.equal(doc.listeners.size, 0)
  assert.equal(fetchImpl.calls[0].init.signal.aborted, true)
  assert.equal(controller.getSnapshot().server, null)
  controller.refresh()
  await timers.advance(0)
  assert.equal(fetchImpl.calls.length, 1, 'no requests after dispose')
  void release
})

test('controller: a failing Host request shows a host error, keeps old data and retries within a minute', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  controller.start()
  await timers.advance(0)
  fetchImpl.queue.push(new TypeError('Failed to fetch'))
  await controller.refresh()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.hostError, true)
  assert.equal(snapshot.server.balance.rub, '1234.5', 'the last good data stays on screen')
  assert.deepEqual(timers.delays(), [60_000])
  fetchImpl.answer(401, { error: 'x' })
  await controller.refresh()
  assert.equal(controller.getSnapshot().hostError, true, 'a 401 from DSH is a host error too')
  await controller.refresh()
  assert.equal(controller.getSnapshot().hostError, false)
  controller.dispose()
})

test('controller: garbage from the Host is never trusted', async () => {
  const { t } = await loadClient()
  for (const body of [null, 'text', [], { v: 2, status: 'ok' }, { v: 1, status: 'weird' }, { status: 'ok' }]) {
    const { controller, fetchImpl, timers } = makeController(t)
    fetchImpl.fallback = { status: 200, body }
    controller.start()
    await timers.advance(0)
    assert.equal(controller.getSnapshot().server, null, JSON.stringify(body))
    assert.equal(controller.getSnapshot().hostError, true)
    controller.dispose()
  }
})

test('controller: a manual refresh is a POST; superseded answers are ignored', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  let releaseFirst
  fetchImpl.queue.push(() => new Promise((resolve) => { releaseFirst = () => resolve({ ok: true, status: 200, json: async () => serverState({ balance: { rub: '1.00', corporate: false, corporateName: null } }) }) }))
  const first = controller.refresh()
  await timers.advance(0)
  fetchImpl.answer(200, serverState({ balance: { rub: '2.00', corporate: false, corporateName: null } }))
  await controller.refresh({ force: true })
  assert.equal(fetchImpl.calls[1].init.method, 'POST')
  assert.equal(fetchImpl.calls[1].url, 'api/arckep.refresh')
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { keyOnly: false })
  assert.equal(fetchImpl.calls[1].init.headers['content-type'], 'application/json')
  releaseFirst()
  await first
  assert.equal(controller.getSnapshot().server.balance.rub, '2.00', 'the older answer did not overwrite the newer one')
  controller.dispose()
})

test('controller: preferences persist, are validated, and a blocked storage does not break anything', async () => {
  const { t } = await loadClient()
  const storage = fakeStorage()
  const { controller, fetchImpl, timers } = makeController(t, { storage })
  controller.start()
  await timers.advance(0)
  controller.setPrefs({ intervalSeconds: 120, warnBelowRub: 250, keyOnly: true })
  await timers.advance(0)
  assert.deepEqual(JSON.parse(storage.map.get('dsh-arckep:prefs:v1')), { intervalSeconds: 120, warnBelowRub: 250, keyOnly: true })
  assert.equal(fetchImpl.calls.at(-1).url, 'api/arckep.state?keyOnly=1&interval=120', 'changing the view refetches with the new settings')
  controller.setPrefs({ intervalSeconds: 5 })
  assert.equal(JSON.parse(storage.map.get('dsh-arckep:prefs:v1')).intervalSeconds, 60, 'clamped to the 60 s minimum')
  controller.setPrefs({ warnBelowRub: -5 })
  assert.equal(JSON.parse(storage.map.get('dsh-arckep:prefs:v1')).warnBelowRub, 250, 'a negative threshold is rejected')
  controller.dispose()

  const reloaded = makeController(t, { storage })
  assert.equal(reloaded.controller.getSnapshot().overrides.warnBelowRub, 250)
  assert.deepEqual(reloaded.controller.getSnapshot().overrides, { intervalSeconds: 60, warnBelowRub: 250, keyOnly: true })
  reloaded.controller.resetPrefs()
  assert.equal(storage.map.has('dsh-arckep:prefs:v1'), false)
  reloaded.controller.dispose()

  const blocked = makeController(t, { storage: fakeStorage({ throws: true }) })
  assert.doesNotThrow(() => blocked.controller.setPrefs({ warnBelowRub: 10 }))
  assert.equal(blocked.controller.getSnapshot().overrides.warnBelowRub, 10, 'kept in memory')
  blocked.controller.dispose()
  const corrupt = makeController(t, { storage: fakeStorage({ data: { 'dsh-arckep:prefs:v1': '{"intervalSeconds":"abc","warnBelowRub":"x","keyOnly":"yes","evil":1}' } }) })
  assert.deepEqual(corrupt.controller.getSnapshot().overrides, {})
  corrupt.controller.dispose()
})

test('controller: the interface language follows DSH unless the user picks one in Settings', async () => {
  const { t } = await loadClient()
  const storage = fakeStorage()
  const { controller, timers } = makeController(t, { storage, lang: 'en' })
  assert.equal(controller.getSnapshot().lang, 'en')
  controller.setLanguage('ru')
  assert.equal(controller.getSnapshot().lang, 'ru', 'DSH language change is followed')
  controller.setPrefs({ lang: 'en' })
  assert.equal(controller.getSnapshot().lang, 'en')
  assert.equal(JSON.parse(storage.map.get('dsh-arckep:prefs:v1')).lang, 'en')
  controller.setLanguage('zh')
  assert.equal(controller.getSnapshot().lang, 'en', 'the user\'s choice wins over DSH')
  controller.setPrefs({ lang: 'de' })
  assert.equal(controller.getSnapshot().lang, 'en', 'an unsupported language is ignored')
  controller.setPrefs({ lang: null })
  assert.equal(controller.getSnapshot().lang, 'zh', 'null returns to "same as DSH"')
  assert.equal(storage.map.has('dsh-arckep:prefs:v1') && 'lang' in JSON.parse(storage.map.get('dsh-arckep:prefs:v1')), false)
  controller.setPrefs({ lang: 'ru' })
  controller.dispose()
  const again = makeController(t, { storage, lang: 'en' })
  assert.equal(again.controller.getSnapshot().lang, 'ru', 'persisted across reloads')
  again.controller.resetPrefs()
  assert.equal(again.controller.getSnapshot().lang, 'en')
  again.controller.dispose()
  void timers
})

test('controller: a deployment default for keyOnly arriving with the first answer triggers one refetch', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  fetchImpl.fallback = { status: 200, body: serverState({ defaults: { refreshSeconds: 120, warnBelowRub: 50, keyOnly: true } }) }
  controller.start()
  await timers.advance(0)
  await timers.advance(0)
  assert.equal(fetchImpl.calls.length, 2)
  assert.equal(fetchImpl.calls[0].url, 'api/arckep.state?keyOnly=0&interval=300')
  assert.equal(fetchImpl.calls[1].url, 'api/arckep.state?keyOnly=1&interval=120')
  assert.deepEqual(timers.delays(), [120_000])
  controller.dispose()
})

test('controller: saving a key sends it once, never keeps it, and reports the outcome', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  controller.start()
  await timers.advance(0)
  fetchImpl.answer(200, serverState())
  assert.equal(await controller.saveKey(`  ${KEY_TYPED}  `), true)
  const call = fetchImpl.calls.at(-1)
  assert.equal(call.url, 'api/arckep.key-set')
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(call.init.body), { key: KEY_TYPED, keyOnly: false })
  const everythingRemembered = JSON.stringify(controller.getSnapshot())
  assert.ok(!everythingRemembered.includes(KEY_TYPED), 'the snapshot never holds the key')
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'saved', code: null })

  fetchImpl.answer(200, serverState({ status: 'error', balance: null, usage: null, error: { code: 'unauthorized', status: 401 } }))
  await controller.saveKey(KEY_TYPED)
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'savedWithError', code: 'unauthorized' })

  fetchImpl.answer(400, { error: 'invalid_key' })
  assert.equal(await controller.saveKey(KEY_TYPED), false)
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'error', code: 'invalid_key' })
  fetchImpl.answer(409, { error: 'read_only' })
  await controller.saveKey(KEY_TYPED)
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'error', code: 'read_only' })
  fetchImpl.queue.push(new TypeError('offline'))
  await controller.saveKey(KEY_TYPED)
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'error', code: 'host' })
  assert.equal(await controller.saveKey('   '), false)
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'error', code: 'empty' })
  assert.ok(!JSON.stringify(controller.getSnapshot()).includes(KEY_TYPED))
  controller.dispose()
})

test('controller: deleting the key posts to key-clear and shows the empty state', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  controller.start()
  await timers.advance(0)
  fetchImpl.answer(200, serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true } }))
  assert.equal(await controller.clearKey(), true)
  assert.equal(fetchImpl.calls.at(-1).url, 'api/arckep.key-clear')
  assert.equal(controller.getSnapshot().server.status, 'no_key')
  assert.deepEqual(controller.getSnapshot().notice, { kind: 'deleted', code: null })
  controller.dispose()
})

test('controller: a no-key state is polled rarely (at most every 5 minutes)', async () => {
  const { t } = await loadClient()
  const { controller, fetchImpl, timers } = makeController(t)
  fetchImpl.fallback = { status: 200, body: serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true }, defaults: { refreshSeconds: 60, warnBelowRub: 100, keyOnly: false } }) }
  controller.start()
  await timers.advance(0)
  assert.deepEqual(timers.delays(), [300_000])
  controller.dispose()
})

// ------------------------------------------------------------------------- apply

function fakeContext() {
  const effects = []
  const injected = []
  const registered = []
  const locale = { active: 'en', listeners: new Set(), getSnapshot() { return { active: this.active } }, subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) } }
  const ctx = {
    effect(factory, label) { const dispose = factory(); effects.push({ label, dispose }); return dispose },
    locale,
    slots: {
      inject(name, factory) {
        injected.push(name)
        const dispose = factory()
        return () => { dispose?.() }
      },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
  }
  return { ctx, effects, injected, registered, locale }
}

test('apply: injects into the header and settings slots and registers every side effect', async () => {
  const { exports } = await loadClient()
  const fake = fakeContext()
  const doc = fakeDocument()
  const savedDocument = globalThis.document
  const savedFetch = globalThis.fetch
  globalThis.document = doc
  globalThis.fetch = fakeHostFetch()
  try {
    exports.apply(fake.ctx)
    assert.deepEqual(fake.injected, ['conversation.session.header.utilities', 'settings.section'])
    assert.deepEqual(fake.registered.map(r => [r.options.name, r.options.id]), [
      ['conversation.session.header.utilities', 'arckep'],
      ['settings.section', 'arckep'],
    ])
    assert.equal(fake.registered[1].options.label(), 'Arckep')
    assert.ok(fake.registered.every(r => typeof r.component === 'function'))
    assert.deepEqual(fake.effects.map(e => e.label), ['dsh-arckep: styles', 'dsh-arckep: locale', 'dsh-arckep: poller', 'dsh-arckep: header badge', 'dsh-arckep: settings page'])
    assert.equal(doc.head.children.length, 1)
    assert.equal(doc.head.children[0].attrs['data-plugin'], 'dsh-arckep')
    assert.equal(fake.locale.listeners.size, 1)
    assert.equal(doc.listeners.size, 1)
    for (const { dispose } of fake.effects) dispose()
    assert.equal(doc.head.children[0].removed, true, 'the style tag is removed on unload')
    assert.equal(fake.locale.listeners.size, 0, 'the locale subscription is released')
    assert.equal(doc.listeners.size, 0, 'the visibilitychange listener is released')
  } finally {
    globalThis.document = savedDocument
    globalThis.fetch = savedFetch
  }
})

test('apply: follows the DSH locale (en -> ru) without a reload', async () => {
  const { exports, t } = await loadClient()
  const fake = fakeContext()
  const savedDocument = globalThis.document
  const savedFetch = globalThis.fetch
  globalThis.document = fakeDocument()
  globalThis.fetch = fakeHostFetch()
  try {
    exports.apply(fake.ctx)
    const [, settings] = fake.registered
    assert.equal(typeof settings.component, 'function')
    assert.equal(t.pickLanguage(fake.locale.getSnapshot().active), 'en')
    fake.locale.active = 'ru'
    for (const listener of fake.locale.listeners) listener()
    for (const { dispose } of fake.effects) dispose()
  } finally {
    globalThis.document = savedDocument
    globalThis.fetch = savedFetch
  }
})

// ------------------------------------------------------------------------ render

function panel(t, partial = {}, now = 1_760_000_000_000) {
  const view = t.deriveView(snapshotOf(partial), now)
  return renderToStaticMarkup(t.React.createElement(t.PanelBody, { view, refreshing: false, onRefresh() {} }))
}

test('PanelBody (ru): balance, three periods, top-5 models, forecast, freshness and a refresh button', async () => {
  const loaded = await loadClient()
  const html = panel({ ...loaded.t, React: loaded.React })
  const text = html.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' | ')
  assert.match(text, /Баланс/)
  assert.ok(html.includes(`1${NBSP}234,50${NBSP}₽`))
  for (const label of ['Сегодня', '7 дней', '30 дней']) assert.ok(html.includes(label), label)
  assert.ok(html.includes(`1,23${NBSP}₽`) && html.includes(`10,50${NBSP}₽`) && html.includes(`42,00${NBSP}₽`))
  const modelRows = [...html.matchAll(/class="dsh-ark-row-label"[^>]*>([^<]+)</g)].map(m => m[1]).filter(m => m.includes('/'))
  assert.equal(modelRows.length, 5, 'top 5 models only')
  assert.ok(!html.includes('google/sixth'))
  assert.ok(html.includes('Хватит примерно на 12 дн.'))
  assert.ok(html.includes('Обновлено 2 мин назад'))
  assert.ok(html.includes('>Обновить<'))
})

test('PanelBody (en) speaks English', async () => {
  const loaded = await loadClient()
  const html = panel({ ...loaded.t, React: loaded.React }, { lang: 'en' })
  assert.ok(html.includes('Balance') && html.includes('Spending') && html.includes('Top models'))
  assert.ok(html.includes('Enough for about 12 days'))
  assert.ok(html.includes('Updated 2 min ago'))
  assert.ok(html.includes('>Refresh<'))
  assert.ok(html.includes(`1,234.50${NBSP}₽`))
})

test('PanelBody: corporate wallet is labelled with its name', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const named = panel(t, { server: serverState({ balance: { rub: '99999.99', corporate: true, corporateName: 'ООО «Пример»' } }) })
  assert.ok(named.includes('Корпоративный кошелёк: ООО «Пример»'))
  const anonymous = panel(t, { server: serverState({ balance: { rub: '5.00', corporate: true, corporateName: null } }) })
  assert.ok(anonymous.includes('Корпоративный кошелёк') && !anonymous.includes('null'))
  const personal = panel(t)
  assert.ok(!personal.includes('Корпоративный'))
})

test('PanelBody: usage 404 hides the spending block with a hint instead of an error', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const html = panel(t, { server: serverState({ usage: { state: 'unavailable', required: null } }) })
  assert.ok(html.includes('Расход пока недоступен на стороне arckep.ru.'))
  assert.ok(!html.includes('Сегодня') && !html.includes('Топ моделей'))
  assert.ok(html.includes(`1${NBSP}234,50${NBSP}₽`), 'the balance is still shown')
  assert.ok(!html.includes('role="status"'), 'no error banner')
  const forbidden = panel(t, { server: serverState({ usage: { state: 'forbidden', required: ['usage:read'] } }) })
  assert.ok(forbidden.includes('usage:read'))
})

test('PanelBody: no key shows the hint, no ruble amount and no fake zero', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const html = panel(t, { server: serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true } }) })
  assert.ok(html.includes('Ключ arckep не задан'))
  assert.ok(html.includes('Откройте Настройки → Arckep'))
  assert.ok(!html.includes('₽') && !html.includes('0,00'))
})

test('PanelBody: the 403 text names the scope once, with a default when the server gave none', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const scopeCount = html => (html.match(/balance:read/g) ?? []).length
  const given = panel(t, { server: serverState({ status: 'error', balance: null, usage: null, error: { code: 'forbidden', status: 403, required: ['balance:read'] } }) })
  assert.equal(scopeCount(given), 1)
  const missing = panel(t, { server: serverState({ status: 'error', balance: null, usage: null, error: { code: 'forbidden', status: 403 } }) })
  assert.equal(scopeCount(missing), 1)
  const other = panel(t, { server: serverState({ status: 'error', balance: null, usage: null, error: { code: 'forbidden', status: 403, required: ['x:y'] } }) })
  assert.ok(other.includes('(x:y)') && !other.includes('balance:read'))
})

test('PanelBody: errors are understandable; stale data stays visible and is flagged', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const cases = {
    unauthorized: 'не принял ключ (401)',
    forbidden: 'balance:read',
    payment_required: '402',
    rate_limited: '429',
    server_error: '5xx',
    network: 'Нет связи с arckep.ru',
    timeout: 'не ответил за 10 секунд',
    redirect: 'перенаправлением',
    bad_response: 'Непонятный ответ',
  }
  for (const [code, fragment] of Object.entries(cases)) {
    const html = panel(t, { server: serverState({ status: 'error', balance: null, usage: null, error: { code, status: 500, required: code === 'forbidden' ? ['balance:read'] : undefined } }) })
    assert.ok(html.includes(fragment), `${code}: ${fragment}`)
    assert.ok(html.includes('role="status"'))
    assert.ok(!html.includes('₽'), 'no amount when there is no data')
  }
  const stale = panel(t, { server: serverState({ stale: true, error: { code: 'network' } }) })
  assert.ok(stale.includes(`1${NBSP}234,50${NBSP}₽`), 'old balance still visible')
  assert.ok(stale.includes('данные устарели'))
  assert.ok(stale.includes('Нет связи с arckep.ru'))
  const hostDown = panel(t, { hostError: true })
  assert.ok(hostDown.includes('Нет связи с DSH') && hostDown.includes('данные устарели'))
})

test('PanelBody: hostile text from the API is escaped, never interpreted as HTML', async () => {
  const loaded = await loadClient()
  const t = { ...loaded.t, React: loaded.React }
  const evil = '<img src=x onerror=alert(1)>'
  const html = panel(t, { server: serverState({
    balance: { rub: '5.00', corporate: true, corporateName: evil },
    usage: { ...serverState().usage, byModel: [{ model: evil, costRub: '1.00', requests: 1 }] },
  }) })
  assert.ok(!html.includes(evil), 'the raw markup never appears')
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
})

test('PanelBody: the refresh button shows progress and is disabled while loading', async () => {
  const loaded = await loadClient()
  const view = loaded.t.deriveView(snapshotOf(), 1_760_000_000_000)
  const html = renderToStaticMarkup(loaded.React.createElement(loaded.t.PanelBody, { view, refreshing: true, onRefresh() {} }))
  assert.match(html, /disabled=""/)
  assert.ok(html.includes('Обновление…'))
})

test('Badge: renders the amount, the warning tone and an accessible title', async () => {
  const loaded = await loadClient()
  const { t, React } = loaded
  const stub = (snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snapshot, refresh() {} })
  const render = snapshot => renderToStaticMarkup(React.createElement(t.createBadge(stub(snapshot))))
  const ok = render(snapshotOf())
  assert.ok(ok.includes(`>1${NBSP}234,50${NBSP}₽<`))
  assert.ok(ok.includes('data-tone="ok"') && ok.includes('aria-haspopup="dialog"') && ok.includes('aria-expanded="false"'))
  const low = render(snapshotOf({ server: serverState({ balance: { rub: '42.00', corporate: false, corporateName: null } }) }))
  assert.ok(low.includes('data-tone="warn"') && low.includes(`42,00${NBSP}₽`))
  const none = render(snapshotOf({ server: serverState({ status: 'no_key', balance: null, usage: null }) }))
  assert.ok(none.includes('data-tone="muted"') && none.includes('>Arckep<') && !none.includes('₽'))
  const en = render(snapshotOf({ lang: 'en' }))
  assert.ok(en.includes(`1,234.50${NBSP}₽`) && en.includes('title="Arckep: 1,234.50'))
})

test('Settings page: key status, input that is a password field, buttons, switches and the hint', async () => {
  const loaded = await loadClient()
  const { t, React } = loaded
  const stub = (snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snapshot, refresh() {}, saveKey() {}, clearKey() {}, setPrefs() {}, resetPrefs() {} })
  const render = snapshot => renderToStaticMarkup(React.createElement(t.createSettings(stub(snapshot))))
  const html = render(snapshotOf())
  assert.ok(html.includes('Ключ задан — в хранилище ключей DSH'))
  assert.match(html, /<input[^>]*type="password"[^>]*/)
  assert.match(html, /autoComplete="new-password"|autocomplete="new-password"/)
  assert.ok(html.includes('>Сохранить<') && html.includes('>Удалить ключ<'))
  assert.ok(html.includes('Где взять ключ: arckep.ru → Настройки → API. Нужен доступ «баланс» (balance:read).'))
  assert.ok(html.includes('Считать расход только по этому ключу'))
  assert.ok(html.includes('Интервал опроса, секунд (не меньше 60)'))
  assert.ok(html.includes('Предупреждать, когда баланс ниже, ₽'))
  assert.ok(html.includes('Язык интерфейса') && html.includes('>Как в DSH<') && html.includes('>Русский<') && html.includes('>English<'))
  assert.match(html, /<select[^>]*>[\s\S]*<option value="auto" selected=""|<select[^>]*value="auto"/)
  assert.ok(html.includes('value="300"') && html.includes('value="100"'))
  assert.ok(html.includes('никуда, кроме arckep.ru, не отправляется'))
  assert.ok(!html.includes(KEY_TYPED))
  assert.match(html, /<input[^>]*value=""[^>]*type="password"|<input[^>]*type="password"[^>]*value=""/, 'the key field starts empty')

  const noKey = render(snapshotOf({ server: serverState({ status: 'no_key', balance: null, usage: null, key: { configured: false, source: null, writable: true } }) }))
  assert.ok(noKey.includes('Ключ не задан') && !noKey.includes('>Удалить ключ<'))

  const env = render(snapshotOf({ server: serverState({ key: { configured: true, source: 'env', writable: false } }) }))
  assert.ok(env.includes('из переменной окружения ARCKEP_API_KEY'))
  assert.ok(!env.includes('type="password"'), 'no input when the environment owns the key')
  assert.ok(env.includes('изменить его можно только там'))

  const en = render(snapshotOf({ lang: 'en' }))
  assert.ok(en.includes('Key is set — in the DSH credential store') && en.includes('>Save<') && en.includes('>Delete key<'))
  const saved = render(snapshotOf({ notice: { kind: 'saved', code: null } }))
  assert.ok(saved.includes('Ключ сохранён.'))
  const failed = render(snapshotOf({ notice: { kind: 'error', code: 'invalid_key' } }))
  assert.ok(failed.includes('не похоже на ключ API'))
})

// ----------------------------------------------------------------------- styling

test('CSS uses theme variables only: no hard-coded colours', async () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const css = /const CSS = `([\s\S]*?)`/.exec(source)[1]
  assert.ok(css.length > 500)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'hex colour')
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla|oklch|lab|lch|hwb|color-mix)\(/, 'colour function')
  assert.doesNotMatch(css, /\b(?:color|background|border-color|background-color)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange)\b/i, 'named colour')
  const declared = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1])
  assert.ok(declared.length > 20)
  for (const name of declared) assert.match(name, /^--dsw-/, `${name} must be a DSH theme token`)
  assert.doesNotMatch(css, /@media[^{]*prefers-color-scheme/, 'light/dark is the theme\'s job')
})

test('every CSS class the components use is styled with the dsh-ark- prefix (no leaking into DSH)', async () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const css = /const CSS = `([\s\S]*?)`/.exec(source)[1]
  for (const selector of css.matchAll(/(^|[},])\s*([.#][^{,]+)\{/g)) {
    const text = selector[2].trim()
    assert.match(text, /^\.dsh-ark-/, `selector ${text}`)
  }
})

test('the client source has no network access of its own beyond the plugin routes', async () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /https?:\/\//, 'no absolute URL: the browser never talks to arckep.ru')
  assert.doesNotMatch(source, /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/)
  assert.equal([...source.matchAll(/\bfetch(?:Impl)?\(/g)].length >= 1, true)
  assert.doesNotMatch(source, /\beval\(|new Function\(|innerHTML|dangerouslySetInnerHTML|document\.write/)
  assert.doesNotMatch(source, /console\.(log|info|debug)/)
})
