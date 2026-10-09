# Security policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub Security Advisories:

1. open the [Security tab](https://github.com/gmen1057/dsh-arckep/security) of this repository;
2. choose **Report a vulnerability** and describe the problem.

Please do not open a public issue for a vulnerability and do not post API keys
anywhere. If you think a key may have leaked, revoke it in arckep.ru
(Settings → API) first.

This is a one-person hobby project: I will read every report and answer as soon as
I can, but I cannot promise a fixed response time.

## What is in scope

- anything that makes the plugin send the API key to a host other than `arckep.ru`,
  show it in the browser, write it to a log or to a file other than DSH's credential
  store;
- anything that lets a web page or another local user reach the plugin's routes
  without DSH's own authentication;
- requests to hosts other than `https://arckep.ru`, or following of redirects;
- crashes or hangs of DSH caused by the plugin.

## What is out of scope

- the arckep.ru service itself (report problems with it to its operator);
- DSH itself (report to the [DSH project](https://github.com/deepseek-ai/deepseek-harness));
- the fact that DSH's credential store is readable by the OS user DSH runs as, and
  therefore by the agent's tools: this is a documented property of DSH. Use a
  dedicated key that only has the `balance:read` scope.

## Supported versions

Only the latest release receives fixes.
