# @bawabajs/core

The core of [Bawaba](../../README.md), shared by every Bawaba gateway client: the request pipeline with its retry rules, typed errors, money and currency helpers, Web Crypto signing, idempotency, capability levels, webhook input helpers and redaction.

> **Unofficial.** Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.

**Status: pre-alpha.** The core is implemented and fully tested, but no gateway client is built on it yet, so there's nothing to use it with.

## Entry points

| Entry | Purpose |
|---|---|
| `@bawabajs/core` | Shared runtime code (zero dependencies, no Node built-ins) |
| `@bawabajs/core/conformance` | `await runConformanceSuite(subject)`, the Vitest suite every gateway client must pass, and the check functions behind it; needs `vitest` (optional peer dependency) |

## Licence

MIT
