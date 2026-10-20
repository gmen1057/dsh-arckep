/**
 * arckep.ru public API client.
 *
 * Hard rules enforced here, independent of who calls this module:
 *  - the only reachable origin is https://arckep.ru (a loopback http origin is
 *    accepted solely for tests, see {@link resolveOrigin});
 *  - redirects are never followed: any 3xx is an error;
 *  - every request has a timeout and a response-size cap;
 *  - the API key only ever travels in the Authorization header, and no error,
 *    log line or return value produced by this module contains it.
 */

import { compareDecimal, normalizeDecimal } from './decimal.js'

/** The one origin the plugin talks to in production. */
export const ORIGIN = 'https://arckep.ru'

/** Name of the credential (and of the optional environment variable). */
export const KEY_NAME = 'ARCKEP_API_KEY'

/**
 * Development-only switch: when set to a loopback http origin with a port of
 * 1024 or more (for example http://127.0.0.1:39100) the plugin talks to that
 * local mock instead of arckep.ru. Any other value is ignored.
 */
export const TEST_ORIGIN_ENV = 'DSH_ARCKEP_TEST_ORIGIN'

/** Request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000

/** Delay before a single retry after a transient network failure, in milliseconds. */
export const RETRY_DELAY_MS = 1_500

/** Largest response body the client reads, in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024

const API_PREFIX = '/api/v1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const KEY_PATTERN = /^[\x21-\x7e]{8,512}$/
const REQUIRED_PATTERN = /^[A-Za-z0-9_:.-]{1,64}$/

/** Error with a stable machine-readable `code`; its message never carries remote text. */
export class ArckepError extends Error {
  /**
   * @param {string} code - one of the documented error codes.
   * @param {{ status?: number, required?: string[], retryAfterMs?: number }} [extra] - safe, structured details.
   */
  constructor(code, extra = {}) {
    super(code)
    this.name = 'ArckepError'
    this.code = code
    if (extra.status !== undefined) this.status = extra.status
    if (extra.required !== undefined) this.required = extra.required
    if (extra.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs
  }
}

/**
 * Decide which origin to use.
 * @param {Record<string, string | undefined>} [env] - process environment.
 * @returns {{ origin: string, override: boolean, rejectedOverride: boolean }} the origin and how it was chosen.
 */
export function resolveOrigin(env = {}) {
  const raw = env[TEST_ORIGIN_ENV]
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { origin: ORIGIN, override: false, rejectedOverride: false }
  }
  const origin = parseLoopbackOrigin(raw.trim())
  if (origin === null) return { origin: ORIGIN, override: false, rejectedOverride: true }
  return { origin, override: true, rejectedOverride: false }
}

/**
 * Accept only `http://<loopback>:<port>` with a non-privileged port and no path.
 * @param {string} raw - candidate origin.
 * @returns {string | null} the normalized origin, or null.
 */
function parseLoopbackOrigin(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
  if (url.pathname !== '/') return null
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return url.origin
}

/**
 * Whether `origin` may be used by {@link createApiClient}.
 * @param {string} origin - candidate origin.
 * @returns {boolean} true for https://arckep.ru and for test loopback origins.
 */
export function isAllowedOrigin(origin) {
  return origin === ORIGIN || parseLoopbackOrigin(origin) === origin
}

/**
 * Check that a string can be used as an API key (visible ASCII, no whitespace).
 * @param {unknown} key - candidate key.
 * @returns {boolean} true when the key has an acceptable shape.
 */
export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/**
 * Remove control characters and cap the length of a text coming from the API.
 * @param {unknown} value - untrusted value.
 * @param {number} max - maximum length.
 * @returns {string | null} cleaned text or null when empty/not a string.
 */
export function cleanText(value, max) {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max)
  return text === '' ? null : text
}

/**
 * Parse the `GET /balance` payload.
 * @param {unknown} json - decoded body.
 * @returns {{ rub: string, corporate: boolean, corporateName: string | null }} normalized balance.
 */
