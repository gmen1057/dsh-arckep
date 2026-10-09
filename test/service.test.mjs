import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArckepError, createApiClient } from '../lib/api.js'
import {
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, MANUAL_MIN_SPACING_MS, MIN_INTERVAL_MS, USAGE_REPROBE_MS, createService,
} from '../lib/service.js'
import {
  BALANCE_BODY, KEY, OTHER_KEY, USAGE_BODY, everything, fakeClock, fakeCredentials, fakeFetch, fakeLogger, json,
} from './helpers.mjs'

const MINUTE = 60_000

function setup({ routes, credentials = fakeCredentials(), random = () => 0.5, defaults } = {}) {
  const fetchImpl = fakeFetch(routes ?? {
    '/api/v1/balance': () => json(200, BALANCE_BODY),
    '/api/v1/usage': () => json(200, USAGE_BODY),
  })
  const now = fakeClock()
  const logger = fakeLogger()
  const service = createService({ api: createApiClient({ fetchImpl }), credentials, now, random, logger, defaults })
  return { service, fetchImpl, now, logger, credentials }
}

test('without a key the service reports no_key and makes no request', async () => {
  const { service, fetchImpl } = setup({ credentials: fakeCredentials(null) })
  const state = await service.getState()
  assert.equal(state.status, 'no_key')
  assert.equal(state.key.configured, false)
  assert.equal(state.balance, null)
  assert.equal(fetchImpl.calls.length, 0)
})

test('a configured key yields balance and usage, fetched one request at a time', async () => {
  const { service, fetchImpl } = setup()
  const state = await service.getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.stale, false)
  assert.equal(state.error, null)
  assert.deepEqual(state.balance, { rub: '150.00', corporate: false, corporateName: null })
  assert.equal(state.usage.state, 'ok')
  assert.equal(state.usage.totals.periodRub, '42.00')
  assert.equal(state.usage.forecastDaysLeft, 12)
  assert.deepEqual(state.key, { configured: true, source: 'file', writable: true })
  assert.deepEqual(fetchImpl.calls.map(c => c.path), ['/api/v1/balance', '/api/v1/usage'])
  assert.equal(fetchImpl.maxActive, 1)
  assert.equal(state.v, 1)
  assert.deepEqual(state.defaults, { refreshSeconds: 300, warnBelowRub: 100, keyOnly: false })
})

test('the state never contains the key, and neither do log messages', async () => {
  const { service, logger } = setup({
    routes: { '/api/v1/balance': () => json(503, { message: `down for ${KEY}` }), '/api/v1/usage': () => json(200, USAGE_BODY) },
  })
  const state = await service.getState()
  assert.equal(state.status, 'error')
  assert.ok(!everything(state).includes(KEY))
  assert.ok(!everything(logger.messages).includes(KEY))
  assert.ok(logger.messages.length > 0, 'a failure is logged (code only)')
})

test('concurrent requests share one upstream refresh (de-duplication)', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { service, fetchImpl } = setup({
    routes: { '/api/v1/balance': async () => { await gate; return json(200, BALANCE_BODY) }, '/api/v1/usage': () => json(200, USAGE_BODY) },
  })
  const pending = Promise.all(Array.from({ length: 6 }, () => service.getState()))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(fetchImpl.calls.length, 1, 'only one balance request while others wait')
  release()
  const states = await pending
  assert.ok(states.every(state => state.status === 'ok'))
  assert.equal(fetchImpl.calls.filter(c => c.path === '/api/v1/balance').length, 1)
  assert.equal(fetchImpl.calls.filter(c => c.path === '/api/v1/usage').length, 1)
})

test('different views (all keys / this key only) never run in parallel', async () => {
  const { service, fetchImpl } = setup()
  await Promise.all([service.getState({ keyOnly: false }), service.getState({ keyOnly: true })])
  assert.equal(fetchImpl.maxActive, 1)
  const usage = fetchImpl.calls.filter(c => c.path === '/api/v1/usage').map(c => c.query)
  assert.deepEqual(usage.sort(), ['?days=30&key_only=false', '?days=30&key_only=true'])
})

