import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ArckepError, ORIGIN, TEST_ORIGIN_ENV, cleanText, createApiClient, isAllowedOrigin, isValidKey,
  parseBalance, parseUsage, resolveOrigin,
} from '../lib/api.js'
import { BALANCE_BODY, KEY, USAGE_BODY, everything, fakeFetch, json } from './helpers.mjs'

const rejects = async (promise, code, check) => {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof ArckepError, `expected ArckepError, got ${error}`)
    assert.equal(error.code, code)
    if (check) check(error)
    return error
  }
  assert.fail(`expected rejection with ${code}`)
}

// ---------------------------------------------------------------- origin guard

test('the production origin is https://arckep.ru and nothing else is allowed by default', () => {
  assert.equal(ORIGIN, 'https://arckep.ru')
  assert.deepEqual(resolveOrigin({}), { origin: ORIGIN, override: false, rejectedOverride: false })
  assert.equal(resolveOrigin({ [TEST_ORIGIN_ENV]: '' }).origin, ORIGIN)
})

test('isAllowedOrigin accepts arckep.ru and unprivileged loopback http only', () => {
  for (const ok of [ORIGIN, 'http://127.0.0.1:39100', 'http://localhost:40000', 'http://[::1]:5000']) {
    assert.equal(isAllowedOrigin(ok), true, ok)
  }
  for (const bad of [
    'http://arckep.ru', 'https://www.arckep.ru', 'https://arckep.ru.evil.example', 'https://evil.example',
    'https://arckep.ru@evil.example', 'https://arckep.ru:8443', 'http://127.0.0.1', 'http://127.0.0.1:80',
    'http://127.0.0.1:1023', 'http://10.0.0.5:39100', 'http://0.0.0.0:39100', 'https://127.0.0.1:39100',
    'http://127.0.0.1:39100/path', 'http://127.0.0.1:39100/?x=1', 'http://user:pw@127.0.0.1:39100',
    'ftp://arckep.ru', 'arckep.ru', '', 'https://arckep.ru/',
  ]) {
    assert.equal(isAllowedOrigin(bad), false, bad)
  }
})

test('the test-origin variable is honoured for loopback only and ignored (flagged) otherwise', () => {
  const ok = resolveOrigin({ [TEST_ORIGIN_ENV]: 'http://127.0.0.1:39100' })
  assert.deepEqual(ok, { origin: 'http://127.0.0.1:39100', override: true, rejectedOverride: false })
  for (const bad of ['https://evil.example', 'http://evil.example:39100', 'http://127.0.0.1:80', 'nonsense', 'http://10.1.1.1:40000']) {
    const result = resolveOrigin({ [TEST_ORIGIN_ENV]: bad })
    assert.equal(result.origin, ORIGIN, bad)
    assert.equal(result.override, false)
    assert.equal(result.rejectedOverride, true)
  }
})

test('createApiClient refuses a disallowed origin outright', () => {
  assert.throws(() => createApiClient({ origin: 'https://evil.example' }), TypeError)
  assert.throws(() => createApiClient({ origin: 'http://arckep.ru' }), TypeError)
  assert.doesNotThrow(() => createApiClient({ origin: 'http://127.0.0.1:39100' }))
})

// -------------------------------------------------------------------- requests

test('getBalance sends one GET with the key only in the Authorization header', async () => {
  const fetchImpl = fakeFetch({ '/api/v1/balance': () => json(200, BALANCE_BODY) })
  const api = createApiClient({ fetchImpl })
  const balance = await api.getBalance(KEY)
  assert.deepEqual(balance, { rub: '150.00', corporate: false, corporateName: null })
  assert.equal(fetchImpl.calls.length, 1)
  const [call] = fetchImpl.calls
  assert.equal(call.url, 'https://arckep.ru/api/v1/balance')
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'manual')
  assert.equal(call.init.headers.authorization, `Bearer ${KEY}`)
  assert.ok(call.init.signal instanceof AbortSignal)
  assert.equal(call.init.body, undefined)
  assert.ok(!call.url.includes(KEY), 'the key must not appear in the URL')
  for (const [name, value] of Object.entries(call.init.headers)) {
    if (name !== 'authorization') assert.ok(!String(value).includes(KEY), `${name} leaks the key`)
  }
})

