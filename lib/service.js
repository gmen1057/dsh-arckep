/**
 * Host-side state machine: resolves the key, talks to the API (one request at
 * a time), caches the last good answer, backs off after failures and builds
 * the JSON the browser half renders.
 *
 * The browser asks for the state; this service refreshes upstream only when the
 * cache is older than the requested interval, so nothing runs while no DSH page
 * is open and there are no timers to leak.
 */

import { createHash } from 'node:crypto'
import { ArckepError, isValidKey } from './api.js'

export const MIN_INTERVAL_MS = 60_000
export const MAX_INTERVAL_MS = 86_400_000
export const DEFAULT_INTERVAL_MS = 300_000
/** Smallest gap between two manual refreshes of the same view. */
export const MANUAL_MIN_SPACING_MS = 5_000
export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_MAX_MS = 30 * 60_000
/** After a 404 on /usage the endpoint is probed again no sooner than this. */
export const USAGE_REPROBE_MS = 15 * 60_000

/** Errors that are not worth retrying until the key (or its scopes) change. */
const PERMANENT_CODES = new Set(['unauthorized', 'forbidden', 'invalid_key'])

/**
 * @typedef {object} CredentialsPort
 * @property {() => Promise<{ value: string, source?: string } | undefined>} resolve - read the stored key.
 * @property {() => Promise<{ configured: boolean, source?: string, writable?: boolean }>} describe - describe it without the value.
 * @property {(value: string) => Promise<void>} set - store a key.
 * @property {() => Promise<void>} unset - remove the stored key.
 */

/**
 * Create the service.
 * @param {object} deps - dependencies.
 * @param {{ getBalance: Function, getUsage: Function, origin: string }} deps.api - API client.
 * @param {CredentialsPort} deps.credentials - credential access.
 * @param {() => number} [deps.now] - clock.
 * @param {() => number} [deps.random] - jitter source in [0, 1).
 * @param {{ warn?: Function, info?: Function }} [deps.logger] - logger; receives only error codes.
 * @param {{ refreshSeconds: number, warnBelowRub: number, keyOnly: boolean }} [deps.defaults] - defaults forwarded to the browser.
 * @returns {object} the service.
 */
