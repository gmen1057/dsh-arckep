/**
 * dsh-arckep — browser half.
 *
 * One self-contained file in DSH's lazy-CommonJS client module format: running
 * it only registers a factory; nothing else happens until DSH materializes the
 * plugin. It is plain JavaScript on purpose (no build step), so installing the
 * package from GitHub needs nothing but a copy of the repository.
 *
 * The browser never talks to arckep.ru and never sees the API key: it only
 * calls the plugin's own routes on DSH's authenticated `/api` channel.
 */
window.__ModuleLoader__.load({
  id: 'dsh-arckep',
  factory: (require) => {
    const exports = {}
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } = React

    // ---------------------------------------------------------------- constants

    const ROUTES = {
      state: 'api/arckep.state',
      refresh: 'api/arckep.refresh',
      keySet: 'api/arckep.key-set',
      keyClear: 'api/arckep.key-clear',
    }
    const PREFS_KEY = 'dsh-arckep:prefs:v1'
    const NBSP = ' '
    const RUBLE = '₽'
    const MIN_INTERVAL = 60
    const MAX_INTERVAL = 86400
    const WARN_DAYS = 3
    const BUILTIN_DEFAULTS = { intervalSeconds: 300, warnBelowRub: 100, keyOnly: false }

    // --------------------------------------------------------------------- i18n

    const DICT = {
      ru: {
        name: 'Arckep',
        balance: 'Баланс',
        corporate: 'Корпоративный кошелёк: {name}',
        corporateNoName: 'Корпоративный кошелёк',
        spending: 'Расход',
        today: 'Сегодня',
        days7: '7 дней',
        days30: '30 дней',
        daysN: '{n} дн.',
        topModels: 'Топ моделей',
        forecastDays: 'Хватит примерно на {n} дн.',
        forecastLessDay: 'Хватит меньше чем на сутки',
        updated: 'Обновлено {ago}',
        agoNow: 'только что',
        agoMin: '{n} мин назад',
        agoHour: '{n} ч назад',
        agoDay: '{n} дн. назад',
        notUpdated: 'Данные ещё не получены',
        refresh: 'Обновить',
        refreshing: 'Обновление…',
        stale: 'данные устарели',
        loading: 'Загрузка…',
        noKeyTitle: 'Ключ arckep не задан',
        noKeyHint: 'Откройте Настройки → Arckep и вставьте ключ API.',
        usageUnavailable: 'Расход пока недоступен на стороне arckep.ru.',
        usageForbidden: 'У ключа нет доступа к расходу{scope}.',
        usageError: 'Не удалось получить расход.',
        usageStale: 'расход мог устареть',
        badgeTitle: 'Arckep: {text}',
        'err.unauthorized': 'arckep.ru не принял ключ (401). Проверьте ключ в настройках.',
        'err.forbidden': 'У ключа нет нужного доступа{scope}. Создайте ключ с доступом «баланс».',
        'err.payment_required': 'arckep.ru ответил 402 (требуется оплата).',
        'err.rate_limited': 'Слишком много запросов (429). Попробуем позже.',
        'err.server_error': 'Сервис arckep.ru временно недоступен (5xx).',
        'err.network': 'Нет связи с arckep.ru.',
        'err.timeout': 'arckep.ru не ответил за 10 секунд.',
        'err.redirect': 'Сервис ответил перенаправлением — запрос заблокирован из соображений безопасности.',
        'err.bad_response': 'Непонятный ответ сервиса.',
        'err.http_error': 'Сервис вернул ошибку.',
        'err.not_found': 'Адрес API не найден (404).',
        'err.credentials': 'Хранилище ключей DSH недоступно.',
        'err.host': 'Нет связи с DSH.',
        'err.invalid_key': 'Это не похоже на ключ API: он состоит из 8–512 печатных символов без пробелов.',
        'err.read_only': 'Ключ задан переменной окружения — изменить его можно только там.',
        'err.empty': 'Вставьте ключ.',
        'err.invalid_origin': 'Запрос заблокирован: адрес сервиса не разрешён.',
        'err.unsupported_media_type': 'DSH отклонил запрос (неверный тип данных).',
        'err.payload_too_large': 'Ключ слишком длинный.',
        'err.bad_json': 'DSH не понял запрос.',
        'err.forbidden_origin': 'DSH отклонил запрос: он пришёл не с этой страницы.',
        'err.internal': 'Внутренняя ошибка плагина.',
        'err.unknown': 'Неизвестная ошибка.',
        settingsTitle: 'Arckep: баланс и расход',
        settingsLead: 'Показывает баланс и расход аккаунта arckep.ru в окне DSH.',
        keyHeading: 'Ключ API',
        keyIsSet: 'Ключ задан',
        keyNotSet: 'Ключ не задан',
        keySourceEnv: 'из переменной окружения ARCKEP_API_KEY',
        keySourceStore: 'в хранилище ключей DSH',
        keySourceProjectEnv: 'из файла .env проекта',
        keySourceUserEnv: 'из файла .env в папке DSH',
        keyPlaceholder: 'Вставьте ключ (ark_live_…)',
        keyInputLabel: 'Ключ API arckep',
        save: 'Сохранить',
        deleteKey: 'Удалить ключ',
        saved: 'Ключ сохранён.',
        savedWithError: 'Ключ сохранён, но проверить его не удалось.',
        deleted: 'Ключ удалён.',
        whereToGet: 'Где взять ключ: arckep.ru → Настройки → API. Нужен доступ «баланс» (balance:read).',
        scopeTip: 'Лучше создать отдельный ключ только с этим доступом: хранилище DSH читается тем же пользователем, под которым работают инструменты агента.',
        viewHeading: 'Показ',
        keyOnly: 'Считать расход только по этому ключу',
        interval: 'Интервал опроса, секунд (не меньше 60)',
        threshold: 'Предупреждать, когда баланс ниже, ₽',
        reset: 'Сбросить',
        language: 'Язык интерфейса',
        langAuto: 'Как в DSH',
        prefsNote: 'Эти настройки хранятся в этом браузере.',
        statusHeading: 'Сейчас',
        privacy: 'Запросы к arckep.ru выполняет сервер DSH на вашем компьютере. Ключ не показывается в браузере и никуда, кроме arckep.ru, не отправляется.',
      },
      en: {
        name: 'Arckep',
        balance: 'Balance',
        corporate: 'Corporate wallet: {name}',
        corporateNoName: 'Corporate wallet',
        spending: 'Spending',
        today: 'Today',
        days7: '7 days',
        days30: '30 days',
        daysN: '{n} days',
        topModels: 'Top models',
        forecastDays: 'Enough for about {n} days',
        forecastLessDay: 'Less than a day left',
        updated: 'Updated {ago}',
        agoNow: 'just now',
        agoMin: '{n} min ago',
        agoHour: '{n} h ago',
        agoDay: '{n} d ago',
        notUpdated: 'No data yet',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        stale: 'data is out of date',
        loading: 'Loading…',
        noKeyTitle: 'No arckep key set',
        noKeyHint: 'Open Settings → Arckep and paste your API key.',
        usageUnavailable: 'Spending details are not available on arckep.ru yet.',
        usageForbidden: 'This key cannot read spending details{scope}.',
        usageError: 'Could not load spending.',
        usageStale: 'spending may be out of date',
        badgeTitle: 'Arckep: {text}',
        'err.unauthorized': 'arckep.ru rejected the key (401). Check it in settings.',
        'err.forbidden': 'The key lacks the required access{scope}. Create a key with the "balance" scope.',
        'err.payment_required': 'arckep.ru answered 402 (payment required).',
        'err.rate_limited': 'Too many requests (429). Will try again later.',
        'err.server_error': 'arckep.ru is temporarily unavailable (5xx).',
        'err.network': 'Cannot reach arckep.ru.',
        'err.timeout': 'arckep.ru did not answer within 10 seconds.',
        'err.redirect': 'The service answered with a redirect — blocked for safety.',
        'err.bad_response': 'Unexpected response from the service.',
        'err.http_error': 'The service returned an error.',
        'err.not_found': 'API endpoint not found (404).',
        'err.credentials': 'The DSH credential store is unavailable.',
        'err.host': 'Cannot reach DSH.',
        'err.invalid_key': 'That does not look like an API key: expected 8–512 printable characters without spaces.',
        'err.read_only': 'The key comes from an environment variable — change it there.',
        'err.empty': 'Paste a key first.',
        'err.invalid_origin': 'Request blocked: the service address is not allowed.',
        'err.unsupported_media_type': 'DSH rejected the request (wrong content type).',
        'err.payload_too_large': 'The key is too long.',
        'err.bad_json': 'DSH could not read the request.',
        'err.forbidden_origin': 'DSH rejected the request: it did not come from this page.',
        'err.internal': 'Internal plugin error.',
        'err.unknown': 'Unknown error.',
        settingsTitle: 'Arckep: balance and spending',
        settingsLead: 'Shows the balance and spending of an arckep.ru account inside DSH.',
        keyHeading: 'API key',
        keyIsSet: 'Key is set',
        keyNotSet: 'No key set',
        keySourceEnv: 'from the ARCKEP_API_KEY environment variable',
        keySourceStore: 'in the DSH credential store',
        keySourceProjectEnv: 'from the project .env file',
        keySourceUserEnv: 'from the .env file in the DSH home',
        keyPlaceholder: 'Paste your key (ark_live_…)',
        keyInputLabel: 'arckep API key',
        save: 'Save',
        deleteKey: 'Delete key',
        saved: 'Key saved.',
        savedWithError: 'Key saved, but it could not be verified.',
        deleted: 'Key deleted.',
        whereToGet: 'Where to get a key: arckep.ru → Settings → API. It needs the "balance" scope (balance:read).',
        scopeTip: 'Prefer a dedicated key with only that scope: the DSH credential store is readable by the same OS user the agent tools run as.',
        viewHeading: 'Display',
        keyOnly: 'Count spending for this key only',
        interval: 'Polling interval, seconds (at least 60)',
        threshold: 'Warn when the balance drops below, ₽',
        reset: 'Reset',
        language: 'Interface language',
        langAuto: 'Same as DSH',
        prefsNote: 'These settings are stored in this browser.',
        statusHeading: 'Now',
        privacy: 'Requests to arckep.ru are made by the DSH server on your computer. The key is never shown in the browser and is sent nowhere but arckep.ru.',
      },
    }

    /**
     * Pick the interface language from DSH's active locale.
     * ru -> ru, en -> en, another known locale (for example zh) -> en,
     * nothing known -> the browser's first ru/en language, else ru.
     */
    function pickLanguage(active, navigatorLanguages) {
      const tag = typeof active === 'string' ? active.trim().toLowerCase() : ''
      if (tag.startsWith('ru')) return 'ru'
      if (tag.startsWith('en')) return 'en'
      if (tag !== '') return 'en'
      for (const language of Array.isArray(navigatorLanguages) ? navigatorLanguages : []) {
        const lower = String(language).toLowerCase()
        if (lower.startsWith('ru')) return 'ru'
        if (lower.startsWith('en')) return 'en'
      }
      return 'ru'
    }

    function makeTranslator(lang) {
      const table = DICT[lang] ?? DICT.ru
      return (key, params) => {
        const template = table[key] ?? DICT.ru[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? '' : String(params[name])))
      }
    }

    // ------------------------------------------------------------------- money

    /**
     * Format a decimal string such as "1234.5" as "1 234,50 ₽" (ru) or
     * "1,234.50 ₽" (en). The string is never converted to a float; the value
     * is rounded half-up to kopecks with BigInt arithmetic.
     */
    function formatMoney(text, lang) {
      if (typeof text !== 'string') return null
      const match = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(text.trim())
      if (match === null) return null
      const [, sign, whole, fraction = ''] = match
      const padded = fraction.padEnd(3, '0')
      let cents = BigInt(whole) * 100n + BigInt(padded.slice(0, 2))
      if (padded.charCodeAt(2) >= 53) cents += 1n
      const negative = sign === '-' && cents !== 0n
      const wholePart = (cents / 100n).toString()
      const centsPart = (cents % 100n).toString().padStart(2, '0')
      const ru = lang !== 'en'
      const grouped = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ru ? NBSP : ',')
      return `${negative ? '-' : ''}${grouped}${ru ? ',' : '.'}${centsPart}${NBSP}${RUBLE}`
    }

    /** Scale a validated decimal string to an integer with 12 fractional digits. */
    function scaled(text) {
      const negative = text.startsWith('-')
      const body = negative ? text.slice(1) : text
      const [whole, fraction = ''] = body.split('.')
      const value = BigInt(whole + fraction.padEnd(12, '0').slice(0, 12))
      return negative ? -value : value
    }

    function isDecimal(text) {
      return typeof text === 'string' && /^-?\d{1,15}(?:\.\d{1,12})?$/.test(text)
    }

    function formatAgo(ms, t) {
      const minutes = Math.floor(Math.max(0, ms) / 60000)
      if (minutes < 1) return t('agoNow')
      if (minutes < 60) return t('agoMin', { n: minutes })
      if (minutes < 1440) return t('agoHour', { n: Math.floor(minutes / 60) })
      return t('agoDay', { n: Math.floor(minutes / 1440) })
    }

    // ------------------------------------------------------------------- prefs

    function clampInterval(value, fallback) {
      const number = Math.round(Number(value))
      if (!Number.isFinite(number)) return fallback
      return Math.min(Math.max(number, MIN_INTERVAL), MAX_INTERVAL)
    }

    /** Keep only valid user overrides from whatever was stored. */
    function sanitizeOverrides(raw) {
      const out = {}
      if (raw === null || typeof raw !== 'object') return out
      if (raw.intervalSeconds !== undefined && Number.isFinite(Number(raw.intervalSeconds))) {
        out.intervalSeconds = clampInterval(raw.intervalSeconds, BUILTIN_DEFAULTS.intervalSeconds)
      }
      if (raw.warnBelowRub !== undefined && Number.isFinite(Number(raw.warnBelowRub)) && Number(raw.warnBelowRub) >= 0) {
        out.warnBelowRub = Math.min(Number(raw.warnBelowRub), 1e12)
      }
      if (typeof raw.keyOnly === 'boolean') out.keyOnly = raw.keyOnly
      if (raw.lang === 'ru' || raw.lang === 'en') out.lang = raw.lang
      return out
    }

    function readOverrides(storage) {
      try {
        const raw = storage?.getItem(PREFS_KEY)
        return raw ? sanitizeOverrides(JSON.parse(raw)) : {}
      } catch {
        return {}
      }
    }

    function writeOverrides(storage, overrides) {
      try {
        if (Object.keys(overrides).length === 0) storage?.removeItem(PREFS_KEY)
        else storage?.setItem(PREFS_KEY, JSON.stringify(overrides))
      } catch {
        // Storage can be blocked (private window, site data cleared): keep working in memory.
      }
    }

    function serverDefaults(server) {
      const defaults = server?.defaults
      if (defaults === null || typeof defaults !== 'object') return BUILTIN_DEFAULTS
      return {
        intervalSeconds: clampInterval(defaults.refreshSeconds, BUILTIN_DEFAULTS.intervalSeconds),
        warnBelowRub: Number.isFinite(defaults.warnBelowRub) && defaults.warnBelowRub >= 0 ? defaults.warnBelowRub : BUILTIN_DEFAULTS.warnBelowRub,
        keyOnly: defaults.keyOnly === true,
      }
    }

    function effectivePrefs(snapshot) {
      return { ...serverDefaults(snapshot.server), ...snapshot.overrides }
    }

    // -------------------------------------------------------------- controller

    const SOURCE_KEYS = { env: 'keySourceEnv', file: 'keySourceStore', 'project-env': 'keySourceProjectEnv', 'user-env': 'keySourceUserEnv' }
    const KNOWN_STATUSES = new Set(['no_key', 'pending', 'ok', 'error'])

    function isServerState(value) {
      return value !== null && typeof value === 'object' && value.v === 1 && KNOWN_STATUSES.has(value.status)
    }

    /**
     * Observable store + poller. Dependencies are injected so it can run in tests.
     * Nothing here ever holds the API key beyond the single save call.
     */
    function createController(env) {
      const fetchImpl = env.fetchImpl
      const timers = env.timers
      const now = env.now ?? Date.now
      const doc = env.doc
      const storage = env.storage
      const listeners = new Set()
      const abort = new AbortController()
      let timer = null
      let sequence = 0
      let lastPollAt = 0
      let disposed = false
      const initialOverrides = readOverrides(storage)
      const autoLang = env.lang ?? 'ru'
      let snapshot = {
        lang: initialOverrides.lang ?? autoLang,
        autoLang,
        server: null,
        receivedAt: null,
        loading: false,
        hostError: false,
        busy: null,
        notice: null,
        overrides: initialOverrides,
      }

      function set(patch) {
        snapshot = { ...snapshot, ...patch }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[dsh-arckep] listener failed', error)
          }
        }
      }

      async function call(method, route, body, query) {
        let response
        try {
          response = await fetchImpl(query === undefined ? route : `${route}?${query}`, {
            method,
            credentials: 'include',
            cache: 'no-store',
            signal: abort.signal,
            headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
        } catch {
          return { ok: false, status: 0, data: null }
        }
        let data = null
        try {
          data = await response.json()
        } catch {
          data = null
        }
        return { ok: response.ok, status: response.status, data }
      }

      function nextDelaySeconds() {
        const prefs = effectivePrefs(snapshot)
        if (snapshot.hostError) return MIN_INTERVAL
        if (snapshot.server?.status === 'no_key') return Math.max(prefs.intervalSeconds, 300)
        return prefs.intervalSeconds
      }

      function schedule() {
        if (disposed) return
        if (timer !== null) timers.clearTimeout(timer)
        timer = timers.setTimeout(tick, nextDelaySeconds() * 1000)
      }

      function tick() {
        timer = null
        if (disposed) return
        if (doc && doc.visibilityState === 'hidden') {
          schedule()
          return
        }
        void refresh()
      }

      function onVisibility() {
        if (disposed || doc.visibilityState !== 'visible') return
        if (now() - lastPollAt >= effectivePrefs(snapshot).intervalSeconds * 1000) void refresh()
      }

      function acceptState(result, requestedKeyOnly) {
        if (result.ok && isServerState(result.data)) {
          set({ server: result.data, receivedAt: now(), loading: false, hostError: false })
          // The deployment default for keyOnly arrives with the first answer.
          if (effectivePrefs(snapshot).keyOnly !== requestedKeyOnly) queueMicrotask(() => { void refresh() })
          return true
        }
        set({ loading: false, hostError: true })
        return false
      }

      async function refresh(options = {}) {
        if (disposed) return
        const mine = ++sequence
        const prefs = effectivePrefs(snapshot)
        lastPollAt = now()
        set({ loading: true })
        const result = options.force === true
          ? await call('POST', ROUTES.refresh, { keyOnly: prefs.keyOnly })
          : await call('GET', ROUTES.state, undefined, `keyOnly=${prefs.keyOnly ? 1 : 0}&interval=${prefs.intervalSeconds}`)
        if (disposed || mine !== sequence) return
        acceptState(result, prefs.keyOnly)
        schedule()
      }

      async function saveKey(value) {
        const key = typeof value === 'string' ? value.trim() : ''
        if (key === '') {
          set({ notice: { kind: 'error', code: 'empty' } })
          return false
        }
        set({ busy: 'save', notice: null })
        const prefs = effectivePrefs(snapshot)
        const result = await call('POST', ROUTES.keySet, { key, keyOnly: prefs.keyOnly })
        if (disposed) return false
        set({ busy: null })
        if (result.ok && isServerState(result.data)) {
          set({ server: result.data, receivedAt: now(), hostError: false })
          set({ notice: { kind: result.data.status === 'ok' ? 'saved' : 'savedWithError', code: result.data.error?.code ?? null } })
          schedule()
          return true
        }
        const code = typeof result.data?.error === 'string' ? result.data.error : 'host'
        set({ notice: { kind: 'error', code } })
        return false
      }

      async function clearKey() {
        set({ busy: 'delete', notice: null })
        const prefs = effectivePrefs(snapshot)
        const result = await call('POST', ROUTES.keyClear, { keyOnly: prefs.keyOnly })
        if (disposed) return false
        set({ busy: null })
        if (result.ok && isServerState(result.data)) {
          set({ server: result.data, receivedAt: now(), hostError: false, notice: { kind: 'deleted', code: null } })
          schedule()
          return true
        }
        const code = typeof result.data?.error === 'string' ? result.data.error : 'host'
        set({ notice: { kind: 'error', code } })
        return false
      }

      function applyOverrides(overrides) {
        writeOverrides(storage, overrides)
        set({ overrides, lang: overrides.lang ?? snapshot.autoLang })
      }

      function setPrefs(patch) {
        const before = effectivePrefs(snapshot)
        // An invalid value is ignored and the previous override stays; null removes an override.
        const overrides = { ...snapshot.overrides, ...sanitizeOverrides(patch) }
        for (const [name, value] of Object.entries(patch)) {
          if (value === null) delete overrides[name]
        }
        applyOverrides(overrides)
        const after = effectivePrefs(snapshot)
        if (after.keyOnly !== before.keyOnly || after.intervalSeconds !== before.intervalSeconds) void refresh()
      }

      function resetPrefs() {
        const before = effectivePrefs(snapshot)
        applyOverrides({})
        const after = effectivePrefs(snapshot)
        if (after.keyOnly !== before.keyOnly || after.intervalSeconds !== before.intervalSeconds) void refresh()
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        getSnapshot: () => snapshot,
        start() {
          if (doc?.addEventListener) doc.addEventListener('visibilitychange', onVisibility)
          void refresh()
        },
        dispose() {
          disposed = true
          if (timer !== null) timers.clearTimeout(timer)
          timer = null
          if (doc?.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility)
          abort.abort()
          listeners.clear()
        },
        /** The language DSH reports; a language chosen in Settings still wins. */
        setLanguage(lang) {
          if (lang !== snapshot.autoLang) set({ autoLang: lang, lang: snapshot.overrides.lang ?? lang })
        },
        refresh,
        saveKey,
        clearKey,
        setPrefs,
        resetPrefs,
        clearNotice: () => set({ notice: null }),
      }
    }

    // -------------------------------------------------------------------- view

    /** Everything the components need, derived from a controller snapshot. */
    function deriveView(snapshot, nowMs) {
      const t = makeTranslator(snapshot.lang)
      const server = snapshot.server
      const prefs = effectivePrefs(snapshot)
      const balance = server?.balance ?? null
      const usage = server?.usage ?? null
      const usageShown = usage !== null && (usage.state === 'ok' || usage.state === 'stale')
      const forecast = usageShown && typeof usage.forecastDaysLeft === 'number' ? usage.forecastDaysLeft : null
      const errorCode = snapshot.hostError ? 'host' : (server?.error?.code ?? null)
      const hasData = balance !== null && isDecimal(balance.rub)
      const low = hasData && scaled(balance.rub) < scaled(prefs.warnBelowRub.toFixed(2))
      const soon = forecast !== null && forecast < WARN_DAYS
      const stale = hasData && errorCode !== null
      let kind
      if (server === null) kind = snapshot.hostError ? 'error' : 'loading'
      else if (server.status === 'no_key') kind = 'no_key'
      else if (hasData) kind = 'ok'
      else kind = errorCode !== null ? 'error' : 'loading'
      let tone = 'muted'
      if (kind === 'ok') tone = low || soon ? 'warn' : stale ? 'stale' : 'ok'
      else if (kind === 'error') tone = 'error'
      const money = hasData ? formatMoney(balance.rub, snapshot.lang) : null
      const badgeText = money ?? (kind === 'loading' ? '…' : t('name'))
      const ageMs = server?.fetchedAt && snapshot.receivedAt !== null
        ? Math.max(0, (server.now - server.fetchedAt) + (nowMs - snapshot.receivedAt))
        : null
      const view = { lang: snapshot.lang, t, kind, tone, balance, money, usage, usageShown, forecast, errorCode, stale, low, soon, badgeText, title: '', ageMs, prefs, server }
      let text = money
      if (text === null) text = kind === 'no_key' ? t('noKeyTitle') : kind === 'loading' ? t('loading') : (errorText(view) ?? t('err.unknown'))
      view.title = t('badgeTitle', { text }) + (stale ? ` (${t('stale')})` : '')
      return view
    }

    function errorText(view) {
      const { t, server, errorCode } = view
      if (errorCode === null) return null
      const required = server?.error?.required
      const scope = Array.isArray(required) && required.length > 0
        ? ` (${required.join(', ')})`
        : (errorCode === 'forbidden' ? ' (balance:read)' : '')
      const key = `err.${errorCode}`
      return t(DICT.ru[key] === undefined ? 'err.unknown' : key, { scope })
    }

    // -------------------------------------------------------------- components

    function useStore(controller) {
      return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    }

    function Row(props) {
      return h('div', { className: 'dsh-ark-row' },
        h('span', { className: 'dsh-ark-row-label' }, props.label),
        h('span', { className: 'dsh-ark-row-value', title: props.title }, props.value))
    }

    /** The popover content. Pure: everything comes from `view`. */
    function PanelBody(props) {
      const { view, onRefresh, refreshing } = props
      const { t, kind, usage } = view
      const money = value => formatMoney(value, view.lang) ?? '\u2014'
      const children = []

      if (kind === 'ok') {
        children.push(h('div', { key: 'balance', className: 'dsh-ark-head' },
          h('span', { className: 'dsh-ark-muted' }, t('balance')),
          h('span', { className: 'dsh-ark-amount', 'data-tone': view.tone }, view.money)))
        if (view.balance.corporate) {
          children.push(h('div', { key: 'corp', className: 'dsh-ark-note' },
            view.balance.corporateName ? t('corporate', { name: view.balance.corporateName }) : t('corporateNoName')))
        }
      } else if (kind === 'no_key') {
        children.push(h('div', { key: 'nokey', className: 'dsh-ark-message' },
          h('strong', null, t('noKeyTitle')), h('div', null, t('noKeyHint'))))
      } else if (kind === 'loading') {
        children.push(h('div', { key: 'loading', className: 'dsh-ark-note' }, t('loading')))
      }

      const error = errorText(view)
      if (error !== null) {
        children.push(h('div', { key: 'error', className: 'dsh-ark-message', 'data-tone': 'warn', role: 'status' },
          error, view.stale ? h('div', { className: 'dsh-ark-muted' }, t('stale')) : null))
      }

      if (kind === 'ok' && usage !== null) {
        if (view.usageShown) {
          const totals = usage.totals ?? {}
          const period = Number.isInteger(usage.periodDays) && usage.periodDays !== 30 ? t('daysN', { n: usage.periodDays }) : t('days30')
          children.push(h('div', { key: 'usage', className: 'dsh-ark-section' },
            h('div', { className: 'dsh-ark-title' }, t('spending'),
              usage.state === 'stale' ? h('span', { className: 'dsh-ark-muted' }, ` · ${t('usageStale')}`) : null),
            h(Row, { label: t('today'), value: money(totals.todayRub) }),
            h(Row, { label: t('days7'), value: money(totals.last7dRub) }),
            h(Row, { label: period, value: money(totals.periodRub) })))
          const models = Array.isArray(usage.byModel) ? usage.byModel.slice(0, 5) : []
          if (models.length > 0) {
            children.push(h('div', { key: 'models', className: 'dsh-ark-section' },
              h('div', { className: 'dsh-ark-title' }, t('topModels')),
              ...models.map((model, index) => h(Row, { key: `${index}:${model.model}`, label: model.model, title: model.model, value: money(model.costRub) }))))
          }
          if (view.forecast !== null) {
            children.push(h('div', { key: 'forecast', className: 'dsh-ark-note', 'data-tone': view.soon ? 'warn' : undefined },
              view.forecast < 1 ? t('forecastLessDay') : t('forecastDays', { n: Math.floor(view.forecast) })))
          }
        } else if (usage.state === 'unavailable') {
          children.push(h('div', { key: 'usage', className: 'dsh-ark-note' }, t('usageUnavailable')))
        } else if (usage.state === 'forbidden') {
          const scope = Array.isArray(usage.required) && usage.required.length > 0 ? ` (${usage.required.join(', ')})` : ''
          children.push(h('div', { key: 'usage', className: 'dsh-ark-note' }, t('usageForbidden', { scope })))
        } else if (usage.state === 'error') {
          children.push(h('div', { key: 'usage', className: 'dsh-ark-note' }, t('usageError')))
        }
      }

      children.push(h('div', { key: 'foot', className: 'dsh-ark-foot' },
        h('span', { className: 'dsh-ark-muted' },
          view.ageMs === null ? t('notUpdated') : t('updated', { ago: formatAgo(view.ageMs, t) })),
        h('button', { type: 'button', className: 'dsh-ark-button', disabled: refreshing, 'aria-busy': refreshing, onClick: onRefresh },
          refreshing ? t('refreshing') : t('refresh'))))

      return h('div', { className: 'dsh-ark-body' }, ...children)
    }

    function Popover(props) {
      const { anchorRef, onClose, label, children } = props
      const [position, setPosition] = useState(null)
      const panelRef = useRef(null)

      useLayoutEffect(() => {
        const place = () => {
          const rect = anchorRef.current?.getBoundingClientRect()
          if (!rect) return
          setPosition({ top: Math.round(rect.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - rect.right)) })
        }
        place()
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [anchorRef])

      useEffect(() => {
        const onDown = (event) => {
          if (panelRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return
          onClose()
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          onClose()
          anchorRef.current?.focus()
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [anchorRef, onClose])

      if (position === null) return null
      return createPortal(
        h('div', { ref: panelRef, className: 'dsh-ark-panel', role: 'dialog', 'aria-label': label, style: { top: position.top, right: position.right } }, children),
        document.body)
    }

    function useTicker(active, ms) {
      const [, setTick] = useState(0)
      useEffect(() => {
        if (!active) return undefined
        const id = setInterval(() => setTick(value => value + 1), ms)
        return () => clearInterval(id)
      }, [active, ms])
    }

    function createBadge(controller) {
      return function ArckepBadge() {
        const snapshot = useStore(controller)
        const [open, setOpen] = useState(false)
        const buttonRef = useRef(null)
        useTicker(open, 30000)
        const view = deriveView(snapshot, Date.now())
        const onClose = React.useCallback(() => setOpen(false), [])
        const toggle = () => {
          if (!open) void controller.refresh()
          setOpen(value => !value)
        }
        return h('span', { className: 'dsh-ark-root' },
          h('button', {
            type: 'button',
            ref: buttonRef,
            className: 'dsh-ark-badge',
            'data-tone': view.tone,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: view.title,
            onClick: toggle,
          }, view.badgeText),
          open
            ? h(Popover, { anchorRef: buttonRef, onClose, label: view.t('name') },
              h(PanelBody, { view, refreshing: snapshot.loading, onRefresh: () => { void controller.refresh({ force: true }) } }))
            : null)
      }
    }

    function noticeText(notice, t) {
      if (notice === null) return null
      if (notice.kind === 'saved') return t('saved')
      if (notice.kind === 'deleted') return t('deleted')
      if (notice.kind === 'savedWithError') {
        const detail = notice.code ? `err.${notice.code}` : null
        return detail && DICT.ru[detail] ? `${t('savedWithError')} ${t(detail, { scope: '' })}` : t('savedWithError')
      }
      const key = `err.${notice.code}`
      return t(DICT.ru[key] === undefined ? 'err.unknown' : key, { scope: '' })
    }

    function createSettings(controller) {
      return function ArckepSettings() {
        const snapshot = useStore(controller)
        useTicker(true, 30000)
        const view = deriveView(snapshot, Date.now())
        const { t, prefs } = view
        const [keyText, setKeyText] = useState('')
        const [intervalText, setIntervalText] = useState(String(prefs.intervalSeconds))
        const [thresholdText, setThresholdText] = useState(String(prefs.warnBelowRub))
        useEffect(() => { setIntervalText(String(prefs.intervalSeconds)) }, [prefs.intervalSeconds])
        useEffect(() => { setThresholdText(String(prefs.warnBelowRub)) }, [prefs.warnBelowRub])

        const keyInfo = snapshot.server?.key ?? null
        const configured = keyInfo?.configured === true
        const writable = keyInfo?.writable !== false
        const source = keyInfo?.source ?? null
        const sourceText = configured ? t(SOURCE_KEYS[source] ?? 'keySourceStore') : null
        const busy = snapshot.busy

        const onSave = async (event) => {
          event.preventDefault()
          const ok = await controller.saveKey(keyText)
          if (ok) setKeyText('')
        }
        const commitInterval = () => {
          const value = Math.round(Number(intervalText))
          if (!Number.isFinite(value)) { setIntervalText(String(prefs.intervalSeconds)); return }
          controller.setPrefs({ intervalSeconds: Math.min(Math.max(value, MIN_INTERVAL), MAX_INTERVAL) })
        }
        const commitThreshold = () => {
          const value = Number(thresholdText)
          if (!Number.isFinite(value) || value < 0) { setThresholdText(String(prefs.warnBelowRub)); return }
          controller.setPrefs({ warnBelowRub: value })
        }
        const onEnter = commit => (event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }
        const notice = noticeText(snapshot.notice, t)
        const error = errorText(view)

        return h('div', { className: 'dsh-ark-settings' },
          h('h2', { className: 'dsh-ark-h2' }, t('settingsTitle')),
          h('p', { className: 'dsh-ark-lead' }, t('settingsLead')),

          h('section', { className: 'dsh-ark-card', 'aria-label': t('keyHeading') },
            h('h3', { className: 'dsh-ark-h3' }, t('keyHeading')),
            h('div', { className: 'dsh-ark-status' },
              h('span', { className: 'dsh-ark-dot', 'data-on': configured ? '' : undefined }),
              h('span', null, configured ? `${t('keyIsSet')} — ${sourceText}` : t('keyNotSet'))),
            writable
              ? h('form', { className: 'dsh-ark-form', onSubmit: onSave, autoComplete: 'off' },
                h('input', {
                  type: 'password',
                  name: 'dsh-arckep-key',
                  className: 'dsh-ark-input',
                  value: keyText,
                  placeholder: t('keyPlaceholder'),
                  'aria-label': t('keyInputLabel'),
                  autoComplete: 'new-password',
                  spellCheck: false,
                  'data-lpignore': 'true',
                  'data-1p-ignore': 'true',
                  onChange: event => setKeyText(event.target.value),
                }),
                h('button', { type: 'submit', className: 'dsh-ark-button dsh-ark-button-primary', disabled: busy !== null || keyText.trim() === '' }, t('save')),
                configured
                  ? h('button', { type: 'button', className: 'dsh-ark-button', disabled: busy !== null, onClick: () => { void controller.clearKey() } }, t('deleteKey'))
                  : null)
              : h('p', { className: 'dsh-ark-hint' }, t('err.read_only')),
            notice !== null
              ? h('p', { className: 'dsh-ark-notice', 'data-tone': snapshot.notice.kind === 'error' ? 'error' : snapshot.notice.kind === 'savedWithError' ? 'warn' : 'ok', role: 'status' }, notice)
              : null,
            h('p', { className: 'dsh-ark-hint' }, t('whereToGet')),
            h('p', { className: 'dsh-ark-hint' }, t('scopeTip'))),

          h('section', { className: 'dsh-ark-card', 'aria-label': t('viewHeading') },
            h('h3', { className: 'dsh-ark-h3' }, t('viewHeading')),
            h('div', { className: 'dsh-ark-rows' },
              h('label', { className: 'dsh-ark-field' },
                h('span', null, t('language')),
                h('select', {
                  className: 'dsh-ark-input dsh-ark-input-short', value: snapshot.overrides.lang ?? 'auto',
                  onChange: event => controller.setPrefs({ lang: event.target.value === 'auto' ? null : event.target.value }),
                },
                h('option', { value: 'auto' }, t('langAuto')),
                h('option', { value: 'ru' }, 'Русский'),
                h('option', { value: 'en' }, 'English'))),
              h('label', { className: 'dsh-ark-check' },
                h('input', { type: 'checkbox', checked: prefs.keyOnly, onChange: event => controller.setPrefs({ keyOnly: event.target.checked }) }),
                h('span', null, t('keyOnly'))),
              h('label', { className: 'dsh-ark-field' },
                h('span', null, t('interval')),
                h('input', {
                  type: 'number', className: 'dsh-ark-input dsh-ark-input-short', min: MIN_INTERVAL, max: MAX_INTERVAL, step: 1,
                  value: intervalText, onChange: event => setIntervalText(event.target.value), onBlur: commitInterval, onKeyDown: onEnter(commitInterval),
                })),
              h('label', { className: 'dsh-ark-field' },
                h('span', null, t('threshold')),
                h('input', {
                  type: 'number', className: 'dsh-ark-input dsh-ark-input-short', min: 0, step: 10,
                  value: thresholdText, onChange: event => setThresholdText(event.target.value), onBlur: commitThreshold, onKeyDown: onEnter(commitThreshold),
                }))),
            h('div', { className: 'dsh-ark-actions' },
              h('button', { type: 'button', className: 'dsh-ark-button', onClick: () => controller.resetPrefs() }, t('reset')),
              h('span', { className: 'dsh-ark-hint' }, t('prefsNote')))),

          h('section', { className: 'dsh-ark-card', 'aria-label': t('statusHeading') },
            h('h3', { className: 'dsh-ark-h3' }, t('statusHeading')),
            view.kind === 'ok'
              ? h(Row, { label: t('balance'), value: view.money })
              : h('p', { className: 'dsh-ark-hint' }, view.kind === 'no_key' ? t('noKeyHint') : view.kind === 'loading' ? t('loading') : (error ?? t('err.unknown'))),
            view.kind === 'ok' && error !== null ? h('p', { className: 'dsh-ark-notice', 'data-tone': 'warn' }, `${error} ${t('stale')}`) : null,
            h('div', { className: 'dsh-ark-actions' },
              h('button', { type: 'button', className: 'dsh-ark-button', disabled: snapshot.loading, onClick: () => { void controller.refresh({ force: true }) } }, snapshot.loading ? t('refreshing') : t('refresh')),
              h('span', { className: 'dsh-ark-hint' }, view.ageMs === null ? t('notUpdated') : t('updated', { ago: formatAgo(view.ageMs, t) })))),

          h('p', { className: 'dsh-ark-hint' }, t('privacy')))
      }
    }

    // ------------------------------------------------------------------ styles

    const CSS = `
.dsh-ark-root{display:inline-flex;align-items:center}
.dsh-ark-badge{display:inline-flex;align-items:center;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:24px;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer}
.dsh-ark-badge:hover,.dsh-ark-badge[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ark-badge:focus-visible,.dsh-ark-button:focus-visible,.dsh-ark-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ark-badge[data-tone=muted]{color:var(--dsw-alias-label-tertiary)}
.dsh-ark-badge[data-tone=stale]{color:var(--dsw-alias-label-tertiary);font-style:italic}
.dsh-ark-badge[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dsh-ark-badge[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ark-panel{position:fixed;z-index:2000;box-sizing:border-box;width:min(320px,calc(100vw - 16px));max-height:min(520px,calc(100vh - 64px));overflow:auto;padding:12px 14px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font-size:12px;line-height:18px}
.dsh-ark-body{display:flex;flex-direction:column;gap:10px}
.dsh-ark-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dsh-ark-amount{font-size:20px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-ark-amount[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dsh-ark-muted{color:var(--dsw-alias-label-tertiary)}
.dsh-ark-note{color:var(--dsw-alias-label-secondary)}
.dsh-ark-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dsh-ark-message{padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-ark-message[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dsh-ark-section{display:flex;flex-direction:column;gap:2px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsh-ark-title{color:var(--dsw-alias-label-tertiary);margin-bottom:2px}
.dsh-ark-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-width:0}
.dsh-ark-row-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dsh-ark-row-value{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-ark-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsh-ark-button{height:28px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ark-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ark-button:disabled{opacity:.5;cursor:default}
.dsh-ark-button-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.dsh-ark-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-ark-settings{display:flex;flex-direction:column;gap:14px;max-width:640px;padding:4px 2px 24px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-ark-h2{margin:0;font-size:16px;line-height:24px;font-weight:600}
.dsh-ark-h3{margin:0 0 8px;font-size:13px;line-height:20px;font-weight:600}
.dsh-ark-lead{margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-ark-card{padding:14px 16px;border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:12px;background:var(--dsw-alias-settings-card-fill)}
.dsh-ark-status{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.dsh-ark-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dsh-ark-dot[data-on]{background:var(--dsw-alias-state-success-primary)}
.dsh-ark-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-ark-input{box-sizing:border-box;height:30px;min-width:0;flex:1 1 220px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsh-ark-input-short{flex:0 0 110px;text-align:right}
.dsh-ark-field select.dsh-ark-input{text-align:left;flex-basis:140px}
.dsh-ark-rows{display:flex;flex-direction:column;gap:8px}
.dsh-ark-field{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-ark-check{display:flex;align-items:center;gap:8px}
.dsh-ark-actions{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
.dsh-ark-hint{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-ark-notice{margin:8px 0 0;font-size:12px;line-height:18px}
.dsh-ark-notice[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
.dsh-ark-notice[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dsh-ark-notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:no-preference){.dsh-ark-badge,.dsh-ark-button{transition:background-color .12s ease,color .12s ease}}
`

    function installStyles(doc) {
      const style = doc.createElement('style')
      style.setAttribute('data-plugin', 'dsh-arckep')
      style.textContent = CSS
      doc.head.appendChild(style)
      return () => { style.remove() }
    }

    // ------------------------------------------------------------------- entry

    exports.inject = ['slots', 'locale']

    /** Client plugin entry. All side effects are registered with ctx.effect. */
    exports.apply = function apply(ctx) {
      const languageNow = () => pickLanguage(ctx.locale?.getSnapshot?.().active, globalThis.navigator?.languages)
      const storage = (() => { try { return globalThis.localStorage } catch { return undefined } })()
      const controller = createController({
        fetchImpl: (...args) => globalThis.fetch(...args),
        timers: { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id) },
        doc: globalThis.document,
        storage,
        lang: languageNow(),
      })

      ctx.effect(() => installStyles(document), 'dsh-arckep: styles')
      ctx.effect(() => {
        const stop = ctx.locale?.subscribe?.(() => controller.setLanguage(languageNow()))
        return () => { if (typeof stop === 'function') stop() }
      }, 'dsh-arckep: locale')
      ctx.effect(() => {
        controller.start()
        return () => controller.dispose()
      }, 'dsh-arckep: poller')

      const Badge = createBadge(controller)
      const Settings = createSettings(controller)
      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'arckep', order: 15 }, Badge)), 'dsh-arckep: header badge')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'arckep', order: 95, label: () => 'Arckep' }, Settings)), 'dsh-arckep: settings page')
    }

    // Exposed for the unit tests; DSH ignores unknown exports.
    exports.__test = {
      DICT, ROUTES, pickLanguage, makeTranslator, formatMoney, formatAgo, deriveView, errorText,
      sanitizeOverrides, createController, createBadge, createSettings, PanelBody, installStyles,
    }

    return exports
  },
})