export function parseBalance(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new ArckepError('bad_response')
  const rub = normalizeDecimal(json.balance_rub)
  if (rub === null) throw new ArckepError('bad_response')
  const corporate = json.is_corporate === true
  return { rub, corporate, corporateName: corporate ? cleanText(json.corporate_name, 120) : null }
}

/**
 * Parse the `GET /usage` payload. Unknown or malformed fields become null.
 * @param {unknown} json - decoded body.
 * @returns {object} normalized usage block.
 */
export function parseUsage(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new ArckepError('bad_response')
  const totalsRaw = json.totals !== null && typeof json.totals === 'object' ? json.totals : {}
  const models = []
  if (Array.isArray(json.by_model)) {
    for (const row of json.by_model) {
      if (row === null || typeof row !== 'object') continue
      const model = cleanText(row.model, 80)
      const costRub = normalizeDecimal(row.cost_rub)
      if (model === null || costRub === null) continue
      models.push({ model, costRub, requests: toCount(row.requests) })
    }
  }
  models.sort((a, b) => compareDecimal(b.costRub, a.costRub))
  return {
    periodDays: toCount(json.period_days),
    totals: {
      todayRub: normalizeDecimal(totalsRaw.today_rub),
      last7dRub: normalizeDecimal(totalsRaw.last_7d_rub),
      periodRub: normalizeDecimal(totalsRaw.period_rub),
      requests: toCount(totalsRaw.requests),
    },
    byModel: models.slice(0, 10),
    forecastDaysLeft: toForecast(json.forecast_days_left),
  }
}

/**
 * @param {unknown} value - untrusted number.
 * @returns {number | null} a non-negative safe integer, else null.
 */
function toCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/**
 * @param {unknown} value - untrusted number of days.
 * @returns {number | null} days rounded to one decimal, clamped to 0..3650, else null.
 */
function toForecast(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(Math.min(value, 3650) * 10) / 10
}

/**
 * Map an HTTP status to an error code.
 * @param {number} status - HTTP status.
 * @returns {string} error code.
 */
function codeForStatus(status) {
  if (status >= 300 && status < 400) return 'redirect'
  if (status === 401) return 'unauthorized'
  if (status === 402) return 'payment_required'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'http_error'
}

/**
 * Extract the safe, structured part of an API error body.
 * @param {string} text - raw body.
 * @returns {{ required?: string[] }} sanitized details.
 */
function parseErrorDetails(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return {}
  }
  const details = json !== null && typeof json === 'object' ? json.details : undefined
  const required = details !== null && typeof details === 'object' ? details.required : undefined
  const list = (Array.isArray(required) ? required : [required])
    .filter(item => typeof item === 'string' && REQUIRED_PATTERN.test(item))
    .slice(0, 5)
  return list.length > 0 ? { required: list } : {}
}

/**
 * @param {string | null} header - Retry-After header value.
 * @param {number} now - current time in ms.
 * @returns {number | undefined} delay in ms clamped to 1 s..1 h.
 */
function parseRetryAfter(header, now) {
  if (header === null || header === undefined) return undefined
  const seconds = Number(header)
  let ms
  if (Number.isFinite(seconds)) ms = seconds * 1000
  else {
    const date = Date.parse(header)
    if (!Number.isFinite(date)) return undefined
    ms = date - now
  }
  return Math.min(Math.max(ms, 1000), 3_600_000)
}

/**
 * Read a response body with a hard size cap.
 * @param {Response} response - fetch response.
 * @param {number} maxBytes - size cap.
 * @returns {Promise<string>} decoded text.
 */
async function readLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new ArckepError('bad_response')
  const reader = response.body?.getReader?.()
  if (reader === undefined) {
    const text = await response.text()
    if (text.length > maxBytes) throw new ArckepError('bad_response')
    return text
  }
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ArckepError('bad_response')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Combine abort signals (AbortSignal.any with a fallback for older Node 20).
 * @param {AbortSignal[]} signals - signals to merge.
 * @returns {AbortSignal} a signal aborted when any input aborts.
 */
function anySignal(signals) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/**
 * Wait before retrying a transient network failure, aborting immediately if the caller cancels.
 * @param {number} ms - delay in milliseconds.
 * @param {AbortSignal | undefined} signal - caller cancellation signal.
 * @returns {Promise<void>} resolves after the delay or rejects with `aborted`.
 */