test('the cache is honoured until the interval passes; the interval cannot go below 60 s', async () => {
  const { service, fetchImpl, now } = setup()
  await service.getState({ intervalMs: 5 * MINUTE })
  const first = fetchImpl.calls.length
  now.advance(4 * MINUTE)
  await service.getState({ intervalMs: 5 * MINUTE })
  assert.equal(fetchImpl.calls.length, first, 'still fresh')
  now.advance(1 * MINUTE + 1)
  await service.getState({ intervalMs: 5 * MINUTE })
  assert.equal(fetchImpl.calls.length, first * 2, 'refreshed after the interval')

  // A client that asks for 1 s polling is held to the 60 s minimum.
  const tight = setup()
  await tight.service.getState({ intervalMs: 1000 })
  const n = tight.fetchImpl.calls.length
  tight.now.advance(MIN_INTERVAL_MS - 1)
  await tight.service.getState({ intervalMs: 1000 })
  assert.equal(tight.fetchImpl.calls.length, n)
  tight.now.advance(2)
  await tight.service.getState({ intervalMs: 1000 })
  assert.equal(tight.fetchImpl.calls.length, n * 2)
})

test('manual refresh bypasses the interval but is spaced by at least 5 seconds', async () => {
  const { service, fetchImpl, now } = setup()
  await service.getState()
  const n = fetchImpl.calls.length
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, n, 'too soon after the previous attempt')
  now.advance(MANUAL_MIN_SPACING_MS)
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, n * 2)
})

test('/usage answering 404 hides the usage block without an error, and is re-probed rarely', async () => {
  const { service, fetchImpl, now } = setup({
    routes: { '/api/v1/balance': () => json(200, BALANCE_BODY), '/api/v1/usage': () => json(404, { detail: 'Not Found' }) },
  })
  const state = await service.getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.error, null)
  assert.equal(state.stale, false)
  assert.equal(state.usage.state, 'unavailable')
  assert.equal(state.balance.rub, '150.00')
  const usageCalls = () => fetchImpl.calls.filter(c => c.path === '/api/v1/usage').length
  assert.equal(usageCalls(), 1)
  now.advance(6 * MINUTE)
  await service.getState()
  assert.equal(usageCalls(), 1, 'not probed again within 15 minutes')
  now.advance(USAGE_REPROBE_MS)
  await service.getState()
  assert.equal(usageCalls(), 2, 'probed again later, so it appears once the endpoint ships')
  now.advance(MANUAL_MIN_SPACING_MS)
  await service.getState({ force: true })
  assert.equal(usageCalls(), 3, 'a manual refresh probes immediately')
})

test('/usage answering 403 keeps the balance and reports the missing scope', async () => {
  const { service } = setup({
    routes: {
      '/api/v1/balance': () => json(200, BALANCE_BODY),
      '/api/v1/usage': () => json(403, { error_code: 'FORBIDDEN', details: { required: 'usage:read' } }),
    },
  })
  const state = await service.getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.usage.state, 'forbidden')
  assert.deepEqual(state.usage.required, ['usage:read'])
})

test('/usage failing with 5xx keeps the previous numbers and marks them stale', async () => {
  let fail = false
  const { service, now } = setup({
    routes: {
      '/api/v1/balance': () => json(200, BALANCE_BODY),
      '/api/v1/usage': () => (fail ? json(503, {}) : json(200, USAGE_BODY)),
    },
  })
  assert.equal((await service.getState()).usage.state, 'ok')
  fail = true
  now.advance(6 * MINUTE)
  const state = await service.getState()
  assert.equal(state.usage.state, 'stale')
  assert.equal(state.usage.totals.periodRub, '42.00')
  assert.equal(state.status, 'ok', 'balance itself is fine')
})

test('every error class is reported with a code and no remote text', async () => {
  for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [402, 'payment_required'], [429, 'rate_limited'], [500, 'server_error'], [404, 'not_found']]) {
    const { service } = setup({ routes: { '/api/v1/balance': () => json(status, { message: 'remote text' }) } })
    const state = await service.getState()
    assert.equal(state.status, 'error')
    assert.equal(state.error.code, code)
    assert.equal(state.error.status, status)
    assert.equal(state.balance, null)
  }
  const net = setup({ routes: { '/api/v1/balance': () => { throw new TypeError('fetch failed') } } })
  assert.equal((await net.service.getState()).error.code, 'network')
})

test('401 and 403 are not retried automatically; a manual refresh or a new key retries', async () => {
  const { service, fetchImpl, now } = setup({ routes: { '/api/v1/balance': () => json(401, {}) } })
  await service.getState()
  assert.equal(fetchImpl.calls.length, 1)
  now.advance(24 * 60 * MINUTE)
  const state = await service.getState({ intervalMs: MIN_INTERVAL_MS })
  assert.equal(fetchImpl.calls.length, 1, 'no automatic retry, however long we wait')
  assert.equal(state.error.retryAt, null)
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, 2, 'manual refresh tries again')
})

