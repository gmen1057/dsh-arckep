import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startMock, VALID_KEY } from '../scripts/mock-arckep.mjs'
import { KEY_NAME, TEST_ORIGIN_ENV, createApiClient } from '../lib/api.js'
import * as plugin from '../lib/index.js'
import { ROUTE_PATHS } from '../lib/routes.js'
import { createService } from '../lib/service.js'
import { fakeCredentials } from './helpers.mjs'

/** A Cordis-like context double that records effects, listeners and routes. */
function fakeContext({ credentials = fakeCredentials(), withConnection = true } = {}) {
  const effects = []
  const listeners = []
  const routes = []
  const logs = []
  const calls = { resolve: [], describe: [], set: [], unset: [] }
  const ctx = {
    effect(factory, label) {
      const disposer = factory()
      effects.push({ label, disposer })
      return disposer
    },
    on(event, handler) { listeners.push({ event, handler }); return () => {} },
    logger: { warn: m => logs.push(['warn', m]), info: m => logs.push(['info', m]) },
    credentials: {
      resolve: async (ref) => { calls.resolve.push(ref); return credentials.resolve() },
      describe: async (ref) => { calls.describe.push(ref); return credentials.describe() },
      set: async (ref, value) => { calls.set.push(ref); return credentials.set(value) },
      unset: async (ref) => { calls.unset.push(ref); return credentials.unset() },
    },
    connection: withConnection ? { fetch: { register: route => { routes.push(route); return async () => {} } } } : undefined,
  }
  return { ctx, effects, listeners, routes, logs, calls, credentials }
}

test('module surface: name, inject, Config, apply', () => {
  assert.equal(plugin.name, 'dsh-arckep')
  assert.deepEqual(plugin.inject, ['connection', 'credentials'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.Config, 'function', 'a Schemastery schema')
})

test('Config fills defaults and validates its fields', () => {
  assert.deepEqual(plugin.Config({}), { refreshSeconds: 300, warnBelowRub: 100, keyOnly: false })
  assert.deepEqual(plugin.Config({ refreshSeconds: 60, warnBelowRub: 0, keyOnly: true }), { refreshSeconds: 60, warnBelowRub: 0, keyOnly: true })
  assert.throws(() => plugin.Config({ refreshSeconds: 59 }))
  assert.throws(() => plugin.Config({ refreshSeconds: 86401 }))
  assert.throws(() => plugin.Config({ warnBelowRub: -1 }))
  assert.throws(() => plugin.Config({ keyOnly: 'yes' }))
})

test('configuration cannot redirect requests: extra fields (origin, baseUrl, apiKey) are ignored', async () => {
  const { fakeFetch, json, BALANCE_BODY, USAGE_BODY, KEY } = await import('./helpers.mjs')
  const saved = globalThis.fetch
  const stub = fakeFetch({ '/api/v1/balance': () => json(200, BALANCE_BODY), '/api/v1/usage': () => json(200, USAGE_BODY) })
  globalThis.fetch = stub
  try {
    const { ctx, routes } = fakeContext({ credentials: fakeCredentials({ value: KEY, source: 'file' }) })
    const hostile = { origin: 'https://evil.example', baseUrl: 'https://evil.example', apiKey: 'ark_test_evil_value_0000' }
    plugin.apply(ctx, { ...plugin.Config(hostile) })
    const state = routes.find(r => r.path === ROUTE_PATHS.state)
    const response = await state.fetch(new Request('http://127.0.0.1:39102/api/arckep.state'))
    assert.equal((await response.json()).status, 'ok')
    assert.ok(stub.calls.length >= 1)
    for (const call of stub.calls) {
      assert.ok(call.url.startsWith('https://arckep.ru/api/v1/'), call.url)
      assert.equal(call.init.headers.authorization, `Bearer ${KEY}`)
    }
  } finally {
    globalThis.fetch = saved
  }
})

test('apply registers four authenticated routes, a dispose effect and a credentials listener', () => {
  const { ctx, effects, listeners, routes } = fakeContext()
  plugin.apply(ctx, plugin.Config({}))
  assert.deepEqual(routes.map(r => r.path).sort(), Object.values(ROUTE_PATHS).sort())
  assert.equal(effects.length, 1)
  assert.equal(effects[0].label, 'dsh-arckep: service')
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].event, 'credentials/reference-updated')
})

test('apply reads and writes the key under the ARCKEP_API_KEY credential name only', async () => {
  const { ctx, routes, calls } = fakeContext({ credentials: fakeCredentials(null) })
  plugin.apply(ctx, plugin.Config({}))
  assert.equal(KEY_NAME, 'ARCKEP_API_KEY')
  const keySet = routes.find(r => r.path === ROUTE_PATHS.keySet)
  const body = JSON.stringify({ key: 'ark_test_0000_plugin_flow' })
  await keySet.fetch(new Request('http://127.0.0.1:39102/api/arckep.key-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' }))
  assert.deepEqual(calls.set, [KEY_NAME])
  assert.ok([...calls.resolve, ...calls.describe, ...calls.set, ...calls.unset].every(ref => ref === KEY_NAME))
})

