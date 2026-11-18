# Bawaba: product requirements

*Last updated 17 November 2026. Status: pre-alpha, no code yet.*

Bawaba (بوابة, "gateway") is an open-source TypeScript SDK for accepting payments through the main gateways of Egypt and the Gulf. This document says **why** Bawaba exists, **who** it is for and **what** it must do. How it looks to developers is in [PRODUCT_SPECIFICATIONS.md](../specifications/PRODUCT_SPECIFICATIONS.md). How it is built is in [TECHNICAL_SPECIFICATIONS.md](../specifications/TECHNICAL_SPECIFICATIONS.md). When it ships is in [ROADMAP.md](../roadmap/ROADMAP.md).

**Labels used in all project docs:**
- **Verified:** read in the gateway's own documentation or source code (date given).
- **Secondary:** taken from a third-party source; still to be confirmed officially.
- **Uncertain:** not confirmed anywhere; needs a sandbox call.
- **Proposal:** a project design choice, open to change.

---

## 1. Problem

Merchants in Egypt and the Gulf rarely use a single payment gateway. They pick gateways by country, card network (mada, KNET, Benefit, Meeza), wallet, cash collection (Fawry) and instalment provider (valU, Tabby, Tamara). Developers integrating those gateways in TypeScript face five problems:

1. **No SDK covers the region.** No package set covers the Egyptian gateways (Paymob, Kashier, Fawry) together with the regional ones (Geidea, PayTabs, Amazon Payment Services, Tap). The closest projects cover only Egypt (Sarraf) or only the Gulf (PayKernel). See section 5.
2. **Each gateway is different.** There are four amount formats (integer minor units, decimal strings, decimals with ISO exponents), four checkout shapes (redirect, browser form POST, embedded JavaScript, cash reference code) and five webhook signature families. Mixing `150000` and `"1500.00"` is the most likely money bug.
3. **Signature verification is easy to get wrong.** A verifier that silently accepts a forged callback is the worst failure such code can have. Real cases exist: CVE-2026-15205 in Paymob's WooCommerce plugin ran a SQL query before checking the HMAC.
4. **Retries can move money twice.** An SDK that retries a refund after a timeout or 5xx can refund twice. Sarraf, the closest competitor, marks a 5xx on a money-moving call as retryable and releases its idempotency lock.
5. **Existing packages carry weight and runtime limits.** Runtime dependencies (`zod`, `query-string`) widen the supply-chain surface of code that holds payment secrets. Crypto built on `node:crypto` doesn't run on Cloudflare Workers or edge runtimes without compatibility flags.

## 2. Users

| User | Need | What Bawaba gives them |
|---|---|---|
| **Single-gateway developer** | A good client for one gateway, following that gateway's own docs | A full gateway-native client (`@bawabajs/paymob`, etc.) using the gateway's own field names, with no facade required |
| **Multi-gateway merchant developer** | One integration covering several gateways and countries | The `bawaba` facade: one payment, refund and webhook API across all seven gateways, with an escape hatch to each native client |
| **Platform and plugin builders** (e-commerce platforms, agencies) | Safe, well-typed building blocks that run on any runtime | Zero dependencies, Web Crypto, typed errors with stable codes, conformance-tested clients |

All three run server-side code. Bawaba is not a browser library; it refuses to run with secret keys in a browser-like environment.

## 3. Goals and non-goals

**Goals:**
1. Support **all seven gateways from the first release**. No gateway is deferred to a later phase ("no waves").
2. Be **safe with money by default**: never retry a money-moving call, never mark an unknown outcome as retryable, and support idempotency keys.
3. Be **safe with callbacks by default**: verify before use, over the raw body, failing closed, and separate signed fields from untrusted ones.
4. Be **honest about what is proven**: any operation not confirmed against a real sandbox ships as `beta` and is off by default.
5. Run on **any modern JavaScript runtime** (Node, Bun, Deno, Cloudflare Workers, Vercel Edge) with **zero runtime dependencies**.