test('getUsage asks for 30 days and passes key_only', async () => {
  const fetchImpl = fakeFetch({ '/api/v1/usage': () => json(200, USAGE_BODY) })
  const api = createApiClient({ fetchImpl })
  await api.getUsage(KEY, { keyOnly: false })
  await api.getUsage(KEY, { keyOnly: true })
  assert.equal(fetchImpl.calls[0].url, 'https://arckep.ru/api/v1/usage?days=30&key_only=false')
  assert.equal(fetchImpl.calls[1].url, 'https://arckep.ru/api/v1/usage?days=30&key_only=true')
})

test('an unusable key never reaches the network (header injection, whitespace, too short)', async () => {
  const fetchImpl = fakeFetch({ '/api/v1/balance': () => json(200, BALANCE_BODY) })
  const api = createApiClient({ fetchImpl })
  for (const bad of ['', 'short', 'has space in it', `${KEY}\r\nX-Evil: 1`, `${KEY}\n`, 'ключ-с-кириллицей-1234', 'x'.repeat(513), null, undefined, 42]) {
    await rejects(api.getBalance(bad), 'invalid_key')
  }
  assert.equal(fetchImpl.calls.length, 0)
  assert.equal(isValidKey(KEY), true)
})

// ---------------------------------------------------------------------- errors

test('HTTP statuses map to stable error codes', async () => {
  const cases = [
    [401, 'unauthorized'], [402, 'payment_required'], [403, 'forbidden'], [404, 'not_found'],
    [429, 'rate_limited'], [500, 'server_error'], [502, 'server_error'], [503, 'server_error'], [418, 'http_error'],
  ]
  for (const [status, code] of cases) {
    const fetchImpl = fakeFetch({ '/api/v1/balance': () => json(status, { error_code: 'X', message: 'remote text', details: {} }) })
    const api = createApiClient({ fetchImpl })
    const error = await rejects(api.getBalance(KEY), code)
    assert.equal(error.status, status)
    assert.equal(error.message, code, 'the message is the code, never remote text')
  }
})

test('403 carries the required scope from details.required (string or list), sanitized', async () => {
  const one = createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(403, { error_code: 'FORBIDDEN', message: 'm', details: { required: 'balance:read' } }) }) })
  await rejects(one.getBalance(KEY), 'forbidden', e => assert.deepEqual(e.required, ['balance:read']))
  const many = createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(403, { details: { required: ['balance:read', 'usage:read', '<script>', 7] } }) }) })
  await rejects(many.getBalance(KEY), 'forbidden', e => assert.deepEqual(e.required, ['balance:read', 'usage:read']))
  const none = createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(403, 'not json') }) })
  await rejects(none.getBalance(KEY), 'forbidden', e => assert.equal(e.required, undefined))
})

test('429 honours Retry-After in seconds and as an HTTP date, clamped to 1 s .. 1 h', async () => {
  const now = () => Date.parse('2026-10-09T12:00:00Z')
  const mk = header => createApiClient({ now, fetchImpl: fakeFetch({ '/api/v1/balance': () => json(429, {}, { 'retry-after': header }) }) })
  await rejects(mk('120').getBalance(KEY), 'rate_limited', e => assert.equal(e.retryAfterMs, 120_000))
  await rejects(mk('0').getBalance(KEY), 'rate_limited', e => assert.equal(e.retryAfterMs, 1000))
  await rejects(mk('999999').getBalance(KEY), 'rate_limited', e => assert.equal(e.retryAfterMs, 3_600_000))
  await rejects(mk('Fri, 09 Oct 2026 12:05:00 GMT').getBalance(KEY), 'rate_limited', e => assert.equal(e.retryAfterMs, 300_000))
  await rejects(mk('soon').getBalance(KEY), 'rate_limited', e => assert.equal(e.retryAfterMs, undefined))
})

