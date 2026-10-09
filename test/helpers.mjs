/** Shared test helpers: fake fetch, fake clock, fake credential store. */

export const KEY = 'ark_test_0000_secret_value'
export const OTHER_KEY = 'ark_test_1111_other_value'

export const BALANCE_BODY = { balance_rub: '150.00', is_corporate: false, corporate_name: null }

export const USAGE_BODY = {
  period_days: 30,
  currency: 'RUB',
  balance_rub: '150.00',
  is_corporate: false,
  totals: {
    today_rub: '1.23', last_7d_rub: '10.50', period_rub: '42.00', requests: 1234,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
  },
  daily: [{ date: '2026-10-09', cost_rub: '1.23', requests: 10 }],
  by_model: [
    { model: 'deepseek/deepseek-flash', cost_rub: '5.00', requests: 100, input_tokens: 0, output_tokens: 0 },
    { model: 'x/big', cost_rub: '30.5', requests: 1, input_tokens: 0, output_tokens: 0 },
  ],
  forecast_days_left: 12,
}

/** Build a JSON Response. */
export function json(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * A fetch double. `routes` maps a pathname to a function (or a Response) that
 * answers; `calls` records every request.
 */
export function fakeFetch(routes) {
  const calls = []
  let active = 0
  let maxActive = 0
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    calls.push({ url: String(url), path: parsed.pathname, query: parsed.search, init })
    active += 1
    maxActive = Math.max(maxActive, active)
    try {
      const route = routes[parsed.pathname]
      if (route === undefined) return json(404, { detail: 'Not Found' })
      return typeof route === 'function' ? await route({ url: parsed, init, calls }) : route.clone()
    } finally {
      active -= 1
    }
  }
  Object.defineProperty(fetchImpl, 'calls', { value: calls })
  Object.defineProperty(fetchImpl, 'maxActive', { get: () => maxActive })
  return fetchImpl
}

/** A controllable clock. */
export function fakeClock(start = 1_760_000_000_000) {
  let current = start
  const now = () => current
  now.advance = (ms) => { current += ms }
  return now
}

/** Fake credential port; records writes, never exposes anything else. */
export function fakeCredentials(initial = { value: KEY, source: 'file' }) {
  // Pass null for "no key at all".
  const state = { current: initial ?? undefined, writable: initial?.source !== 'env' }
  return {
    state,
    async resolve() { return state.current === undefined ? undefined : { ...state.current } },
    async describe() {
      return state.current === undefined
        ? { configured: false, writable: state.writable }
        : { configured: true, source: state.current.source, writable: state.writable }
    },
    async set(value) { state.current = { value, source: 'file' } },
    async unset() { state.current = undefined },
  }
}

/** Logger double that records every message. */
export function fakeLogger() {
  const messages = []
  return {
    messages,
    warn: (...args) => messages.push(['warn', ...args]),
    info: (...args) => messages.push(['info', ...args]),
  }
}

/** Collect everything observable about a value as text, to assert a secret never appears. */
export function everything(value) {
  const seen = []
  const visit = (item, depth = 0) => {
    if (depth > 6 || item === null || item === undefined) return
    if (item instanceof Error) {
      seen.push(String(item), item.stack ?? '', item.message)
      for (const name of Object.getOwnPropertyNames(item)) seen.push(name, String(item[name]))
      if (item.cause !== undefined) visit(item.cause, depth + 1)
      return
    }
    if (typeof item === 'object') {
      seen.push(JSON.stringify(item))
      return
    }
    seen.push(String(item))
  }
  visit(value)
  return seen.join('\n')
}
