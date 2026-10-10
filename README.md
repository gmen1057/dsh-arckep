# dsh-arckep

English | [Русский](README.ru.md)

Shows the **balance and spending of your [arckep.ru](https://arckep.ru) account** right inside the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI: a small badge
with the balance in the session header and at the foot of the sidebar, a panel with the details,
and a settings page for the API key.

> **Unofficial.** This is a community plugin. It is not made by, endorsed by or affiliated with
> DeepSeek. arckep.ru is the third-party service the plugin connects to; you need your own
> arckep.ru account and API key.

## What you get

- **Badge** in the header of an open session: the balance as `1 234,50 ₽`. It turns to a
  warning colour when the balance is below your threshold (default 100 ₽) or when the forecast
  says the money lasts less than 3 days. Click it to open the panel.
- **Sidebar badge**: the same balance (icon and amount) at the foot of the sidebar, above
  Settings, so it is visible on the empty start screen too, with the same warning rules. Click it
  to open the same panel. You can switch it off in Settings → Arckep.
- **Panel**: balance (with a note for a corporate wallet), spending for today / 7 days / 30 days,
  the top 5 models by cost, "enough for about N days", "updated N min ago" and a refresh button.
- **Settings → Arckep**: the API key field (it is cleared after saving and only shows that a key
  is set), *Save* / *Delete key*, "count spending for this key only", the polling interval
  (default 300 s, minimum 60 s), the warning threshold, "show the balance in the sidebar" and the
  interface language.
- Russian and English interface, following the DSH language (Russian when it cannot be
  determined, English for other DSH languages). DSH itself ships English and Chinese, so a
  Russian reader can switch the plugin to Russian in Settings → Arckep. Colours come from the DSH
  theme, so light and dark themes work.
- If arckep.ru is unreachable, the last good numbers stay on screen and are marked
  "data is out of date".

The header badge exists only while a session is open. The sidebar badge does not depend on a
session. When the sidebar is collapsed to its narrow rail it shows only the ruble icon (hover or
focus it for the amount), so nothing wraps or is cut off. Both badges share one state and one
panel: only one panel is open at a time, a refresh in one place shows in the other at once, and
the second badge makes no extra requests.

## Requirements

- DSH **0.2.0-rc.2** or newer with the web UI (`dsh web`). DSH is a developer preview and its plugin
  APIs are still changing, see [Compatibility](#compatibility). DSH itself needs Node.js 22.19+
  (or 24+); the plugin has no other requirement.
- A DSH profile that includes the web app (the shipped `web` profile does).
- An arckep.ru API key with the **`balance:read`** scope.

## Install

```sh
dsh plugin --profile web add dsh-arckep
dsh web
```

(`web` is the profile name; use your own profile if you have one.) There is no build step and
no install script, so nothing else needs to be allowed or built. The package is on npm from
version 0.1.2. pnpm 11, which DSH uses to install plugins, skips packages published less than 24
hours ago, so a brand-new release may need a day before it can be installed from npm (see
Troubleshooting).

To install straight from GitHub instead, or to pin an exact commit or tag:

```sh
dsh plugin --profile web add github:gmen1057/dsh-arckep
dsh plugin --profile web add github:gmen1057/dsh-arckep#<commit-or-tag>
```

Check that the layer is active with `dsh --profile web --dump-config` (look for the
`# == dsh-arckep` block). Remove the plugin with `dsh plugin --profile web remove dsh-arckep`.

### Desktop app

DSH Desktop owns its own profile, `desktop`. As the DSH docs describe: launch the app once,
**quit it completely**, run `dsh plugin --profile desktop add dsh-arckep` (with the
`dsh` command that ships with the app), then reopen the app. For the `desktop` profile
`dsh --profile desktop --dump-config` is refused ("managed exclusively by the Electron
application"), so the only check is the badge at the foot of the sidebar (or in the header of an open session). The author has not
tested the plugin in the desktop app.

## Set the key

1. On arckep.ru open **Settings → API** and create a key. It needs access to the **balance**
   (`balance:read`). New keys have it by default; a dedicated key with only this scope is the safest
   choice.
2. In DSH open **Settings → Arckep**, paste the key and press **Save**. The field is cleared and
   the page says "Key is set".

Alternatively export `ARCKEP_API_KEY` before starting DSH. DSH's rule applies: an environment
variable wins over a stored key, and the settings page then shows the key as read-only.

## Settings

| Setting | Default | Where it is stored |
|---|---|---|
| API key | none | DSH credential store (`ARCKEP_API_KEY`), see Privacy |
| Show the balance in the sidebar | on | this browser |
| Count spending for this key only | off | this browser |
| Polling interval | 300 s (minimum 60 s) | this browser |
| Warn when the balance is below | 100 ₽ | this browser |
| Interface language | same as DSH | this browser |

The three display settings above the language can also get deployment-wide defaults by overriding the `arckep` row in your
profile's `cordis.patch.yml` (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: arckep
  config:
    refreshSeconds: 600
    warnBelowRub: 300
    keyOnly: false
```

Anything the user changes in Settings → Arckep overrides these defaults in that browser.

## How it behaves

- The DSH **server** calls arckep.ru, never the browser. The browser only talks to DSH.
- Requests are made only while a DSH page is open and visible, and only when the cached answer is
  older than the polling interval. There are no background timers on the server.
- One request at a time, 10 s timeout, no redirects followed. After errors the next automatic
  attempt is delayed 30 s, 60 s, 120 s ... up to 30 minutes (and by `Retry-After` for HTTP 429).
- 401 (wrong key) and 403 (missing scope) are not retried automatically; press *Refresh* after you
  fix the key.
- Spending details come from `GET /api/v1/usage`. If the arckep.ru server does not provide that
  endpoint yet (HTTP 404), the plugin keeps showing the balance and hides the spending block
  without any error. It probes again from time to time.

## Privacy and security

- The plugin talks to **`https://arckep.ru` only**: `GET /api/v1/balance` and
  `GET /api/v1/usage?days=30&key_only=...`. The host and the https scheme are checked in code; a
  redirect (any 3xx answer) is treated as an error and never followed.
- **No telemetry, no analytics, no third-party requests.** The plugin writes no files of its own;
  the only thing persisted by DSH is the key, in its credential store. The display settings
  live in your browser's `localStorage`.
- The key is sent in the `Authorization: Bearer` header to arckep.ru and nowhere else. It is
  never put in `cordis.patch.yml`, in the URL, in logs, in error messages, or in anything sent to
  the browser; the browser only learns whether a key is set and where it comes from.
- The plugin's four routes live on DSH's own authenticated `/api` channel, so they are protected
  by DSH's Host/Origin checks and its browser-session cookie. State-changing requests additionally
  require a JSON content type and a same-origin request.
- **Know where the key is stored.** DSH's local credential store is a file in `$DSH_HOME`
  (`~/.dsh/.credentials.yaml`, mode 600). Tools that DSH's agent runs execute as the same OS user,
  so they can read it. That is a property of DSH, not of this plugin. Limit the damage: create a
  key that only has `balance:read`, and revoke it on arckep.ru if you suspect it leaked.
- The standard proxy variables that DSH honours (see DSH's network-proxy guide) apply, because the
  plugin uses the host's regular `fetch`. I have not tested a proxied setup.

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Troubleshooting

| You see | Meaning |
|---|---|
| "arckep.ru rejected the key (401)" | wrong or revoked key; paste a new one |
| "The key lacks the required access (balance:read)" | create a key with the *balance* scope |
| "Cannot reach arckep.ru" / "did not answer within 10 seconds" | network problem; the last numbers stay, marked out of date |
| "Spending details are not available on arckep.ru yet" | the server has no `/usage` endpoint (yet); the balance still works |
| no badge at all | look at the foot of the sidebar, above Settings (the header badge needs an open session). If there is an Arckep page in Settings, check that "Show the balance in the sidebar" is on; if there is no such page, the plugin is not loaded: look for the `# == dsh-arckep` block in `dsh --profile web --dump-config` |
| "The key comes from an environment variable" | unset `ARCKEP_API_KEY` to manage the key in Settings |
| install fails and DSH prints "git-hosted plugins build on install via their prepare script…" | that hint is printed for **any** failed install from a `github:` address. dsh-arckep has no install or prepare script, so `allowBuilds` is not needed; read the real pnpm error printed above the hint |
| install fails with a `minimumReleaseAge` error | pnpm 11 refuses packages published less than 24 hours ago by default and checks every package in the profile's lockfile, not only the new one. If the message names other plugins, they are the cause; if it names dsh-arckep itself, the release is less than a day old. Retry later, or install the same version from GitHub (`github:gmen1057/dsh-arckep#v0.1.2`) |

## Compatibility

DSH is a **developer preview**; its plugin interfaces can change between releases, and this
plugin depends on the web client's slots (`conversation.session.header.utilities`,
`sidebar.footer.action`, `settings.section`) and on `ctx.connection.fetch` and `ctx.credentials`
of the Host.

| DSH version | Status |
|---|---|
| 0.2.0-rc.2 (`latest`) | tested: installs (from a local path, a tarball and a git URL), loads, header and sidebar badges, panel, settings, key storage, live disable/enable |
| 0.2.1-alpha.2 (`alpha`) | tested: installs from a tarball, loads, header and sidebar badges, panel, settings, key storage |

Only the web UI (`dsh web`) was exercised. The TUI has no web client and is not supported; the
author has not tested the desktop app (install steps for it are above).

## Development

```sh
npm ci
npm run check      # syntax + manifest checks
npm test           # node --test, no network
node scripts/mock-arckep.mjs 39100                      # a local stand-in for the API
DSH_ARCKEP_TEST_ORIGIN=http://127.0.0.1:39100 dsh web   # point DSH at the mock
```

`DSH_ARCKEP_TEST_ORIGIN` exists for development only. It is accepted only when it names a
loopback address over plain http with a port of 1024 or more (for example
`http://127.0.0.1:39100`); any other value is ignored and logged. It cannot be set through the
plugin configuration, so a profile file cannot redirect the key. Do not set it in a real setup.

The client half (`lib/client.js`) is a single hand-written file in DSH's lazy-CommonJS client
module format, so the repository needs no build step to be installed from GitHub.

## Acknowledgements

The public plugins [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) and
[dsh-web-billing](https://github.com/bpc-oss/dsh-web-billing) were a helpful reference for how a DSH
web plugin is wired (slots, the credential store, the client module format). No code was copied
from them.

## License

[MIT](LICENSE) © 2026 gmen1057
