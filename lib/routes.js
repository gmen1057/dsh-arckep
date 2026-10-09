/**
 * HTTP routes the browser half talks to.
 *
 * They are registered on DSH's authenticated `/api` channel
 * (`ctx.connection.fetch.register`), so every request has already passed DSH's
 * Host/Origin fence and the browser-session cookie check before it gets here.
 * On top of that, state-changing routes require a JSON content type and refuse
 * requests the browser labels as same-site or cross-site.
 */

import { ArckepError } from './api.js'

export const ROUTE_PATHS = Object.freeze({
  state: '/api/arckep.state',
  refresh: '/api/arckep.refresh',
  keySet: '/api/arckep.key-set',
  keyClear: '/api/arckep.key-clear',
})

/** Largest request body accepted by the POST routes. */
export const MAX_REQUEST_BYTES = 4096

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

/**
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 * @returns {Response} JSON response that must not be cached.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * Read a small JSON object from the request body.
 * @param {Request} request - incoming request.
 * @returns {Promise<Record<string, unknown>>} parsed object ({} for an empty body).
 */
async function readJsonBody(request) {
  const type = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type')
  const reader = request.body?.getReader?.()
  if (reader === undefined) return {}
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, 'payload_too_large')
    }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks)).trim()
  if (text === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_json')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'bad_json')
  return parsed
}

/** Reject browser-labelled same-site/cross-site initiators on state-changing routes. */
function assertSameOrigin(request) {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'forbidden_origin')
}

/**
 * Turn a thrown value into a response without leaking details.
 * @param {unknown} error - thrown value.
 * @returns {Response} JSON error response.
 */
function failure(error) {
  if (error instanceof HttpError) return json(error.status, { error: error.code })
  if (error instanceof ArckepError) {
    const status = error.code === 'invalid_key' ? 400 : error.code === 'read_only' ? 409 : 500
    return json(status, { error: error.code })
  }
  return json(500, { error: 'internal' })
}

/**
 * @param {string | null} value - query value.
 * @returns {boolean} whether it spells "true".
 */
function flag(value) {
  return value === '1' || value === 'true'
}

/**
 * Build the route table.
 * @param {ReturnType<import('./service.js').createService>} service - state service.
 * @returns {Array<{ path: string, methods: string[], requestBody: 'buffered' | 'streaming', fetch: (request: Request) => Promise<Response> }>} routes.
 */
export function createRoutes(service) {
  return [
    {
      path: ROUTE_PATHS.state,
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const params = new URL(request.url).searchParams
          const seconds = Number(params.get('interval'))
          const state = await service.getState({
            keyOnly: flag(params.get('keyOnly')),
            ...(Number.isFinite(seconds) && seconds > 0 ? { intervalMs: seconds * 1000 } : {}),
          })
          return json(200, state)
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: ROUTE_PATHS.refresh,
      methods: ['POST'],
      requestBody: 'streaming',
      async fetch(request) {
        try {
          assertSameOrigin(request)
          const body = await readJsonBody(request)
          return json(200, await service.getState({ keyOnly: body.keyOnly === true, force: true }))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: ROUTE_PATHS.keySet,
      methods: ['POST'],
      requestBody: 'streaming',
      async fetch(request) {
        try {
          assertSameOrigin(request)
          const body = await readJsonBody(request)
          const key = typeof body.key === 'string' ? body.key.trim() : body.key
          return json(200, await service.setKey(key, { keyOnly: body.keyOnly === true }))
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: ROUTE_PATHS.keyClear,
      methods: ['POST'],
      requestBody: 'streaming',
      async fetch(request) {
        try {
          assertSameOrigin(request)
          const body = await readJsonBody(request)
          return json(200, await service.clearKey({ keyOnly: body.keyOnly === true }))
        } catch (error) {
          return failure(error)
        }
      },
    },
  ]
}
