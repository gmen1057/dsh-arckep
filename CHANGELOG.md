# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