test('redirects are never followed: any 3xx is an error and only one request is made', async () => {
  for (const status of [301, 302, 307, 308]) {
    const fetchImpl = fakeFetch({
      '/api/v1/balance': () => new Response(null, { status, headers: { location: 'https://evil.example/steal' } }),
    })
    const api = createApiClient({ fetchImpl })
    await rejects(api.getBalance(KEY), 'redirect', e => assert.equal(e.status, status))
    assert.equal(fetchImpl.calls.length, 1)
    assert.equal(fetchImpl.calls[0].init.redirect, 'manual')
  }
  const opaque = createApiClient({ fetchImpl: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers(), body: null }) })
  await rejects(opaque.getBalance(KEY), 'redirect')
})

test('network failures are retried once before becoming a bare code, and an error message that contains the key is dropped', async () => {
  let attempts = 0
  const flaky = createApiClient({
    retryDelayMs: 10,
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return json(200, BALANCE_BODY)
    },
  })
  assert.deepEqual(await flaky.getBalance(KEY), { rub: '150.00', corporate: false, corporateName: null })
  assert.equal(attempts, 2, 'recovered on the single retry')

  let deadAttempts = 0
  const leaky = Object.assign(new TypeError(`fetch failed for Bearer ${KEY}`), { cause: { message: KEY, code: 'ECONNRESET' } })
  const api = createApiClient({ fetchImpl: async () => { deadAttempts += 1; throw leaky } })
  const error = await rejects(api.getBalance(KEY), 'network')
  assert.equal(deadAttempts, 2, 'tried twice and gave up')
  assert.ok(!everything(error).includes(KEY), 'the key must not survive in the error object')
  assert.equal(error.cause, undefined)
})

test('a request that never answers times out after the configured time', async () => {
  const hanging = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  const api = createApiClient({ fetchImpl: hanging, timeoutMs: 40 })
  const started = Date.now()
  // AbortSignal.timeout() timers are unref'd. A running DSH server has other
  // handles, but this bare test process does not: on Node 22 the event loop
  // would drain before the timer fires. Keep it alive for the wait.
  const keepAlive = setTimeout(() => {}, 5000)
  try {
    await rejects(api.getBalance(KEY), 'timeout')
  } finally {
    clearTimeout(keepAlive)
  }
  assert.ok(Date.now() - started < 2000)
})

test('the default timeout is 10 seconds', async () => {
  let seen
  const api = createApiClient({ fetchImpl: async (_u, init) => { seen = init.signal; return json(200, BALANCE_BODY) } })
  await api.getBalance(KEY)
  assert.equal(seen.aborted, false)
  const { REQUEST_TIMEOUT_MS } = await import('../lib/api.js')
  assert.equal(REQUEST_TIMEOUT_MS, 10_000)
})

test('caller cancellation is reported as aborted, not as a network error', async () => {
  const controller = new AbortController()
  const hanging = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })
  const api = createApiClient({ fetchImpl: hanging })
  const pending = api.getBalance(KEY, controller.signal)
  controller.abort()
  await rejects(pending, 'aborted')
})

test('bad bodies: invalid JSON, wrong shape, missing balance, oversized body', async () => {
  await rejects(createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(200, 'not json at all') }) }).getBalance(KEY), 'bad_response')
  await rejects(createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(200, '[1,2]') }) }).getBalance(KEY), 'bad_response')
  await rejects(createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(200, { balance_rub: null }) }) }).getBalance(KEY), 'bad_response')
  await rejects(createApiClient({ fetchImpl: fakeFetch({ '/api/v1/balance': () => json(200, { balance_rub: '1e9' }) }) }).getBalance(KEY), 'bad_response')
  const big = JSON.stringify({ balance_rub: '1.00', pad: 'x'.repeat(5000) })
  await rejects(createApiClient({ maxBodyBytes: 1000, fetchImpl: fakeFetch({ '/api/v1/balance': () => json(200, big) }) }).getBalance(KEY), 'bad_response')
  const noLength = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close() } }), { status: 200 })
  await rejects(createApiClient({ maxBodyBytes: 1000, fetchImpl: async () => noLength }).getBalance(KEY), 'bad_response')
})