**Non-goals:**
- **Routing or failover between gateways.** That is orchestration: a hosted business with its own regulatory questions (the CBE payment-service rules in Egypt, in force since 17 June 2025, and the equivalent central-bank rules in each Gulf country).
- **Holding, settling or moving funds** outside the gateways' own APIs.
- **Accepting raw card numbers or CVV.** Card entry stays on hosted pages, form POSTs and gateway JavaScript. Card-on-file uses gateway tokens only.
- **Durable infrastructure** (webhook inboxes, reconciliation stores, OpenTelemetry). Bawaba exposes small interfaces (for example `IdempotencyStore`) that applications implement.
- **Strict runtime validation of gateway responses.** Types are tolerant, and unknown fields pass through.

## 4. Scope: the seven gateways

| Gateway | Package | Main markets |
|---|---|---|
| Paymob | `@bawabajs/paymob` | Egypt, KSA, UAE, Oman |
| Kashier | `@bawabajs/kashier` | Egypt |
| Fawry | `@bawabajs/fawry` | Egypt (including PayAtFawry cash reference codes) |
| Geidea | `@bawabajs/geidea` | Egypt, KSA, UAE |
| PayTabs | `@bawabajs/paytabs` | KSA, UAE, Egypt, Qatar, Oman, Jordan, Iraq and others |
| Amazon Payment Services (formerly PayFort) | `@bawabajs/payfort` | UAE, KSA, Egypt, Kuwait, Qatar, Oman, Bahrain, Jordan |
| Tap Payments | `@bawabajs/tap` | Kuwait, KSA, UAE, Bahrain, Qatar, Oman, Egypt |

Together they reach the local networks and wallets that matter in the region: mada, KNET, Benefit, OmanNet, NAPS, Meeza, STC Pay, Apple Pay, and the Tabby, Tamara and valU instalment plans.

The supported currencies are EGP, SAR, AED, QAR, MAD, USD, EUR and GBP (2 decimals), and KWD, BHD, OMR, JOD and IQD (3 decimals).

## 5. Competitive landscape

### 5.1 Sarraf (Egypt: Paymob, Kashier, Fawry)

`@sarrafjs/*` has eight packages at `0.2.1`: core, paymob, kashier, fawry, express, nestjs, next and testing. Licence: Apache-2.0. The findings below are Verified from its source at commit `9e4bc8f` (29 October 2026):
- **Kashier** was confirmed against the real sandbox on 21 October 2026. **Paymob and Fawry** have only synthetic fixtures. Their unconfirmed features are `beta`, and every Fawry status mapping is `verified: false`.
- **Dependencies:** `zod` in every package, plus `query-string` in Kashier. Its crypto uses `node:crypto`, so it runs on Node and Bun only.
- **Money-safety gap:** a 5xx on a money-moving call becomes `PROVIDER_UNAVAILABLE` with `retryable: true`, and the idempotency lock is released.
- **No standalone gateway clients:** adapters work only through the `Sarraf` client.
- **Shipped beyond the packages:** an Astro docs site, a sandbox dashboard, example shops and an adapter conformance suite.
- **Not covered:** Geidea, PayTabs, Amazon Payment Services and Tap.
- **No commits since 29 October 2026.**

### 5.2 PayKernel (Gulf: Tap, MyFatoorah, Hesabe)

**Secondary** (npm descriptions only; source not yet read):
- `@paykernel/core` 1.0.1 (first published 1 September 2026), at `github.com/aashahin/paykernel`. Depends on `zod`.
- Adapters for Tap, MyFatoorah and Hesabe.
- Rich infrastructure: durable stores (Postgres, Redis, SQLite, Turso, D1), framework integrations, an OpenTelemetry bridge and routing.
- Described as runtime-portable, so "runs anywhere" is **not** unique against it.
- No Egyptian gateways, and none of Geidea, PayTabs or Amazon Payment Services.

### 5.3 Official and single-gateway packages (npm search, 17 November 2026)