test('after a success, a failure keeps the last data marked stale (not an empty screen)', async () => {
  let up = true
  const { service, now } = setup({
    routes: { '/api/v1/balance': () => (up ? json(200, BALANCE_BODY) : json(503, {})), '/api/v1/usage': () => json(200, USAGE_BODY) },
  })
  const ok = await service.getState()
  assert.equal(ok.stale, false)
  up = false
  now.advance(6 * MINUTE)
  const state = await service.getState()
  assert.equal(state.status, 'ok')
  assert.equal(state.stale, true)
  assert.equal(state.error.code, 'server_error')
  assert.equal(state.balance.rub, '150.00')
  assert.ok(state.fetchedAt < state.now, 'fetchedAt is the time of the last success')
})

test('exponential backoff: 30 s, 60 s, 120 s ... capped at 30 minutes, reset by a success', async () => {
  let up = false
  const { service, fetchImpl, now } = setup({
    routes: { '/api/v1/balance': () => (up ? json(200, BALANCE_BODY) : json(503, {})), '/api/v1/usage': () => json(200, USAGE_BODY) },
  })
  const retryDelays = []
  for (let i = 0; i < 9; i++) {
    const before = now()
    const state = await service.getState({ intervalMs: MIN_INTERVAL_MS })
    retryDelays.push(state.error.retryAt - before)
    // The next automatic poll waits for both the backoff and the 60 s interval.
    now.advance(Math.max(state.error.retryAt - before, MIN_INTERVAL_MS) + 1)
  }
  assert.deepEqual(retryDelays, [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000, 1_800_000].map(x => x))
  assert.equal(retryDelays.at(-1), BACKOFF_MAX_MS)
  assert.equal(retryDelays[0], BACKOFF_BASE_MS)
  up = true
  const ok = await service.getState({ intervalMs: MIN_INTERVAL_MS })
  assert.equal(ok.status, 'ok')
  assert.equal(ok.error, null)
  up = false
  now.advance(MIN_INTERVAL_MS + 1)
  const again = await service.getState({ intervalMs: MIN_INTERVAL_MS })
  assert.equal(again.error.retryAt - now(), 30_000, 'the backoff restarted from the base after a success')
  assert.ok(fetchImpl.calls.length > 9)
})

test('no automatic request is made during the backoff window', async () => {
  const { service, fetchImpl, now } = setup({ routes: { '/api/v1/balance': () => json(503, {}) } })
  await service.getState({ intervalMs: MIN_INTERVAL_MS })
  now.advance(MIN_INTERVAL_MS + 1)
  await service.getState({ intervalMs: MIN_INTERVAL_MS }) // second failure: next retry is 60 s away
  const before = fetchImpl.calls.length
  now.advance(MIN_INTERVAL_MS - 5000)
  await service.getState({ intervalMs: MIN_INTERVAL_MS })
  assert.equal(fetchImpl.calls.length, before)
})

test('429 respects Retry-After even when it exceeds the computed backoff, and blocks manual refresh', async () => {
  const { service, fetchImpl, now } = setup({
    routes: { '/api/v1/balance': () => json(429, {}, { 'retry-after': '600' }) },
  })
  const state = await service.getState()
  assert.equal(state.error.code, 'rate_limited')
  assert.equal(state.error.retryAt - now(), 600_000)
  now.advance(MANUAL_MIN_SPACING_MS + 1)
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, 1, 'a manual refresh does not hammer a rate-limited service')
  now.advance(600_000)
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, 2)
})

test('jitter stays within +-20 % of the backoff', async () => {
  for (const [random, expected] of [[0, 24_000], [0.5, 30_000], [0.999999, 35_999.97]]) {
    const { service, now } = setup({ random: () => random, routes: { '/api/v1/balance': () => json(503, {}) } })
    const before = now()
    const state = await service.getState()
    assert.ok(Math.abs(state.error.retryAt - before - expected) < 1, `${random} -> ${state.error.retryAt - before}`)
  }
})

test('a different key never sees data fetched with the previous one', async () => {
  const credentials = fakeCredentials({ value: KEY, source: 'file' })
  const { service, now } = setup({
    credentials,
    routes: {
      '/api/v1/balance': ({ init }) => (init.headers.authorization === `Bearer ${KEY}` ? json(200, BALANCE_BODY) : json(401, {})),
      '/api/v1/usage': () => json(200, USAGE_BODY),
    },
  })
  assert.equal((await service.getState()).balance.rub, '150.00')
  credentials.state.current = { value: OTHER_KEY, source: 'env' }
  credentials.state.writable = false
  now.advance(MANUAL_MIN_SPACING_MS)
  const state = await service.getState()
  assert.equal(state.status, 'error')
  assert.equal(state.balance, null, 'the previous key\'s balance is gone')
  assert.equal(state.usage, null)
  assert.deepEqual(state.key, { configured: true, source: 'env', writable: false })
  credentials.state.current = undefined
  assert.equal((await service.getState()).status, 'no_key')
})