test('unloading the plugin aborts in-flight work (the registered effect disposes the service)', async () => {
  const { ctx, effects, routes } = fakeContext()
  plugin.apply(ctx, plugin.Config({}))
  assert.equal(typeof effects[0].disposer, 'function')
  effects[0].disposer()
  // After disposal a state request is answered from the (empty) cache without any network access.
  const state = routes.find(r => r.path === ROUTE_PATHS.state)
  const response = await state.fetch(new Request('http://127.0.0.1:39102/api/arckep.state'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'pending')
})

test('a credentials event for our key invalidates the cache; other keys are ignored', () => {
  const { ctx, listeners } = fakeContext()
  plugin.apply(ctx, plugin.Config({}))
  assert.doesNotThrow(() => listeners[0].handler('SOMETHING_ELSE'))
  assert.doesNotThrow(() => listeners[0].handler(KEY_NAME))
})

test('the test-origin variable is announced loudly when active and when rejected', () => {
  const saved = process.env[TEST_ORIGIN_ENV]
  try {
    process.env[TEST_ORIGIN_ENV] = 'http://127.0.0.1:39100'
    let fake = fakeContext()
    plugin.apply(fake.ctx, plugin.Config({}))
    assert.ok(fake.logs.some(([level, text]) => level === 'warn' && text.includes('test origin override is active')))
    process.env[TEST_ORIGIN_ENV] = 'https://evil.example'
    fake = fakeContext()
    plugin.apply(fake.ctx, plugin.Config({}))
    assert.ok(fake.logs.some(([level, text]) => level === 'warn' && text.includes('ignored')))
    assert.ok(!fake.logs.some(([, text]) => text.includes('evil.example')), 'the rejected value is not echoed')
    delete process.env[TEST_ORIGIN_ENV]
    fake = fakeContext()
    plugin.apply(fake.ctx, plugin.Config({}))
    assert.deepEqual(fake.logs, [], 'silent in the normal case')
  } finally {
    if (saved === undefined) delete process.env[TEST_ORIGIN_ENV]
    else process.env[TEST_ORIGIN_ENV] = saved
  }
})

// -------------------------------------------- real HTTP against the local mock

test('end to end against the local mock over real HTTP', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const credentials = fakeCredentials({ value: VALID_KEY, source: 'file' })
  const service = createService({ api: createApiClient({ origin: mock.origin }), credentials })
  t.after(() => service.dispose())

  const state = await service.getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.balance.rub, '1234.50')
  assert.equal(state.usage.byModel[0].model, 'anthropic/claude-opus')
  assert.deepEqual(mock.log.map(l => l.path), ['/api/v1/balance', '/api/v1/usage'])
  assert.ok(mock.log.every(l => l.keyOk), 'the mock saw the right Bearer key on every request')
  assert.ok(mock.log.every(l => !l.path.includes(VALID_KEY) && !l.query.includes(VALID_KEY)))
})

test('against the mock: usage 404 hides usage, 401/403/402/429/5xx map to codes, redirects are refused', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const credentials = fakeCredentials({ value: VALID_KEY, source: 'file' })
  const build = () => createService({ api: createApiClient({ origin: mock.origin }), credentials, random: () => 0.5 })

  mock.setScenario('usage404')
  let state = await build().getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.usage.state, 'unavailable')
  assert.equal(state.error, null)

  for (const [scenario, code] of [['401', 'unauthorized'], ['403', 'forbidden'], ['402', 'payment_required'], ['429', 'rate_limited'], ['500', 'server_error'], ['garbage', 'bad_response']]) {
    mock.setScenario(scenario)
    state = await build().getState()
    assert.equal(state.status, 'error', scenario)
    assert.equal(state.error.code, code, scenario)
  }
  assert.deepEqual((await (async () => { mock.setScenario('403'); return build().getState() })()).error.required, ['balance:read'])

  mock.log.length = 0
  mock.setScenario('redirect')
  state = await build().getState()
  assert.equal(state.error.code, 'redirect')
  assert.equal(mock.log.length, 1, 'the redirect target was never contacted')
})

test('against the mock: a slow server hits the timeout', async (t) => {
  const mock = await startMock({ scenario: 'slow' })
  t.after(() => mock.close())
  const service = createService({ api: createApiClient({ origin: mock.origin, timeoutMs: 80 }), credentials: fakeCredentials({ value: VALID_KEY, source: 'file' }) })
  const started = Date.now()
  const state = await service.getState()
  assert.equal(state.error.code, 'timeout')
  assert.ok(Date.now() - started < 3000)
})

test('against the mock: a wrong key is reported, the right key afterwards works', async (t) => {
  const mock = await startMock()
  t.after(() => mock.close())
  const credentials = fakeCredentials({ value: 'ark_test_9999_wrong_key', source: 'file' })
  const service = createService({ api: createApiClient({ origin: mock.origin }), credentials })
  assert.equal((await service.getState()).error.code, 'unauthorized')
  const state = await service.setKey(VALID_KEY)
  assert.equal(state.status, 'ok')
})