| Gateway | Existing packages | What it means for Bawaba |
|---|---|---|
| Tap | `@tap-payments/node` 0.1.4 (official, July 2026) | A Bawaba Tap client adds less value; see TECHNICAL_SPECIFICATIONS §6.4 |
| PayTabs | `paytabs_pt2` 2.0.12; `paytabs-sdk` 1.2.1 | Community-quality; room for a better client |
| Amazon Payment Services | `@sikka/aps` 0.0.37; `payfort-node` (2016) | One recent alternative |
| Geidea | `@lmnto/geidea-payment` 1.0.2; official React Native SDK only | Effectively no server-side TypeScript SDK |

### 5.4 Differentiators

| Differentiator | Sarraf | PayKernel (Secondary) |
|---|---|---|
| **Egypt and the Gulf in one SDK**, with all seven gateways | Egypt only | Gulf only |
| **Gateway-native clients usable without the facade** | Adapters only | Adapters only |
| **Zero runtime dependencies** | `zod`, `query-string` | `zod` |
| **Strict money safety:** a 5xx on a mutation is `OutcomeUnknownError`, and the idempotency claim is kept | 5xx retryable, lock released | Unknown |
| **Normalized events that separate `signed` from untrusted `raw` fields** | Mixed | Unknown |
| **Real captured callbacks for every gateway**, with a public validation log (first for Paymob, Fawry, Geidea, PayTabs and Amazon Payment Services) | Kashier only | Unknown |
| Runs on any JavaScript runtime | Node and Bun only | Also portable |

**Not differentiators:**
- Paymob subscription webhooks (Sarraf has them).
- "Proof, not claims" as a method (Sarraf uses it too).

**Ideas adopted from Sarraf** (design only, no code copied):
- client-side idempotency keys;
- capability levels with a beta opt-in;
- `webhooks.inspect()`;
- raw-body webhook input;
- an optional status re-query after a notification;
- typed currencies with 3-decimal support;
- exported status tables with a `verified` flag;
- a conformance suite.

## 6. Functional requirements

IDs are stable; reference them in issues and PRs.

### Core (`@bawabajs/core`)

| ID | Requirement |
|---|---|
| FR-C1 | Every HTTP call goes through one request pipeline with an injectable `fetch`, a timeout, a caller abort signal, custom headers, body-free request/response hooks, and JSON and form-encoded bodies. |
| FR-C2 | Every operation is declared `read` or `mutation`. Reads may retry; mutations never retry once the request may have reached the gateway. |
| FR-C3 | A timeout, network error or 5xx on a mutation throws `OutcomeUnknownError`. That error is never marked retryable and carries the merchant reference. Only a 4xx is a definite failure. |
| FR-C4 | Money-moving calls accept an optional `idempotencyKey`. A completed result is replayed. Reusing a key with different parameters throws. After an unknown outcome the claim is kept, so a blind retry is refused. The store is pluggable, with an in-memory default. |
| FR-C5 | `Money` is `{ minor: integer, currency: Currency }`. Conversions to and from decimal strings are exact: they reject floats and excess precision and never round. |
| FR-C6 | Errors form a typed hierarchy. Each carries a stable string `code`, the gateway name and, for API errors, the status, headers, request ID and raw body. |
| FR-C7 | Crypto covers SHA-256 and SHA-512, plain and HMAC, with hex and base64 output, plus a constant-time compare. It uses Web Crypto only. |
| FR-C8 | Every operation and payment method has a capability level: `supported`, `beta` or `unsupported`. Calling a `beta` feature throws unless `allowBeta: true`. |
| FR-C9 | Secrets, phrases, client secrets, card data and billing data never appear in logs, errors or `toJSON` output. |
| FR-C10 | A conformance suite that every gateway client must pass ships at `@bawabajs/core/conformance`. |

### Gateway clients (`@bawabajs/<gateway>`)

