# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