function waitRetry(ms, signal) {
  if (signal?.aborted === true) return Promise.reject(new ArckepError('aborted'))
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ArckepError('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Create the API client.
 * @param {object} [options] - client options.
 * @param {string} [options.origin] - ORIGIN, or a loopback test origin.
 * @param {typeof fetch} [options.fetchImpl] - fetch implementation (tests inject a mock).
 * @param {number} [options.timeoutMs] - request timeout.
 * @param {number} [options.retryDelayMs] - pause before a single retry on a network error.
 * @param {number} [options.maxBodyBytes] - response size cap.
 * @param {() => number} [options.now] - clock used for Retry-After dates.
 * @returns {{ origin: string, getBalance: Function, getUsage: Function }} the client.
 */
export function createApiClient(options = {}) {
  const origin = options.origin ?? ORIGIN
  if (!isAllowedOrigin(origin)) throw new TypeError('origin is not allowed')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? (options.fetchImpl === undefined ? RETRY_DELAY_MS : 0)
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES
  const now = options.now ?? Date.now

  async function requestOnce(href, headers, signal) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const merged = signal === undefined ? timeout : anySignal([timeout, signal])
    let response
    let text
    try {
      response = await fetchImpl(href, {
        method: 'GET',
        redirect: 'manual',
        signal: merged,
        headers,
      })
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel?.().catch?.(() => {})
        throw new ArckepError('redirect', { status: response.status })
      }
      text = await readLimited(response, maxBodyBytes)
    } catch (error) {
      throw toArckepError(error, signal)
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        return JSON.parse(text)
      } catch {
        throw new ArckepError('bad_response', { status: response.status })
      }
    }
    const extra = { status: response.status, ...parseErrorDetails(text) }
    const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after') ?? null, now())
    if (retryAfterMs !== undefined) extra.retryAfterMs = retryAfterMs
    throw new ArckepError(codeForStatus(response.status), extra)
  }

  async function request(path, query, key, signal) {
    if (!isValidKey(key)) throw new ArckepError('invalid_key')
    const url = new URL(`${origin}${API_PREFIX}${path}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value))
    // Defence in depth: nothing may have changed the authority while building the URL.
    if (url.origin !== origin || url.username !== '' || url.password !== '') throw new ArckepError('invalid_origin')
    const headers = {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'accept-encoding': 'identity',
      'user-agent': 'dsh-arckep',
    }
    try {
      return await requestOnce(url.href, headers, signal)
    } catch (error) {
      if (!(error instanceof ArckepError) || error.code !== 'network' || signal?.aborted === true) throw error
      await waitRetry(retryDelayMs, signal)
      return await requestOnce(url.href, headers, signal)
    }
  }

  return {
    origin,
    /**
     * @param {string} key - API key.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<ReturnType<typeof parseBalance>>} balance.
     */
    async getBalance(key, signal) {
      return parseBalance(await request('/balance', {}, key, signal))
    },
    /**
     * @param {string} key - API key.
     * @param {{ days?: number, keyOnly?: boolean }} [params] - usage query.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<ReturnType<typeof parseUsage>>} usage.
     */
    async getUsage(key, params = {}, signal) {
      const query = { days: params.days ?? 30, key_only: params.keyOnly === true ? 'true' : 'false' }
      return parseUsage(await request('/usage', query, key, signal))
    },
  }
}

/**
 * Convert any thrown value into an {@link ArckepError} without keeping its message.
 * @param {unknown} error - thrown value.
 * @param {AbortSignal | undefined} callerSignal - cancellation signal supplied by the caller.
 * @returns {ArckepError} classified error.
 */
function toArckepError(error, callerSignal) {
  if (error instanceof ArckepError) return error
  if (callerSignal?.aborted === true) return new ArckepError('aborted')
  const name = typeof error === 'object' && error !== null ? error.name : undefined
  if (name === 'TimeoutError' || name === 'AbortError') return new ArckepError('timeout')
  return new ArckepError('network')
}