| ID | Requirement |
|---|---|
| FR-G1 | Each client is a complete SDK for its gateway's first-release operations (PRODUCT_SPECIFICATIONS §5) and is usable without the facade. |
| FR-G2 | Clients use the gateway's wire-format field names and pass unknown fields through untouched. |
| FR-G3 | Each client verifies every callback type its first-release operations produce. Verifiers are also exported from a `./webhooks` subpath that needs no client instance. |
| FR-G4 | Each client exposes `request()` (an escape hatch for unwrapped endpoints), `capabilities`, and `webhooks.inspect()`, which never throws and never reveals a secret. |
| FR-G5 | Regions (Paymob, Geidea, PayTabs) and test/live modes are client configuration, with an explicit host override. |
| FR-G6 | Gateways that report failures inside a 200 response are mapped to errors or to declined results by the client. A declined payment is data, not an exception. |

### Facade (`bawaba`)

| ID | Requirement |
|---|---|
| FR-F1 | One `Bawaba` instance holds one or more gateways, configured through per-gateway factories (`bawaba/<gateway>`). Methods are typed by the configured set. |
| FR-F2 | `createPayment` returns a discriminated union of four kinds (`redirect`, `form_post`, `embedded`, `reference`). Each kind has all of its fields present, so callers never need `!`. |
| FR-F3 | The facade provides `retrievePayment`, `reconcile`, `refund`, `void` and `capture`, plus capabilities and `gateway()`, which returns the native client. |
| FR-F4 | Gateway statuses map to one merged status set. The mapping tables are exported, with a `verified` flag per row. |
| FR-F5 | `webhooks.verify` returns a normalized event with a dedupe `id`, a `type`, a `status`, `money`, `signed` (authenticated fields only) and `raw` (untrusted). |
| FR-F6 | `webhooks.inspect`, `webhooks.alreadyProcessed` (each gateway's acknowledgement convention) and `redirects.verify` (thank-you page only, with an `authenticated` flag). |
| FR-F7 | `confirmWithStatusQuery` re-reads the payment from the gateway after verification. It is on by default for Fawry, Tap and Amazon Payment Services. |

### Testing and documentation

| ID | Requirement |
|---|---|
| FR-T1 | `@bawabajs/testing` ships scrubbed fixtures and test signers for all seven gateways. The signers are written independently of the clients. |
| FR-T2 | Every gateway's package README states the capability table, the unofficial notice and how to verify webhooks. |
| FR-T3 | A public validation log records what was confirmed in which sandbox and when. A public uncertainty register lists what isn't confirmed yet. |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Zero runtime dependencies** in core, gateway clients and the facade. Framework adapters use `peerDependencies` only. The only exception is the core `./conformance` subpath, which has Vitest as an optional peer. |
| NFR-2 | **Portability:** no `node:` imports in core, gateway clients or the facade, only global `fetch` and Web Crypto. CI imports every package under Node, Bun and Deno. |
| NFR-3 | **Platform:** Node `>=22.12`; dual ESM and CJS with `.d.ts` and `.d.cts`; `sideEffects: false`; `publint` and `attw` clean. |
| NFR-4 | **Webhook safety:** verification takes the raw body, runs before any other use of the input, and fails closed on unknown or missing event types. |
| NFR-5 | **Proof:** a capability is `supported` only with a sandbox-captured fixture. Synthetic fixtures can't promote a capability. |
| NFR-6 | **Tests:** core has full unit coverage of the retry and no-retry paths, idempotency, money conversion, crypto and error mapping. Every client passes the conformance suite. Changing any signed field must make verification fail. |
| NFR-7 | **Supply chain:** npm trusted publishing with provenance; lockfile committed; secret scanning in CI. |
| NFR-8 | **Naming and trademarks:** no gateway logos, and no "amazon" in any package name. Every README and `package.json` description says: *"Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments."* |
| NFR-9 | **Licence:** MIT (decided 17 November 2026; see ROADMAP §8.2). |

## 8. Priorities

| Priority | Features |
|---|---|
| **Must** (in 0.1.0, proven for 1.0) | Core; all seven clients with create-payment, retrieve, refund, and webhook verification over the raw body; typed errors with `code`; the no-retry rule; idempotency keys (passed to Tap); capability levels with beta opt-in; redaction; `Money` with typed currencies; facade `createPayment` with four result kinds; `webhooks.verify` with normalized events and dedupe keys; `webhooks.inspect` |
| **Should** (before 1.0) | Void and capture where supported; redirect verification; the Paymob subscription verifier; `@bawabajs/testing` signers and fixtures; status re-query; the conformance suite published |
| **Later** | Framework adapters (Express, NestJS, Next.js) and examples; Kashier transaction listing through the facade; Paymob subscriptions and QuickLinks; saved cards and tokenization across gateways; payouts as separate packages; more gateways |
| **Excluded** | Routing or failover; holding or settling funds; any API accepting raw card numbers or CVV (including the Amazon Payment Services and PayTabs "own form" and direct card APIs); strict runtime validation of responses |

## 9. Release definitions

| Release | Criteria |
|---|---|
| **`0.1.0` on npm `next`** (the two-week target) | All ten packages published (core, seven clients, facade, testing), plus one minimal example in the repository. Every gateway that had a sandbox in time is validated, and every unproven operation is `beta`. A public status table shows which gateways are proven. |
| **`1.0.0-rc`** | Every verifier of every gateway reproduced from at least one real captured callback. An outside reviewer has checked the verifiers, redaction and the no-retry paths. A new developer can reach a verified sandbox payment and webhook on each gateway using only the README. |
| **`1.0.0` on `latest`** | The rc criteria hold; fresh CJS and ESM installs work; Changesets switches the gateway packages to independent versions. |

**Success measures after 1.0:**
- every gateway has `supported` create-payment, refund and webhook capabilities;
- no reported double-charge or double-refund caused by the SDK;
- no verifier bypass;
- outside contributors can add or fix a gateway by following the conformance suite.

## 10. Naming

`bawaba` describes the product, is easy for Arabic speakers to say and remember, and contains no gateway's trademark.

npm registry check (16 November 2026, scope corrected 18 November 2026):

| Name | Status |
|---|---|
| `bawaba` (unscoped, the facade) | Free (Verified 18 November 2026) |
| The `bawaba` scope | **Taken** by an unrelated npm account (Verified 18 November 2026: npm refuses the org name), so the packages use **`@bawabajs/*`** |
| `@bawabajs` | The project's npm org, created 18 November 2026 |
| `bawabah` | Taken (an unrelated app) |
| `dafaa` (دفع), `tahseel` (تحصيل) | Free; fallback names |

Before the first public release, search GitHub and the Egyptian trademark register. "Al Bawaba" is a known news site, though the confusion risk is low for a developer library.

`@bawabajs/payfort` follows the API's own host names (`*.payfort.com`). Its README calls it "a client for the Amazon Payment Services (formerly PayFort) API".

## 11. Stripe and future gateways

- **Stripe is not a gateway in scope.** Egyptian merchants can't open a Stripe account directly (Secondary; confirm on `stripe.com/global`). Stripe already has an excellent official SDK, and adding it would pull the facade toward Stripe's model.
- **After 1.0, if users ask:** a facade-only `@bawabajs/stripe` wrapping the official `stripe` package as a peer dependency, for businesses with a foreign company that collect international cards on Stripe.
- **Design check now:** sketch on paper how Stripe would fit the facade's types. If it can't fit without special cases, the facade is too shaped around particular gateways.
- **Candidate gateways after 1.0, chosen by demand:** MyFatoorah (Kuwait and the Gulf), Moyasar (KSA), HyperPay (KSA, UAE, Jordan) and Checkout.com (UAE, KSA).

## 12. Assumptions and constraints

- **Open source**, led by one developer building with Claude Code. Up to two more developers may join later.
- **Sandbox only:** live gateway accounts are never used for development or tests.
- **Regulation:** an SDK that never holds funds or card data is not a payment service, so no central-bank licence should be needed. This changes if routing or failover is added, which is why they are out of scope. This is not legal advice.
- **Customer data:** the SDK stores nothing. Consent and retention under each country's data-protection law (Egypt's PDPL, the Saudi and UAE PDPLs, and others) are the application's responsibility.