// --------------------------------------------------------------------- parsers

test('parseBalance keeps amounts exact and exposes corporate wallets', () => {
  assert.deepEqual(parseBalance({ balance_rub: '150.00', is_corporate: false, corporate_name: 'ignored' }), { rub: '150.00', corporate: false, corporateName: null })
  assert.deepEqual(parseBalance({ balance_rub: '99999.99', is_corporate: true, corporate_name: ' ООО «Пример» ' }), { rub: '99999.99', corporate: true, corporateName: 'ООО «Пример»' })
  assert.equal(parseBalance({ balance_rub: '0.10', is_corporate: true, corporate_name: null }).corporateName, null)
  assert.equal(parseBalance({ balance_rub: '-5.00', is_corporate: false }).rub, '-5.00')
  assert.throws(() => parseBalance(null), ArckepError)
})

test('parseUsage tolerates nulls and drops malformed rows', () => {
  const usage = parseUsage(USAGE_BODY)
  assert.equal(usage.periodDays, 30)
  assert.deepEqual(usage.totals, { todayRub: '1.23', last7dRub: '10.50', periodRub: '42.00', requests: 1234 })
  assert.deepEqual(usage.byModel.map(m => m.model), ['x/big', 'deepseek/deepseek-flash'], 'sorted by cost, descending')
  assert.equal(usage.forecastDaysLeft, 12)

  const sparse = parseUsage({ totals: { today_rub: null, period_rub: 'abc' }, by_model: [null, { model: 'a' }, { cost_rub: '1' }, { model: 'ok', cost_rub: '2.5', requests: -1 }], forecast_days_left: null })
  assert.deepEqual(sparse.totals, { todayRub: null, last7dRub: null, periodRub: null, requests: null })
  assert.deepEqual(sparse.byModel, [{ model: 'ok', costRub: '2.5', requests: null }])
  assert.equal(sparse.forecastDaysLeft, null)
  assert.equal(sparse.periodDays, null)
  assert.equal(parseUsage({}).byModel.length, 0)
})

test('parseUsage compares model costs exactly and keeps at most ten', () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ model: `m${i}`, cost_rub: `0.${String(i).padStart(2, '0')}`, requests: i }))
  const usage = parseUsage({ by_model: rows })
  assert.equal(usage.byModel.length, 10)
  assert.equal(usage.byModel[0].model, 'm14')
  assert.equal(parseUsage({ by_model: [{ model: 'a', cost_rub: '0.1' }, { model: 'b', cost_rub: '0.10000000001' }] }).byModel[0].model, 'b')
})

test('parseUsage forecast is clamped and rounded', () => {
  assert.equal(parseUsage({ forecast_days_left: 12.345 }).forecastDaysLeft, 12.3)
  assert.equal(parseUsage({ forecast_days_left: 99999 }).forecastDaysLeft, 3650)
  assert.equal(parseUsage({ forecast_days_left: -1 }).forecastDaysLeft, null)
  assert.equal(parseUsage({ forecast_days_left: '12' }).forecastDaysLeft, null)
  assert.equal(parseUsage({ forecast_days_left: 0 }).forecastDaysLeft, 0)
})

test('cleanText strips control characters and caps length', () => {
  assert.equal(cleanText('a\u0000b\u001fc', 10), 'a b c')
  assert.equal(cleanText('x'.repeat(200), 120).length, 120)
  assert.equal(cleanText('   ', 10), null)
  assert.equal(cleanText(5, 10), null)
})
