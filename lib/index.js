/**
 * dsh-arckep — Host half.
 *
 * Shows the balance and spending of an arckep.ru account inside the DSH web
 * UI. This half runs inside the DSH process: it keeps the API key in DSH's
 * credential store, calls https://arckep.ru from the server (never from the
 * browser) and exposes four small routes on DSH's authenticated `/api` channel
 * for the browser half in ./client.js.
 */

import Schema from '@deepseek-ai/schemastery'
import { KEY_NAME, TEST_ORIGIN_ENV, createApiClient, resolveOrigin } from './api.js'
import { createRoutes } from './routes.js'
import { createService } from './service.js'

export const name = 'dsh-arckep'

/** Services this half needs: the authenticated browser transport and the key store. */
export const inject = ['connection', 'credentials']

/** Deployment defaults. The card in Settings overrides them per browser. */
export const Config = Schema.object({
  refreshSeconds: Schema.number().step(1).min(60).max(86400).default(300)
    .description('Default polling interval in seconds (minimum 60).'),
  warnBelowRub: Schema.number().min(0).default(100)
    .description('Default balance threshold in rubles below which the badge turns to a warning.'),
  keyOnly: Schema.boolean().default(false)
    .description('Default for "count spending for this key only".'),
})

/**
 * Wire the plugin into a DSH Host context.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {{ refreshSeconds?: number, warnBelowRub?: number, keyOnly?: boolean }} [config] - resolved configuration.
 */
export function apply(ctx, config = {}) {
  const chosen = resolveOrigin(process.env)
  if (chosen.rejectedOverride) {
    ctx.logger.warn(`dsh-arckep: ${TEST_ORIGIN_ENV} ignored (only http://127.0.0.1:<port> style origins are accepted)`)
  }
  if (chosen.override) {
    ctx.logger.warn(`dsh-arckep: test origin override is active, requests go to ${chosen.origin}`)
  }

  // Read ctx.credentials on every call: the service may be replaced by HMR.
  const credentials = {
    resolve: () => ctx.credentials.resolve(KEY_NAME),
    describe: () => ctx.credentials.describe(KEY_NAME),
    set: value => ctx.credentials.set(KEY_NAME, value),
    unset: () => ctx.credentials.unset(KEY_NAME),
  }

  const service = createService({
    api: createApiClient({ origin: chosen.origin }),
    credentials,
    logger: ctx.logger,
    defaults: {
      refreshSeconds: config.refreshSeconds ?? 300,
      warnBelowRub: config.warnBelowRub ?? 100,
      keyOnly: config.keyOnly ?? false,
    },
  })

  // Aborts any in-flight request when the plugin is unloaded or hot-replaced.
  ctx.effect(() => () => service.dispose(), 'dsh-arckep: service')

  // The key changed behind our back (another process edited the store).
  ctx.on('credentials/reference-updated', (ref) => {
    if (String(ref) === KEY_NAME) service.invalidate()
  })

  for (const route of createRoutes(service)) ctx.connection.fetch.register(route)
}