test('setKey validates, stores, refreshes immediately and returns the new state', async () => {
  const credentials = fakeCredentials(null)
  const { service, fetchImpl } = setup({ credentials })
  await assert.rejects(service.setKey('short'), (e) => e instanceof ArckepError && e.code === 'invalid_key')
  await assert.rejects(service.setKey(`${KEY}\n`), (e) => e.code === 'invalid_key')
  assert.equal(fetchImpl.calls.length, 0)
  const state = await service.setKey(KEY)
  assert.equal(credentials.state.current.value, KEY)
  assert.equal(state.status, 'ok')
  assert.equal(state.key.configured, true)
  assert.equal(fetchImpl.calls[0].init.headers.authorization, `Bearer ${KEY}`)
  assert.ok(!everything(state).includes(KEY))
})

test('setKey and clearKey refuse to touch a key supplied by the environment', async () => {
  const credentials = fakeCredentials({ value: KEY, source: 'env' })
  const { service } = setup({ credentials })
  await assert.rejects(service.setKey(OTHER_KEY), (e) => e.code === 'read_only')
  await assert.rejects(service.clearKey(), (e) => e.code === 'read_only')
  assert.equal(credentials.state.current.value, KEY)
})

test('clearKey removes the stored key and the cached data', async () => {
  const credentials = fakeCredentials()
  const { service } = setup({ credentials })
  assert.equal((await service.getState()).status, 'ok')
  const state = await service.clearKey()
  assert.equal(state.status, 'no_key')
  assert.equal(state.balance, null)
  assert.equal(credentials.state.current, undefined)
})

test('credential store failures are reported as a code, not thrown at the caller', async () => {
  const broken = { resolve: async () => { throw new Error(`boom ${KEY}`) }, describe: async () => ({ configured: false }), set: async () => { throw new Error(KEY) }, unset: async () => {} }
  const { service } = setup({ credentials: broken })
  const state = await service.getState()
  assert.equal(state.status, 'error')
  assert.equal(state.error.code, 'credentials')
  assert.ok(!everything(state).includes(KEY))
  await assert.rejects(service.setKey(KEY), (e) => e.code === 'credentials' && !everything(e).includes(KEY))
})

test('dispose aborts the request in flight and stops any further upstream work', async () => {
  let seenSignal
  const hanging = ({ init }) => new Promise((_, reject) => {
    seenSignal = init.signal
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  const { service, fetchImpl, now } = setup({ routes: { '/api/v1/balance': hanging } })
  const pending = service.getState()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(seenSignal.aborted, false)
  service.dispose()
  assert.equal(seenSignal.aborted, true, 'the in-flight request was cancelled')
  const state = await pending
  assert.notEqual(state, undefined, 'the caller still gets an answer')
  now.advance(60 * MINUTE)
  await service.getState({ force: true })
  assert.equal(fetchImpl.calls.length, 1, 'no new requests after dispose')
})

test('an aborted refresh is not logged as a failure', async () => {
  const hanging = ({ init }) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  const { service, logger } = setup({ routes: { '/api/v1/balance': hanging } })
  const pending = service.getState()
  await new Promise(resolve => setTimeout(resolve, 10))
  service.dispose()
  await pending
  assert.deepEqual(logger.messages, [])
})

test('logs only on a change of error code and on recovery (no spam)', async () => {
  let status = 503
  const { service, logger, now } = setup({ routes: { '/api/v1/balance': () => (status === 200 ? json(200, BALANCE_BODY) : json(status, {})), '/api/v1/usage': () => json(200, USAGE_BODY) } })
  for (let i = 0; i < 4; i++) { await service.getState({ intervalMs: MIN_INTERVAL_MS }); now.advance(40 * MINUTE) }
  assert.equal(logger.messages.filter(m => m[0] === 'warn').length, 1)
  status = 200
  await service.getState({ intervalMs: MIN_INTERVAL_MS })
  assert.deepEqual(logger.messages.map(m => m[0]), ['warn', 'info'])
  assert.ok(logger.messages.every(m => typeof m[1] === 'string' && m[1].startsWith('dsh-arckep:')))
})
