/** Loads lib/client.js the way DSH does: it registers a factory with window.__ModuleLoader__. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let counter = 0

export async function loadClient() {
  const loads = []
  const required = []
  globalThis.window = { __ModuleLoader__: { load: spec => loads.push(spec) } }
  await import(`../lib/client.js?fresh=${counter++}`)
  const React = require('react')
  const ReactDOM = require('react-dom')
  const modules = { react: React, 'react-dom': ReactDOM }
  const exports = loads[0].factory((id) => {
    required.push(id)
    if (!(id in modules)) throw new Error(`unexpected require("${id}")`)
    return modules[id]
  })
  return { loads, required, exports, t: exports.__test, React, ReactDOM }
}

/** Manual timers: nothing runs until advance() is called. */
export function fakeTimers() {
  let nextId = 1
  const pending = new Map()
  let clock = 0
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, at: clock + ms }); return id },
    clearTimeout(id) { pending.delete(id) },
    get pending() { return pending.size },
    delays() { return [...pending.values()].map(entry => entry.at - clock) },
    async advance(ms) {
      clock += ms
      for (const [id, entry] of [...pending]) {
        if (entry.at <= clock) { pending.delete(id); entry.fn() }
      }
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

export function fakeStorage({ throws = false, data = {} } = {}) {
  const map = new Map(Object.entries(data))
  const fail = () => { if (throws) throw new Error('storage blocked') }
  return {
    map,
    getItem(key) { fail(); return map.has(key) ? map.get(key) : null },
    setItem(key, value) { fail(); map.set(key, String(value)) },
    removeItem(key) { fail(); map.delete(key) },
  }
}

export function fakeDocument() {
  const listeners = new Map()
  const doc = {
    visibilityState: 'visible',
    head: { children: [], appendChild(node) { this.children.push(node) } },
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
    createElement() {
      const node = { attrs: {}, textContent: '', removed: false, setAttribute(k, v) { this.attrs[k] = v }, remove() { this.removed = true } }
      return node
    },
    listeners,
    fire(type) { listeners.get(type)?.() },
  }
  return doc
}

/** A scripted fetch for the controller: queue answers, inspect calls. */
export function fakeHostFetch() {
  const calls = []
  const queue = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init })
    const next = queue.length > 0 ? queue.shift() : fn.fallback
    if (typeof next === 'function') return next(url, init)
    if (next instanceof Error) throw next
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => structuredClone(next.body) }
  }
  fn.calls = calls
  fn.queue = queue
  fn.fallback = { status: 200, body: serverState() }
  fn.answer = (status, body) => queue.push({ status, body })
  return fn
}

/** A server state as the Host returns it. */
export function serverState(overrides = {}) {
  return {
    v: 1,
    now: 1_760_000_000_000,
    key: { configured: true, source: 'file', writable: true },
    status: 'ok',
    stale: false,
    fetchedAt: 1_760_000_000_000 - 120_000,
    error: null,
    balance: { rub: '1234.5', corporate: false, corporateName: null },
    usage: {
      state: 'ok',
      required: null,
      periodDays: 30,
      totals: { todayRub: '1.23', last7dRub: '10.50', periodRub: '42.00', requests: 1234 },
      byModel: [
        { model: 'anthropic/claude-opus', costRub: '20.10', requests: 12 },
        { model: 'deepseek/deepseek-pro', costRub: '9.99', requests: 7 },
        { model: 'deepseek/deepseek-flash', costRub: '5.00', requests: 100 },
        { model: 'openai/model-a', costRub: '1.00', requests: 1 },
        { model: 'openai/model-b', costRub: '0.50', requests: 1 },
        { model: 'google/sixth', costRub: '0.05', requests: 3 },
      ],
      forecastDaysLeft: 12,
    },
    defaults: { refreshSeconds: 300, warnBelowRub: 100, keyOnly: false },
    ...overrides,
  }
}

export function snapshotOf(partial = {}) {
  return {
    lang: 'ru',
    server: serverState(),
    receivedAt: 1_760_000_000_000,
    loading: false,
    hostError: false,
    busy: null,
    notice: null,
    overrides: {},
    ...partial,
  }
}