export function createService(deps) {
  const { api, credentials } = deps
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  const logger = deps.logger ?? {}
  const defaults = deps.defaults ?? { refreshSeconds: 300, warnBelowRub: 100, keyOnly: false }

  const entries = new Map()
  const abort = new AbortController()
  let chain = Promise.resolve()
  let disposed = false
  let lastLoggedCode = null

  function entryFor(variant, keyId) {
    // A different key (rotated, removed, switched by the environment) never
    // sees data fetched with the previous one.
    for (const [name, entry] of entries) {
      if (entry.keyId !== keyId) entries.delete(name)
    }
    let entry = entries.get(variant)
    if (entry === undefined) {
      entry = {
        keyId,
        balance: null,
        usage: null,
        usageState: 'unknown',
        usageRequired: null,
        usageProbeAfter: 0,
        fetchedAt: 0,
        lastAttemptAt: 0,
        retryAt: 0,
        failures: 0,
        error: null,
        inflight: null,
      }
      entries.set(variant, entry)
    }
    return entry
  }

  /** Serialize upstream work: never more than one request at a time. */
  function exclusive(task) {
    const run = chain.then(task, task)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  function recordFailure(entry, error) {
    const code = error instanceof ArckepError ? error.code : 'network'
    entry.failures += 1
    entry.error = {
      code,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.required !== undefined ? { required: error.required } : {}),
    }
    if (PERMANENT_CODES.has(code)) {
      entry.retryAt = Number.POSITIVE_INFINITY
      entry.balance = null
      entry.usage = null
      entry.usageState = 'unknown'
    } else {
      const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (entry.failures - 1))
      const jittered = exponential * (0.8 + 0.4 * random())
      entry.retryAt = now() + Math.max(jittered, error.retryAfterMs ?? 0)
    }
    if (lastLoggedCode !== code) {
      lastLoggedCode = code
      logger.warn?.(`dsh-arckep: refresh failed (${code})`)
    }
  }

  function recordSuccess(entry) {
    entry.failures = 0
    entry.retryAt = 0
    entry.error = null
    if (lastLoggedCode !== null) {
      lastLoggedCode = null
      logger.info?.('dsh-arckep: refresh recovered')
    }
  }

  async function refresh(entry, key, keyOnly, force) {
    entry.lastAttemptAt = now()
    try {
      const balance = await api.getBalance(key, abort.signal)
      entry.balance = balance
      entry.fetchedAt = now()
      recordSuccess(entry)
    } catch (error) {
      if (error instanceof ArckepError && error.code === 'aborted') return
      recordFailure(entry, error)
      return
    }
    if (entry.usageState === 'unavailable' && !force && now() < entry.usageProbeAfter) return
    try {
      entry.usage = await api.getUsage(key, { days: 30, keyOnly }, abort.signal)
      entry.usageState = 'ok'
      entry.usageRequired = null
    } catch (error) {
      if (!(error instanceof ArckepError) || error.code === 'aborted') return
      if (error.code === 'not_found') {
        // The endpoint is not deployed yet: not an error, just hide the block.
        entry.usage = null
        entry.usageState = 'unavailable'
        entry.usageProbeAfter = now() + USAGE_REPROBE_MS
      } else if (error.code === 'forbidden') {
        entry.usage = null
        entry.usageState = 'forbidden'
        entry.usageRequired = error.required ?? null
      } else {
        // Keep the previous usage numbers, flag them as stale.
        entry.usageState = entry.usage === null ? 'error' : 'stale'
      }
    }
  }

  async function resolveKey() {
    try {
      const resolved = await credentials.resolve()
      return resolved !== undefined && isValidKey(resolved.value) ? resolved : undefined
    } catch {
      throw new ArckepError('credentials')
    }
  }

  async function describeKey(resolved) {
    let info
    try {
      info = await credentials.describe()
    } catch {
      info = undefined
    }
    return {
      configured: resolved !== undefined,
      source: safeToken(resolved?.source ?? info?.source),
      writable: info?.writable !== false,
    }
  }

  function buildState(entry, key, current) {
    const status = entry === null
      ? (key.configured ? 'pending' : 'no_key')
      : entry.balance !== null ? 'ok' : entry.error !== null ? 'error' : 'pending'
    const usage = entry === null ? null : buildUsage(entry)
    return {
      v: 1,
      now: current,
      key,
      status,
      stale: entry !== null && entry.balance !== null && entry.error !== null,
      fetchedAt: entry === null || entry.fetchedAt === 0 ? null : entry.fetchedAt,
      error: entry === null || entry.error === null ? null : {
        ...entry.error,
        retryAt: Number.isFinite(entry.retryAt) && entry.retryAt > 0 ? entry.retryAt : null,
      },
      balance: entry?.balance ?? null,
      usage,
      defaults,
    }
  }

  function buildUsage(entry) {
    if (entry.usageState === 'unknown') return null
    return {
      state: entry.usageState,
      required: entry.usageRequired,
      ...(entry.usage ?? {}),
    }
  }

  return {
    /**
     * Return the current view, refreshing upstream when it is due.
     * @param {{ keyOnly?: boolean, intervalMs?: number, force?: boolean }} [options] - view options.
     * @returns {Promise<object>} state for the browser.
     */
    async getState(options = {}) {
      const current = now()
      let resolved
      try {
        resolved = await resolveKey()
      } catch {
        return { ...buildState(null, { configured: false, source: null, writable: false }, current), status: 'error', error: { code: 'credentials', retryAt: null } }
      }
      const key = await describeKey(resolved)
      if (resolved === undefined) {
        entries.clear()
        return buildState(null, key, current)
      }
      const keyOnly = options.keyOnly === true
      const variant = keyOnly ? 'key' : 'all'
      const entry = entryFor(variant, fingerprint(resolved.value))
      const interval = clamp(options.intervalMs ?? defaults.refreshSeconds * 1000, MIN_INTERVAL_MS, MAX_INTERVAL_MS)
      if (!disposed) {
        if (entry.inflight === null && isDue(entry, interval, options.force === true, current)) {
          entry.inflight = exclusive(() => refresh(entry, resolved.value, keyOnly, options.force === true))
            .finally(() => { entry.inflight = null })
        }
        if (entry.inflight !== null) await entry.inflight
      }
      return buildState(entry, key, now())
    },

    /**
     * Store a new key, then validate it with a forced refresh.
     * @param {unknown} value - key typed by the user.
     * @param {{ keyOnly?: boolean }} [options] - view options.
     * @returns {Promise<object>} state after the refresh.
     */
    async setKey(value, options = {}) {
      if (!isValidKey(value)) throw new ArckepError('invalid_key')
      const info = await credentials.describe().catch(() => undefined)
      if (info?.writable === false) throw new ArckepError('read_only')
      try {
        await credentials.set(value)
      } catch {
        throw new ArckepError('credentials')
      }
      entries.clear()
      return this.getState({ ...options, force: true })
    },

    /**
     * Remove the stored key.
     * @param {{ keyOnly?: boolean }} [options] - view options.
     * @returns {Promise<object>} state after removal.
     */
    async clearKey(options = {}) {
      const info = await credentials.describe().catch(() => undefined)
      if (info?.writable === false) throw new ArckepError('read_only')
      try {
        await credentials.unset()
      } catch {
        throw new ArckepError('credentials')
      }
      entries.clear()
      return this.getState(options)
    },

    /** Drop every cached answer (the key changed behind our back). */
    invalidate() {
      entries.clear()
    },

    /** Abort in-flight requests and refuse further upstream work. */
    dispose() {
      disposed = true
      abort.abort()
      entries.clear()
    },
  }
}

/**
 * @param {object} entry - cache entry.
 * @param {number} interval - requested refresh interval in ms.
 * @param {boolean} force - manual refresh.
 * @param {number} current - current time.
 * @returns {boolean} whether an upstream request should start now.
 */
function isDue(entry, interval, force, current) {
  if (force) {
    if (entry.error?.code === 'rate_limited' && current < entry.retryAt) return false
    return current - entry.lastAttemptAt >= MANUAL_MIN_SPACING_MS
  }
  if (current < entry.retryAt) return false
  return entry.lastAttemptAt === 0 || current - entry.lastAttemptAt >= interval
}

/**
 * @param {number} value - number to clamp.
 * @param {number} min - lower bound.
 * @param {number} max - upper bound.
 * @returns {number} clamped value.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max)
}

/**
 * A short one-way fingerprint used only to notice that the key changed.
 * @param {string} key - the API key.
 * @returns {string} 12 hex characters of its SHA-256.
 */
function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

/**
 * @param {unknown} value - source label from the credential store.
 * @returns {string | null} a short lowercase token or null.
 */
function safeToken(value) {
  if (typeof value !== 'string') return null
  const token = value.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 32)
  return token === '' ? null : token
}
