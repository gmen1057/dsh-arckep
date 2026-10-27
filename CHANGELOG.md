# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.4] - 2026-10-27

### Changed

- Automatic failover to the direct endpoint (`https://media.arckep.ru`, and `https://api.arckep.ru` when configured) when the primary front (`https://arckep.ru`) fails with a connection error or timeout, keeping the fallback active for 5 minutes so follow-up requests do not wait on an unreachable front.

## [0.1.3] - 2026-10-20

### Changed

- Transient network drops (`fetch` socket errors before an HTTP status is received) are retried
  once after 1.5 s before reporting a connection failure.
- Documentation: removed the claim that a new release needs a day before it installs from npm.
  Checked on a clean profile: pnpm adds a package installed directly to its release-age
  exclusion list itself, so `dsh-arckep@0.1.2` installed at once. The Troubleshooting row now
  only describes the case where other, too new packages are in the profile.

## [0.1.2] - 2026-10-10

### Added

- The package is published on npm: `dsh plugin --profile web add dsh-arckep`.

### Changed

- Documentation: npm is now the main install command (the desktop steps use it too), GitHub
  stays as the alternative for pinning a commit or tag. The `minimumReleaseAge` row in
  Troubleshooting also covers the first 24 hours of a new release.
- No code changes: the plugin itself is identical to 0.1.1.

## [0.1.1] - 2026-10-10

### Added

- A second balance badge at the foot of the DSH sidebar (slot `sidebar.footer.action`), above
  Settings, so the balance is visible on the empty start screen without opening a session.
  It shows the ruble icon and the amount, follows the same warning rules (threshold and forecast
  under 3 days) and opens the same panel. In the collapsed 56 px rail it shows the icon only,
  with the amount in the tooltip and the accessible name.
- Setting "Show the balance in the sidebar" in Settings → Arckep (on by default, stored in the
  browser). The header badge is not affected by it.

### Changed

- Both badges share one state: only one panel is open at a time, a refresh in one place shows in
  the other at once, and the second badge makes no additional requests.
- The panel opens above the sidebar badge (left-aligned, kept inside the window, scrolling
  when there is little room) and below the header badge as before.
- Tests: interaction tests in a real DOM (jsdom, a development dependency only; nothing new is
  shipped or installed for users).

### Verified

- DSH 0.2.0-rc.2 and 0.2.1-alpha.2 with `dsh web`: the sidebar badge on the empty start screen
  and next to the header badge in a session; light and dark themes; Russian and English; a
  420 px window and the collapsed rail; no key, normal, warning, stale, 401 and 403 states;
  switching the sidebar badge off removes it and leaves no gap above Settings.
- Not verified: the desktop app.

## [0.1.0] - 2026-10-09

First public version.

### Added

- Balance badge in the DSH session header (`1 234,50 ₽`), with a warning tone when
  the balance is below a threshold (default 100 ₽) or the forecast is under 3 days.
- Panel with balance, a corporate-wallet note, spending for today / 7 days / 30 days,
  the top 5 models by cost, the forecast ("enough for about N days"), the age of the
  data and a refresh button.
- "Arckep" page in DSH Settings: API key (stored in DSH's credential store, never
  shown again), delete button, "this key only" switch, polling interval (minimum
  60 s) and warning threshold.
- Russian and English interface, following the DSH language.
- Server-side requests only, to `https://arckep.ru` and nowhere else: no redirects,
  10-second timeout, one request at a time, exponential back-off, last good answer
  kept and marked as out of date during failures.
- Works without the spending endpoint: when `/api/v1/usage` answers 404 the balance is
  still shown and the spending block is hidden.
- Key can also come from the `ARCKEP_API_KEY` environment variable.
- Interface language can be switched between "same as DSH", Russian and English in
  Settings → Arckep (DSH itself ships English and Chinese only).

### Verified

- DSH 0.2.0-rc.2 and 0.2.1-alpha.2 with `dsh web`: install from a tarball, load, badge,
  panel, settings page, key storage. On 0.2.0-rc.2 also: install from a local path and from a
  git URL, switching the plugin off and on again without a restart.
- Not verified: the desktop app, Node.js 22 locally (CI runs 22 and 24), use behind a proxy.
