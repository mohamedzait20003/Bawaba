# Bawaba

**Bawaba** (بوابة, "gateway") is an open-source TypeScript SDK for accepting payments in Egypt and the Gulf, through **Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services (formerly PayFort) and Tap Payments**.

> **Unofficial.** Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.

**Status: pre-alpha, not usable.** The repository is scaffolded; the clients are being written. Follow the [roadmap](docs/roadmap/ROADMAP.md).

## Why Bawaba

- **Seven gateways, one SDK:** a full native client for each gateway, using its own field names, plus one facade (`bawaba`) for payments, refunds and verified webhooks across all of them.
- **Safe with money:** money-moving calls are never retried, and a timeout or 5xx on a refund is an `OutcomeUnknownError`, never "retryable". Idempotency keys are built in.
- **Safe with callbacks:** webhooks are verified over the raw body before anything else, fail closed, and separate signed fields from untrusted ones.
- **Honest:** anything not yet proven against a real sandbox ships as `beta` and is off by default. The [validation log](docs/validation-log.md) shows what is proven.
- **Light:** zero runtime dependencies and Web Crypto only, so it runs on Node 22.12+, Bun, Deno, Cloudflare Workers and Vercel Edge. ESM and CommonJS.

## Packages

| Package | Purpose |
|---|---|
| `bawaba` | The unified facade, with one subpath per gateway (`bawaba/paymob` … `bawaba/tap`) |
| `@bawaba/core` | Request pipeline, errors, money, crypto, idempotency |
| `@bawaba/paymob` | Paymob client (Egypt, KSA, UAE, Oman) |
| `@bawaba/kashier` | Kashier client (Egypt) |
| `@bawaba/fawry` | Fawry client (Egypt), including PayAtFawry reference codes |
| `@bawaba/geidea` | Geidea client (Egypt, KSA, UAE) |
| `@bawaba/paytabs` | PayTabs PT2 client (KSA, UAE, Egypt and other regions) |
| `@bawaba/payfort` | Amazon Payment Services (formerly PayFort) client |
| `@bawaba/tap` | Tap Payments client (Gulf and Egypt) |
| `@bawaba/testing` | Fixtures and test signers for your own tests |

## Documentation

- [Product requirements](docs/requirements/PRODUCT_REQUIREMENTS.md)
- [Product specifications](docs/specifications/PRODUCT_SPECIFICATIONS.md) (the public API)
- [Technical specifications](docs/specifications/TECHNICAL_SPECIFICATIONS.md) and the [gateway specifications](docs/specifications/gateways/)
- [Roadmap](docs/roadmap/ROADMAP.md)
- [Validation log](docs/validation-log.md) and [uncertainty register](docs/uncertainty-register.md)

## Development

Requires Node 22.12 or later and pnpm (the version is pinned in `package.json`; Corepack or pnpm itself switches to it).

```sh
pnpm install
pnpm run ci          # lint, typecheck, dependency guard, secret scan, tests, build, package checks, smoke test
pnpm test        # tests only
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Licence

[MIT](LICENSE)
