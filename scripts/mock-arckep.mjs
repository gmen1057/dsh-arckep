#!/usr/bin/env node
/**
 * A tiny local stand-in for the arckep.ru public API, for development and
 * tests. It never talks to the network.
 *
 *   node scripts/mock-arckep.mjs [port]
 *   DSH_ARCKEP_TEST_ORIGIN=http://127.0.0.1:39100 dsh ...
 *
 * Control endpoints (loopback only, same process):
 *   POST /__scenario  {"name": "ok" | "usage404" | "usage403" | "401" | "403" | "402" | "429" | "500" | "slow" | "redirect" | "garbage" | "corporate"}
 *   GET  /__log       list of requests seen so far (paths and a boolean "keyOk", never the key)
 */

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const VALID_KEY = 'ark_test_0000_valid_key'

const BALANCE = { balance_rub: '1234.50', is_corporate: false, corporate_name: null }
const USAGE = {
  period_days: 30,
  currency: 'RUB',
  balance_rub: '1234.50',
  is_corporate: false,
  totals: {
    today_rub: '1.23', last_7d_rub: '10.50', period_rub: '42.00', requests: 1234,
    input_tokens: 100, output_tokens: 200, cache_read_tokens: 50,
  },
  daily: [{ date: '2026-10-09', cost_rub: '1.23', requests: 10 }],
  by_model: [
    { model: 'deepseek/deepseek-flash', cost_rub: '5.00', requests: 100, input_tokens: 1, output_tokens: 1 },
    { model: 'anthropic/claude-opus', cost_rub: '20.10', requests: 12, input_tokens: 1, output_tokens: 1 },
    { model: 'google/gemini-flash', cost_rub: '0.05', requests: 3, input_tokens: 1, output_tokens: 1 },
    { model: 'deepseek/deepseek-pro', cost_rub: '9.99', requests: 7, input_tokens: 1, output_tokens: 1 },
    { model: 'openai/model-a', cost_rub: '1.00', requests: 1, input_tokens: 1, output_tokens: 1 },
    { model: 'openai/model-b', cost_rub: '0.50', requests: 1, input_tokens: 1, output_tokens: 1 },
  ],
  forecast_days_left: 12,
}

/**
 * Start the mock.
 * @param {{ port?: number, scenario?: string }} [options] - listen port (0 = any) and initial scenario.
 * @returns {Promise<{ port: number, origin: string, log: object[], setScenario: (name: string) => void, close: () => Promise<void> }>} handle.
 */
export async function startMock(options = {}) {
  let scenario = options.scenario ?? 'ok'
  const log = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (url.pathname === '/__scenario' && req.method === 'POST') {
      let raw = ''
      req.on('data', chunk => { raw += chunk })
      req.on('end', () => {
        try {
          scenario = JSON.parse(raw).name
          send(200, { ok: true, scenario })
        } catch {
          send(400, { ok: false })
        }
      })
      return
    }
    if (url.pathname === '/__log') return send(200, log)

    const auth = req.headers.authorization ?? ''
    const keyOk = auth === `Bearer ${VALID_KEY}`
    log.push({ method: req.method, path: url.pathname, query: url.search, keyOk, hasAuth: auth !== '' })

    if (!['/api/v1/balance', '/api/v1/usage'].includes(url.pathname)) return send(404, { detail: 'Not Found' })
    const isUsage = url.pathname === '/api/v1/usage'

    if (scenario === 'redirect') return send(302, '', { location: 'https://example.invalid/steal' })
    if (scenario === 'slow') { setTimeout(() => send(200, BALANCE), 30_000).unref(); return }
    if (scenario === 'garbage') return send(200, 'not json at all')
    if (auth === '') return send(401, { error_code: 'UNAUTHORIZED', message: 'Missing API key.', details: {} })
    if (!keyOk || scenario === '401') return send(401, { error_code: 'UNAUTHORIZED', message: 'Invalid API key.', details: {} })
    if (scenario === '403') {
      return send(403, { error_code: 'FORBIDDEN', message: 'Missing scope.', details: { required: 'balance:read' } })
    }
    if (scenario === '402') return send(402, { error_code: 'PAYMENT_REQUIRED', message: 'No funds.', details: {} })
    if (scenario === '429') return send(429, { error_code: 'RATE_LIMITED', message: 'Slow down.', details: {} }, { 'retry-after': '120' })
    if (scenario === '500') return send(503, { error_code: 'UNAVAILABLE', message: 'Try later.', details: {} })
    if (isUsage && scenario === 'usage404') return send(404, { detail: 'Not Found' })
    if (isUsage && scenario === 'usage403') {
      return send(403, { error_code: 'FORBIDDEN', message: 'Missing scope.', details: { required: 'usage:read' } })
    }
    if (isUsage) {
      const forecast = scenario === 'low-forecast' ? 1.5 : USAGE.forecast_days_left
      return send(200, { ...USAGE, forecast_days_left: forecast, key_only: url.searchParams.get('key_only') })
    }
    if (scenario === 'corporate') {
      return send(200, { balance_rub: '99999.99', is_corporate: true, corporate_name: 'ООО «Пример»' })
    }
    if (scenario === 'low-balance') return send(200, { ...BALANCE, balance_rub: '42.00' })
    return send(200, BALANCE)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    log,
    setScenario(name) { scenario = name },
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 39100)
  const mock = await startMock({ port })
  console.log(`mock arckep listening on ${mock.origin} (valid key: ${VALID_KEY})`)
  const stop = () => { void mock.close().then(() => process.exit(0)) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
