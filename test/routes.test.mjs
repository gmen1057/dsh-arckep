import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient } from '../lib/api.js'
import { MAX_REQUEST_BYTES, ROUTE_PATHS, createRoutes } from '../lib/routes.js'
import { createService } from '../lib/service.js'
import { BALANCE_BODY, KEY, OTHER_KEY, USAGE_BODY, everything, fakeClock, fakeCredentials, fakeFetch, json } from './helpers.mjs'

function setup(credentials = fakeCredentials()) {
  const fetchImpl = fakeFetch({ '/api/v1/balance': () => json(200, BALANCE_BODY), '/api/v1/usage': () => json(200, USAGE_BODY) })
  const service = createService({ api: createApiClient({ fetchImpl }), credentials, now: fakeClock(), random: () => 0.5 })
  const routes = Object.fromEntries(createRoutes(service).map(route => [route.path, route]))
  return { routes, service, fetchImpl, credentials }
}

const post = (path, body, headers = {}) => new Request(`http://127.0.0.1:39102${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  duplex: 'half',
})

test('the route table registers exactly four exact routes under /api', () => {
  const { routes } = setup()
  assert.deepEqual(Object.keys(routes).sort(), Object.values(ROUTE_PATHS).sort())
  for (const route of Object.values(routes)) {
    assert.match(route.path, /^\/api\/arckep\.[a-z-]+$/)
    assert.ok(route.methods.every(method => ['GET', 'POST'].includes(method)))
  }
  assert.deepEqual(routes[ROUTE_PATHS.state].methods, ['GET'])
  assert.equal(routes[ROUTE_PATHS.state].requestBody, 'buffered')
  for (const path of [ROUTE_PATHS.refresh, ROUTE_PATHS.keySet, ROUTE_PATHS.keyClear]) {
    assert.deepEqual(routes[path].methods, ['POST'])
    assert.equal(routes[path].requestBody, 'streaming', 'POST bodies are read with our own small cap')
  }
})

test('GET state answers JSON that must not be cached, with the interval and view from the query', async () => {
  const { routes, fetchImpl } = setup()
  const response = await routes[ROUTE_PATHS.state].fetch(new Request('http://127.0.0.1:39102/api/arckep.state?keyOnly=1&interval=600'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  const state = await response.json()
  assert.equal(state.status, 'ok')
  assert.equal(fetchImpl.calls.find(c => c.path === '/api/v1/usage').query, '?days=30&key_only=true')
})

test('POST refresh forces a refresh and returns the new state', async () => {
  const { routes } = setup()
  const response = await routes[ROUTE_PATHS.refresh].fetch(post(ROUTE_PATHS.refresh, { keyOnly: false }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'ok')
})

test('POST key-set stores the key and the response never echoes it', async () => {
  const { routes, credentials } = setup(fakeCredentials(null))
  const response = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, { key: `  ${KEY}  `, keyOnly: false }))
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.ok(!text.includes(KEY))
  assert.equal(JSON.parse(text).key.configured, true)
  assert.equal(credentials.state.current.value, KEY, 'surrounding whitespace is trimmed')
})

test('POST key-set rejects malformed keys with 400 and never echoes them', async () => {
  const { routes, credentials } = setup(fakeCredentials(null))
  for (const body of [{ key: 'short' }, { key: 'has a space inside' }, { key: 12345678 }, {}, { key: `${KEY}\r\nX: y` }]) {
    const response = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, body))
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_key' })
  }
  assert.equal(credentials.state.current, undefined)
})

test('POST key-set / key-clear answer 409 read_only when the environment supplies the key', async () => {
  const { routes, credentials } = setup(fakeCredentials({ value: KEY, source: 'env' }))
  let response = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, { key: OTHER_KEY }))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'read_only' })
  response = await routes[ROUTE_PATHS.keyClear].fetch(post(ROUTE_PATHS.keyClear, {}))
  assert.equal(response.status, 409)
  assert.equal(credentials.state.current.value, KEY)
})

test('POST key-clear removes the stored key', async () => {
  const { routes, credentials } = setup()
  const response = await routes[ROUTE_PATHS.keyClear].fetch(post(ROUTE_PATHS.keyClear, {}))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'no_key')
  assert.equal(credentials.state.current, undefined)
})

test('POST routes require a JSON content type', async () => {
  const { routes } = setup(fakeCredentials(null))
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const request = new Request('http://127.0.0.1:39102/api/arckep.key-set', { method: 'POST', headers: type ? { 'content-type': type } : {}, body: JSON.stringify({ key: KEY }), duplex: 'half' })
    const response = await routes[ROUTE_PATHS.keySet].fetch(request)
    assert.equal(response.status, 415, `content-type "${type}"`)
  }
  const ok = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, { key: KEY }, { 'content-type': 'application/json; charset=utf-8' }))
  assert.equal(ok.status, 200)
})

test('POST routes refuse same-site and cross-site browser requests', async () => {
  const { routes, credentials } = setup(fakeCredentials(null))
  for (const site of ['cross-site', 'same-site']) {
    for (const path of [ROUTE_PATHS.refresh, ROUTE_PATHS.keySet, ROUTE_PATHS.keyClear]) {
      const response = await routes[path].fetch(post(path, { key: KEY }, { 'sec-fetch-site': site }))
      assert.equal(response.status, 403, `${path} ${site}`)
    }
  }
  assert.equal(credentials.state.current, undefined)
  for (const site of ['same-origin', 'none']) {
    const response = await routes[ROUTE_PATHS.refresh].fetch(post(ROUTE_PATHS.refresh, {}, { 'sec-fetch-site': site }))
    assert.equal(response.status, 200)
  }
})

test('POST routes cap the body at 4 KiB and reject bad JSON', async () => {
  const { routes } = setup(fakeCredentials(null))
  assert.equal(MAX_REQUEST_BYTES, 4096)
  const big = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, JSON.stringify({ key: 'a'.repeat(MAX_REQUEST_BYTES) })))
  assert.equal(big.status, 413)
  for (const body of ['{not json', '[1,2,3]', 'null', '"text"']) {
    const response = await routes[ROUTE_PATHS.keySet].fetch(post(ROUTE_PATHS.keySet, body))
    assert.equal(response.status, 400, body)
  }
  const empty = await routes[ROUTE_PATHS.keyClear].fetch(post(ROUTE_PATHS.keyClear, ''))
  assert.equal(empty.status, 200, 'an empty body means no options')
})

test('an unexpected failure becomes a bare 500 without details', async () => {
  const service = { getState: async () => { throw new Error(`secret path /home/someone/x and ${KEY}`) } }
  const [state] = createRoutes(service)
  const response = await state.fetch(new Request('http://127.0.0.1:39102/api/arckep.state'))
  assert.equal(response.status, 500)
  const text = await response.text()
  assert.deepEqual(JSON.parse(text), { error: 'internal' })
  assert.ok(!everything(text).includes(KEY))
})
