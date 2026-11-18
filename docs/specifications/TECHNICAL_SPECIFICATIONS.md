# Bawaba: technical specifications

*Last updated 17 November 2026. Status: Proposal. No code has been written or run against any gateway.*

This document says **how Bawaba is built**:
- the architecture and the design of `@bawabajs/core`;
- the webhook rules;
- the comparison across gateways (section 5). Each gateway's own facts are in its spec file under [gateways/](gateways/), which is the source of truth for that gateway's code;
- the repository, tooling, CI and validation tooling.

The public API is in [PRODUCT_SPECIFICATIONS.md](PRODUCT_SPECIFICATIONS.md), and the schedule is in [ROADMAP.md](../roadmap/ROADMAP.md).

**Labels:**
- **Verified:** checked in the gateway's own docs or source; the date is given.
- **Secondary:** taken from a third party.
- **Uncertain:** needs a sandbox call.
- **Proposal:** a design choice.

**When a sandbox contradicts a gateway spec file:** fix the file first, then the code, and record the change in `docs/validation-log.md`.

---

## 1. Engineering principles

1. **Zero runtime dependencies** in core, gateway clients and the facade.
2. **Global `fetch` and Web Crypto only.** No `node:` imports, so the same code runs on Node, Bun, Deno, Cloudflare Workers and Vercel Edge.
3. **Node `>=22.12`** for the published packages, with dual ESM/CJS builds. Developing and building Bawaba needs Node `>=22.18` (root `engines`), because tsdown 0.23 requires it.
4. **Wire-format field names inside gateway clients.** Signatures are computed over fields exactly as sent, undocumented fields must pass through untouched, and developers search each gateway's docs by wire name.
5. **Typed errors that keep the raw response.**
6. **Fail-closed webhook verification over the raw request body**, performed before anything else.
7. **No automatic retry of any operation that moves money**, and no "retryable" hint on any money-moving failure whose outcome is unknown.
8. **Nothing is `supported` until it is proven** against a real sandbox.

## 2. Architecture

```text
              ┌────────────────────────────────────────────────────┐
  users →     │ bawaba  (unified facade + normalized events)       │
              └──────────────────────────┬─────────────────────────┘
                                         │ uses
   ┌─────────┬──────────┬─────────┬──────┴──┬──────────┬──────────┬────────┐
   ▼         ▼          ▼         ▼         ▼          ▼          ▼
paymob   kashier     fawry     geidea   paytabs    payfort      tap        ← @bawabajs/* gateway-native clients
   └─────────┴──────────┴─────────┴────┬────┴──────────┴──────────┴────────┘
                                       ▼
                        @bawabajs/core  (pipeline, errors, money, crypto, idempotency, capabilities, redaction)

@bawabajs/testing → fixtures + independent signers (depends on core only)
@bawabajs/express | nestjs | next → thin adapters (peer-depend on the framework; after 1.0)
```

**Dependency rules, enforced by `scripts/check-deps.mjs` (§9):**
- **One way:** core ← gateway clients ← facade ← adapters. Gateway packages never import each other.
- **Testing:** `@bawabajs/testing` depends on core only. The gateway packages list it as a dev dependency, so there is no cycle.
- **No runtime dependencies other than `@bawabajs/*`** in core, the gateways and the facade. The one exception is core's `./conformance` subpath, which lists Vitest as an **optional** peer dependency and is used only in test code.
- **No `node:` imports** in core, the gateways or the facade.

## 3. `@bawabajs/core`

### 3.1 Request pipeline

One `request()` choke point is used by every client:
- **`fetch`:** the global one, injectable through options.
- **Timeout:** `AbortSignal.timeout(timeoutMs)`, combined with the caller's signal through `AbortSignal.any`.
- **Bodies:** JSON and `application/x-www-form-urlencoded`. Path parameters are URI-encoded.
- **Options:** custom headers; `onRequest` and `onResponse` hooks that receive method, URL, status and timing, but never bodies or secrets.
- **Operation kind:** each call declares its kind (`read` or `mutation`) and the merchant reference, if any.

### 3.2 Retry policy

| Outcome | `read` | `mutation` |
|---|---|---|
| 2xx | Return | Return |
| 4xx (not 429) | Throw the matching `ApiError` subclass | Throw the matching `ApiError` subclass. This is a definite failure. |
| 429 | Retry, then `RateLimitError` | `RateLimitError`, no retry |
| 5xx | Retry, then `GatewayServerError` | **`OutcomeUnknownError`** |
| Timeout or network error | Retry, then `ConnectionError` | **`OutcomeUnknownError`** |

- **Read retries:** at most 2, with exponential backoff and full jitter. `Retry-After` is honoured when present.
- **`OutcomeUnknownError`** carries `gateway`, `operation` and `merchantReference`, and is never marked retryable.
- **Known risk:** `fetch` error causes may not reliably show whether the request was sent. Unless the pipeline can prove a mutation never left the process (for example, a config error before `fetch` was called), it assumes the request was sent.

### 3.3 Idempotency

```typescript
interface IdempotencyStore {
  claim(key: string, fingerprint: string): Promise<ClaimResult>;  // atomically claim, or report the existing state
  get(key: string): Promise<IdempotencyRecord | undefined>;
  complete(key: string, result: unknown): Promise<void>;          // store the result for replay
  release(key: string): Promise<void>;                            // after a definite failure, or after reconcile
}
type ClaimResult =
  | { state: "claimed" }
  | { state: "completed"; fingerprint: string; result: unknown }
  | { state: "held"; fingerprint: string };                       // in flight, or the outcome is unknown
```

**Flow for a money-moving call with an `idempotencyKey`:**
1. **Fingerprint the parameters:** stable JSON (sorted keys, no `undefined`) → SHA-256 → hex.
2. **`claim`** the key:
   - `completed` with the same fingerprint → return the stored result;
   - a different fingerprint → `IdempotencyError` (`idempotency_key_reused`);
   - `held` → `IdempotencyError` (`idempotency_outcome_unknown`).
3. **Send the request.**
4. **Record the outcome:**
   - success → `complete`;
   - a definite failure (a 4xx) → `release`;
   - `OutcomeUnknownError` → **keep the claim.** Only `reconcile` releases it, once it knows the true state.

**Store and gateway mapping:**
- **Store:** the default is an in-memory `Map`. Apps provide Redis or database stores through the interface; none is bundled.
- **Tap:** the key is also sent as `reference.idempotent`. Tap's length and charset limits for that field are Uncertain.
- **Amazon Payment Services:** refunds map the key to `maintenance_reference` once its retry behaviour is confirmed (Uncertain).

### 3.4 Errors

- **Hierarchy:** `BawabaError` → `ApiError` (`status`, `headers`, `requestId`, `raw`, `gateway`) with subclasses for 400, 401, 403, 404, 429 and 5xx. Beside it: `ConnectionError`, `OutcomeUnknownError`, `SignatureVerificationError`, `CapabilityError`, `IdempotencyError` and `ConfigError`.
- **Codes:** every error has a stable `code`; the list is in PRODUCT_SPECIFICATIONS §4.
- **Serialization:** `toJSON()` is redacted (3.9).
- **Failures inside a 200:** clients map these (Amazon Payment Services `response_code`, Geidea `responseCode`). A declined payment is a result, not an error.

### 3.5 Money

- **`Money = { minor: number; currency: Currency }`**, where `minor` is a safe integer.
- **`Currency`** is a typed union with an exponent table:
  - 2 decimals: EGP, SAR, AED, QAR, MAD, USD, EUR, GBP;
  - 3 decimals: KWD, BHD, OMR, JOD, IQD.
- **Per-gateway exponents:** where a gateway uses a different exponent from ISO 4217 (to confirm for IQD), the client overrides it.
- **Conversion:** `toDecimalString()` and `fromDecimalString()` use string and `BigInt` arithmetic. They reject floats, non-integers and excess precision, and never round. Decimal strings keep trailing zeros (`"250.00"`), because some signatures depend on them.

### 3.6 Crypto

- **API:** `globalThis.crypto.subtle` only.
- **Algorithms:** HMAC-SHA256, HMAC-SHA512, SHA-256 and SHA-512, with hex (lowercase) or base64 output.
- **Constant-time compare:** decode both sides to bytes, return false if the lengths differ, then XOR-accumulate over every byte and compare the result to zero. Hex input is compared case-insensitively by decoding, not by string comparison.
- **Encoding:** UTF-8 through `TextEncoder`. Raw-body input that is a `Uint8Array` is hashed as is, never re-encoded.

### 3.7 Capabilities

- **Declaration:** each client declares a static `capabilities` object for every operation and payment method: `supported`, `beta` or `unsupported`.
- **Where the levels come from:** the validation log. Only `source: "sandbox"` fixtures can justify `supported`.
- **Enforcement:** a beta call without `allowBeta: true` throws `CapabilityError`, and so does an unsupported call.
- **Status tables:** status-mapping tables are exported with a `verified` flag per row.

### 3.8 Webhook input helpers

- **`RawWebhookRequest`:** `{ rawBody: string | Uint8Array; headers; query }`.
- **Normalization:** headers become lowercase keys; query parameters become a record of the first values.
- **Parsing:** JSON and form-encoded bodies are parsed **only after** verification succeeds.

### 3.9 Redaction

Configured secrets are registered with a redactor, and their values are replaced in:
- error messages;
- `toJSON` output;
- hook payloads;
- `inspect` reports.

**What is redacted:** API keys, secret keys, HMAC secrets, Amazon Payment Services phrases, Geidea API passwords, Paymob client secrets and auth tokens, card data and billing data (names, emails, phones, addresses).

### 3.10 Conformance suite (`@bawabajs/core/conformance`)

A shared Vitest suite that every client runs against itself. It checks:
- capabilities are declared for every operation;
- `Money` round-trips for every supported currency;
- every verifier fails closed on a missing signature, a wrong signature, a changed signed field, and an unknown or missing event type;
- every verifier takes the raw body;
- no mutation is retried, and a 5xx on a mutation yields `OutcomeUnknownError` with the idempotency claim kept;
- no secret appears in errors, hooks or `inspect` output;
- `inspect` never throws.

## 4. Webhook rules shared by all gateways

1. **Verification is the first operation** on callback input: no database lookups, and no parsing for logic, before it. CVE-2026-15205 in Paymob's WooCommerce plugin ran a SQL query before the HMAC check.
2. **Verifiers take the raw request body** (`string | Uint8Array`), never a parsed object. Parsing changes signed values: `"250.00"` sent as a number becomes `250`, and `1.10` becomes `1.1`. PayTabs signs the raw bytes directly. The framework adapters must capture the raw bytes.
3. **Unknown or missing event types fail closed.**
4. **Each verifier documents exactly which fields are signed.** Everything else is untrusted and goes in `raw`, not `signed`.
5. **Dedupe keys** (`event.id`) have the form `{gateway}:{transaction or order id}:{status}`. The per-gateway keys are in PRODUCT_SPECIFICATIONS §6.
6. **Acknowledgement helpers** map each gateway's convention: Kashier treats `409` as "already processed", and Amazon Payment Services requires a 2xx.
7. **Replay protection is state-based.** No gateway signs a delivery timestamp. Geidea signs a `timestamp` and Tap signs `x_created`, but whether those mean delivery time or transaction time is Uncertain, so they aren't relied on. Applications use a unique constraint plus compare-and-set. The SDK documents this; it doesn't pretend to solve it.

## 5. Gateway reference

Each gateway has its own specification file. **That file is the source of truth for its package**: hosts, credentials, operations, signature recipes, status mapping, facade mapping, test vectors, open questions (with register IDs), a validation checklist and traps.

| Gateway | Specification | Register prefix |
|---|---|---|
| Paymob | [gateways/paymob.md](gateways/paymob.md) | PMB |
| Kashier | [gateways/kashier.md](gateways/kashier.md) | KSH |
| Fawry | [gateways/fawry.md](gateways/fawry.md) | FWY |
| Geidea | [gateways/geidea.md](gateways/geidea.md) | GDA |
| PayTabs | [gateways/paytabs.md](gateways/paytabs.md) | PTB |
| Amazon Payment Services | [gateways/payfort.md](gateways/payfort.md) | APS |
| Tap Payments | [gateways/tap.md](gateways/tap.md) | TAP |

This section keeps only what applies across gateways: the comparison (5.8), the design consequences (5.9) and the lessons from Sarraf (5.10).

### 5.8 Side by side

| | Paymob | Kashier | Fawry | Geidea | PayTabs | Amazon PS | Tap |
|---|---|---|---|---|---|---|---|
| **Checkout shape** | Redirect (or Pixel) | Redirect to hosted page or session | **Reference code** paid later; card/wallet | **JS checkout with a session ID** | Redirect | **Browser form POST** | Redirect (`transaction.url`) |
| **Regions** | EG, SA, AE, OM hosts | One | One | EG, SA, AE hosts | Many; the key is bound to a region | One | One |
| **Test vs live** | Same host, by key | Different hosts | Different hosts | Same host? (Uncertain) | Uncertain | Different hosts | Same host, by key |
| **Amount format** | Integer minor | Decimal string | Decimal, 2 dp | Decimal, 2 dp | Decimal | **Integer minor** | Decimal, ISO decimals |
| **Webhook signature** | HMAC-SHA512 over fixed fields (query) | HMAC-SHA256 over `signatureKeys` (header) | SHA-256 with the key appended (body; Secondary) | HMAC-SHA256 **base64** over fixed fields | HMAC-SHA256 over the **raw body** (header) | Configured SHA, phrase-wrapped sorted pairs | HMAC-SHA256 over labelled fields (header) |
| **Server-side idempotency** | None | None | None (`merchantRefNum` is unique) | None | None (`cart_id` not unique) | Unique `merchant_reference`; `maintenance_reference` for refunds | **`reference.idempotent`, 24 h** |
| **Documented webhook retries** | None | 10 over about a day | Uncertain | Uncertain | None | Uncertain | Uncertain |

### 5.9 Design consequences

1. **Money is integer minor units plus a currency** in core and the facade, and each client converts to its gateway's format. Seven gateways use four amount formats.
2. **A checkout result isn't always a URL:** there are four result kinds (PRODUCT_SPECIFICATIONS §3.3).
3. **Only Tap has server-side idempotency.** The no-retry rule stays universal, and Tap receives the caller's key.
4. **Signature families:**
   - HMAC over fixed fields: Paymob, Geidea, Tap;
   - HMAC over a listed set of keys: Kashier;
   - HMAC over the raw body: PayTabs;
   - a plain hash with the secret appended or wrapped around: Fawry, Amazon Payment Services.

   Outputs are hex or base64, using SHA-256 or SHA-512, plain or HMAC. Core's crypto must cover all of these.
5. **Regions are per-client configuration** (Paymob, Geidea, PayTabs), not a facade concept.

### 5.10 Traps learned from Sarraf's source

These come from a read of commit `9e4bc8f`. They are design lessons only; no code was copied.

- **Retries:** don't treat a 5xx on a mutation as retryable, and don't release the idempotency lock after one.
- **Kashier:** the signature needs strict RFC 3986 encoding ([kashier.md](gateways/kashier.md) §4.2).
- **Fawry:**
  - amounts are reformatted to 2 dp inside the signature (`250` → `250.00`);
  - V1 notifications are MD5 and must be rejected.
- **Paymob:**
  - **Missing `type`:** Sarraf treats a callback without `type` as `TRANSACTION`, which conflicts with fail-closed rule 3. Confirm from real callbacks whether `type` is always present (Uncertain).
  - **Refund callbacks** describe the refund transaction (`is_refund`, `parent_transaction`), not the original payment. To report the payment's totals, read the parent transaction.
  - **Redirect `hmac`:** Sarraf assumes the redirect query may carry an `hmac` over the same field set, but this isn't confirmed (Uncertain).
- **Checkout results:** results whose fields are all optional (`redirectUrl?`) force callers to write `!`. Use a discriminated union instead.

## 6. Facade design

### 6.1 Construction and typing

- **Factories:** each gateway subpath (`bawaba/paymob`, etc.) exports a factory, such as `paymob(config)`. The factory wraps the native client together with that gateway's facade mapping: money conversion, result kind, status table, event builder and dedupe key.
- **Typing:** `new Bawaba({ gateways })` infers the configured gateway names, so every method's `gateway` argument is restricted to them. Capability types are carried per gateway, so unsupported operations fail to compile where possible.
- **Sequencing:** the facade is written **after** all seven clients exist, so its types come from the real overlap. Geidea's embedded checkout and Amazon Payment Services' form POST stretch the result types most.

### 6.2 Status mapping and events

- **Status tables:** each subpath exports a table from gateway states to the merged status set (PRODUCT_SPECIFICATIONS §3.4), with a `verified` flag per row, plus an event builder that fills `signed` only from authenticated fields.
- **Paymob refunds:** a refund callback describes the refund transaction, so report it as `refund.*` and, where possible, read the parent payment.

### 6.3 Status re-query

When `confirmWithStatusQuery` is on, `webhooks.verify` first verifies the callback. It then reads the payment through the native client's status operation and builds `signed` from that response. A failed re-query throws, and never falls back silently to unsigned fields.

### 6.4 Tap: a native client despite the official SDK

**Proposal:** build `@bawabajs/tap` as a full native client, because:
1. the facade needs Bawaba's pipeline (the no-retry rule, idempotency claims, redaction) under every gateway;
2. wrapping a 0.1.x SDK adds a runtime dependency and ties Bawaba to its release pace;
3. Tap's API is the cleanest of the seven, so the client is cheap to build.

**Revisit before 1.0:** if `@tap-payments/node` reaches 1.0 with zero dependencies and portable crypto, consider a facade-only adapter that peer-depends on it.

## 7. Repository layout

```text
bawaba/
├── .changeset/                 config.json, README.md
├── .claude/
│   └── CLAUDE.md               project rules for Claude Code sessions
├── .github/
│   ├── workflows/              ci.yml, contract.yml, contract-gateway.yml, release.yml
│   ├── CODEOWNERS              the lead for now; per-gateway owners when developers join
│   └── dependabot.yml          grouped weekly updates: dev tooling and GitHub Actions
├── docs/
│   ├── requirements/PRODUCT_REQUIREMENTS.md
│   ├── specifications/PRODUCT_SPECIFICATIONS.md
│   ├── specifications/TECHNICAL_SPECIFICATIONS.md   (this file)
│   ├── specifications/gateways/ paymob.md kashier.md fawry.md geidea.md paytabs.md payfort.md tap.md
│   ├── roadmap/ROADMAP.md
│   ├── validation-log.md       what was confirmed, in which sandbox, and when
│   └── uncertainty-register.md every open question from the gateway files, plus GEN items
├── examples/                   (day 12) one runnable example; more after 1.0
├── fixtures/                   source of truth for scrubbed payloads (section 10)
│   ├── paymob/ kashier/ fawry/ geidea/ paytabs/ payfort/ tap/
│   └── README.md
├── packages/
│   ├── core/  paymob/  kashier/  fawry/  geidea/  paytabs/  payfort/  tap/
│   ├── bawaba/                 facade
│   └── testing/
├── scripts/                    TypeScript, run with Node's type stripping (section 9)
│   ├── check-deps.ts           dependency guard
│   ├── check-no-secrets.ts     secret scanner
│   ├── smoke/run.ts            pack, install and import every entry point (ESM and CJS)
│   ├── smoke/runtimes.ts       import every built entry point under Bun, Deno or Node
│   └── tsconfig.json           Node types, for scripts only
├── tools/                      (day 3) validation tooling, never published (section 12)
├── .editorconfig  .gitattributes  .gitignore  .node-version (24)
├── biome.json
├── CONTRIBUTING.md  LICENSE (MIT)  README.md  SECURITY.md
├── package.json                private root
├── pnpm-workspace.yaml  pnpm-lock.yaml
├── tsconfig.base.json  tsconfig.json
└── vitest.config.ts
```

The adapter packages (`express/`, `nestjs/`, `next/`) are created after 1.0, not as empty folders.

## 8. Tooling and configuration

### 8.1 Versions (installed 17 November 2026)

| Tool | Pin | Notes |
|---|---|---|
| pnpm | 12.21.0, through `packageManager` | pnpm switches itself to the pinned version |
| `typescript` | 7.0.2 | The native compiler; type-checks the workspace and scripts (8.4) |
| `tsdown` | 0.23.7 | Dual ESM/CJS builds with `.d.ts` and `.d.cts` |
| `vitest`, `@vitest/coverage-v8` | 5.1.0 | One project per package |
| `msw` | 3.0.6 | Tests of the real `fetch` path |
| `publint` | 0.3.25 | |
| `@arethetypeswrong/cli` | 0.18.5 | `--profile node16` (decision D5) |
| `@changesets/cli` | 3.0.3 | |
| `@biomejs/biome` | 2.6.8 | Lint and format, line width 160; Markdown excluded (decision D1) |
| `@types/node` | 22.20.5 | Root tooling and scripts only; never in core, gateway or facade packages |

### 8.2 Toolchain spike results (17 November 2026, ROADMAP §3.1)

| # | Check | Result |
|---|---|---|
| A1 | pnpm pinned through `packageManager` | **Pass.** pnpm 12.3.4 switched itself to 12.21.0. |
| A2 | Catalog and settings in `pnpm-workspace.yaml` | **Pass.** `catalog:` resolves; `strictPeerDependencies` is accepted there; `pnpm install --frozen-lockfile` passes. pnpm rewrites the file on install and drops comments. |
| A3 | TS 7 type-check | **Pass, with a changed design.** Project references and `composite` were dropped. One `noEmit` program (root `tsconfig.json`) covers `packages/*/src` and `packages/*/test`, and workspace packages resolve to their source through the `@bawabajs/source` export condition (8.4). A Node global in package code fails, because `types: []` and `lib: ["es2024", "webworker"]` provide web APIs only. |
| A4 | tsdown dual build with declarations under TS 7 | **Pass.** `index.js`, `index.cjs`, `index.d.ts` and `index.d.cts` (and the same for every subpath), from `isolatedDeclarations`. No fallback needed. |
| A5 | `publint` and `attw --pack . --profile node16` | **Pass** for all ten packages and 25 entry points. `node10` resolution fails, as expected, and is ignored by the profile. |
| A6 | Vitest projects | **Pass.** One project per package folder (`vitest run --project tap`), configured inline in `vitest.config.ts` because Vitest rejects an empty project list. Tests import packages by name and run against source. |
| A7 | Packed manifests | **Pass.** `pnpm pack` rewrites `workspace:^` and `catalog:`; the smoke test checks this. |
| A8 | CJS and ESM consumers | **Pass** on Node 24.16.0. **Found in CI:** the full pipeline fails on Node 22.12.0, because tsdown 0.23.7 requires Node `^22.18.0` (it can't load `tsdown.config.ts` on 22.12). Development therefore needs Node 22.18+, and a separate job checks the published packages on 22.12.0 (section 11). |
| A9 | Changesets fixed group | **Pass.** A trial changeset on core bumped all ten packages to the same snapshot version. |
| — | Runtime portability | **Pass locally:** every built entry point imports under Deno 2.9.6 and Bun 1.4.4. |

**Other findings:**
- **`pnpm ci` is a pnpm built-in** (a clean install) and takes precedence over the package script. Always use **`pnpm run ci`**.
- **Biome 2.6 formats Markdown**, so `*.md` is excluded to keep the hand-written docs as they are.

### 8.3 Root `package.json` scripts

| Script | Runs |
|---|---|
| `build` | `tsdown` in every package |
| `typecheck` | `tsc -p tsconfig.json && tsc -p scripts/tsconfig.json` |
| `test` / `test:watch` | Vitest |
| `lint` / `format` | Biome |
| `check:packages` | `publint && attw --pack . --profile node16` in every package |
| `check:deps`, `check:secrets`, `smoke`, `smoke:runtime` | The TypeScript scripts in `scripts/`, run with `node --experimental-strip-types --disable-warning=ExperimentalWarning` so Node 22.12 runs them too |
| `ci` | lint → typecheck → check:deps → check:secrets → test → build → check:packages → smoke. **Run it with `pnpm run ci`.** |
| `changeset`, `version-packages`, `release` | Changesets |

### 8.4 TypeScript

- **`tsconfig.base.json`:**
  - strictness: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`;
  - modules: `module` and `moduleResolution` set to `nodenext`; `target: es2023`; `customConditions: ["@bawabajs/source"]`;
  - emit: `verbatimModuleSyntax`, `isolatedModules`, `isolatedDeclarations`, `declaration`;
  - environment: `lib: ["es2024", "webworker"]` and `types: []`, which give `fetch`, `Response`, `crypto.subtle`, `TextEncoder` and `AbortSignal` but no DOM and no Node.
- **Root `tsconfig.json`:** extends the base with `noEmit`, including every package's `src` and `test`.
- **Package `tsconfig.json`:** extends the base with `include: ["src"]`; tsdown reads it.
- **`scripts/tsconfig.json`:** `types: ["node"]`, `allowImportingTsExtensions` and `erasableSyntaxOnly`, so the scripts stay runnable by Node's type stripping (no enums or namespaces).
- **The source condition:** every export carries `"@bawabajs/source": "./src/<entry>.ts"` first. TypeScript and Vitest resolve it, so nothing needs building before type-checking or testing. Node, bundlers and other runtimes ignore unknown conditions and use `import` or `require`. `src/` is therefore published alongside `dist/`.

### 8.5 Vitest and Changesets

- **`vitest.config.ts`:**
  - one inline project per package folder, inheriting `resolve.conditions`;
  - the default run includes `test/**/*.test.ts` and excludes `test/contract/`;
  - `BAWABA_CONTRACT=1` runs only `test/contract/` (used by `contract.yml`);
  - `v8` coverage over `packages/*/src`, with thresholds turned on once core is implemented.
- **`.changeset/config.json`:** a fixed group `[["bawaba", "@bawabajs/*"]]`, public access, base branch `main`. At `1.0`, the gateway packages switch to independent versions.

### 8.6 Package template

```text
packages/<name>/
├── src/index.ts            (+ src/webhooks.ts for gateways; src/conformance.ts for core; src/<gateway>.ts for bawaba)
├── test/index.test.ts      imports the package by name (+ test/contract/ for sandbox tests)
├── package.json
├── tsconfig.json           extends ../../tsconfig.base.json; include ["src"]
├── tsdown.config.ts        named entries; format ["esm", "cjs"]; platform "neutral"; target es2023; dts
└── README.md               purpose, unofficial notice, entry points, status, licence
```

**Placeholder rule:** until a gateway's build day, its package exports only `VERSION` and `GATEWAY`. No endpoint, field or signature recipe goes into code before then.

```jsonc
// packages/paymob/package.json (excerpt)
{
  "name": "@bawabajs/paymob",
  "version": "0.0.0",
  "description": "Paymob client for Bawaba. Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22.12" },
  "sideEffects": false,
  "exports": {
    ".": {
      "@bawabajs/source": "./src/index.ts",
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./webhooks": { "...": "same shape" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "src"],
  "scripts": { "build": "tsdown", "check": "publint && attw --pack . --profile node16" },
  "dependencies": { "@bawabajs/core": "workspace:^" },
  "devDependencies": { "@bawabajs/testing": "workspace:^" },
  "repository": { "type": "git", "url": "git+https://github.com/mohamedzait20003/Bawaba.git", "directory": "packages/paymob" },
  "publishConfig": { "access": "public", "provenance": true }
}
```

| Package | Entries | `dependencies` | Workspace dev dependencies |
|---|---|---|---|
| `@bawabajs/core` | `.`, `./conformance` (optional peer: `vitest`) | none | none (`vitest` from the catalog) |
| each of the seven gateway packages | `.`, `./webhooks` | `@bawabajs/core` | `@bawabajs/testing` |
| `bawaba` | `.`, plus `./paymob` … `./tap` | core and all seven gateway packages | `@bawabajs/testing` |
| `@bawabajs/testing` | `.` (one subpath per gateway later) | `@bawabajs/core` | none |

All packages start at `0.0.0`; the first changeset sets the version.

## 9. Enforcement scripts

All scripts are TypeScript (`scripts/*.ts`), type-checked with `scripts/tsconfig.json`, and run by Node's type stripping.

- **`scripts/check-deps.ts`** fails when:
  - a gateway package depends on another gateway package (in any dependency field);
  - core, a gateway package or the facade declares a runtime or peer dependency outside `@bawabajs/*`, other than core's optional Vitest peer;
  - `@bawabajs/testing` depends on anything other than core, or a gateway package on anything internal other than core;
  - any source file in core, a gateway package or the facade imports a `node:` module or a bare Node built-in;
  - a package lacks `"license": "MIT"`, `sideEffects: false`, or the unofficial notice in its `description` or README.

  Node globals such as `process` and `Buffer` are caught by the type-check instead (`types: []`).
- **`scripts/check-no-secrets.ts`** scans every tracked or new, non-ignored file. It fails on:
  - live-looking keys (`sk_live_…`, `pk_live_…`) and private key blocks;
  - Luhn-valid card numbers that are not public test cards;
  - committed `.env` files;
  - in fixtures: credential fields whose values aren't visibly fake, and email addresses outside reserved domains.

  A line can opt out with `bawaba-allow-secret`. Phone numbers aren't scanned; the fixture scrubber (section 12) replaces them.
- **`scripts/smoke/run.ts`** packs every built package and installs the tarballs into a throwaway npm project outside the workspace. It then checks that no `workspace:` or `catalog:` range is left, and imports every entry point with `import` and `require`.
- **`scripts/smoke/runtimes.ts <bun|deno|node>`** imports every built ESM entry point under that runtime.

## 10. Fixtures

- **Location and rules:** root `fixtures/<gateway>/` is the single source of truth (decision D3). The format, scrubbing rules, proof rule and third-party rule are in [fixtures/README.md](../../fixtures/README.md).
- **Bytes:** files there are kept byte-exact (`.gitattributes`: `fixtures/** -text`), because signatures cover exact bytes.
- **Packaging:** `@bawabajs/testing` copies the fixtures into its `dist/` at build time, so nothing is committed twice.
- **Proof rule:** only `source: "sandbox"` fixtures can move a capability from `beta` to `supported`.

## 11. CI/CD and repository settings

- **`ci.yml`** runs on pushes to `main` and on all PRs, with `permissions: contents: read`.
  - **Matrix:** Node 22.18.0 (the development floor, pinned exactly), 24 and 26 on `ubuntu-latest`, plus `windows-latest` on Node 24.
  - **Runtime-floor job:** builds on Node 24, then switches to Node 22.12.0 (the floor for the published packages) and runs `pnpm test` and `pnpm smoke`. The full pipeline can't run on 22.12, because tsdown fails there (8.2).
  - **Steps:** checkout → `pnpm/action-setup@v6` (version from `packageManager`) → `setup-node@v7` with the pnpm cache → `pnpm install --frozen-lockfile` → `pnpm run ci`.
  - **Portability job:** `pnpm build`, then `pnpm smoke:runtime bun` and `pnpm smoke:runtime deno` (`oven-sh/setup-bun@v2`, `denoland/setup-deno@v2.0.5`).
- **`contract.yml`** runs nightly at 02:30 UTC and on `workflow_dispatch`, **never on `pull_request`**.
  - **Jobs:** seven jobs, each gated on a repository variable (`CONTRACT_PAYMOB`, `CONTRACT_KASHIER`, `CONTRACT_FAWRY`, `CONTRACT_GEIDEA`, `CONTRACT_PAYTABS`, `CONTRACT_PAYFORT`, `CONTRACT_TAP`). A job-level `if` can't read matrix values, so they are separate jobs.
  - **The reusable workflow:** each job calls `contract-gateway.yml`, which runs in the `contract-<gateway>` environment (holding only that gateway's secrets) with `BAWABA_CONTRACT=1 pnpm vitest run --project <gateway>`.
- **`release.yml`** runs on pushes to `main`.
  - **Version job:** `changesets/action@v2.1.2` opens or updates the "Version packages" PR.
  - **Publish job:** runs when no changesets are left (that PR was merged) **and** the repository variable `NPM_PUBLISH_ENABLED` is `true`. It uses the protected `npm-publish` environment (`id-token: write`), runs `pnpm run ci`, then `pnpm release`.
  - **Uncertain:** whether `changeset publish` (which uses `pnpm publish`) authenticates with npm trusted publishing on its own. Confirm before the first release, together with GEN-02.
- **`dependabot.yml`:** weekly; one grouped PR for development dependencies and one for GitHub Actions.
- **GitHub settings (the lead, after the first push):**
  - a **ruleset on `main`**: restrict deletions; block force pushes; require a pull request (0 approvals while the lead works alone); require the six CI checks (`Node 22.18.0 (ubuntu-latest)`, `Node 24 (ubuntu-latest)`, `Node 26 (ubuntu-latest)`, `Node 24 (windows-latest)`, `Node 22.12.0 runtime floor`, `Runtime portability (Bun, Deno)`); repository admins may bypass, for emergencies and for the Changesets version PR (PRs opened with `GITHUB_TOKEN` don't trigger CI);
  - the `npm-publish` environment with required reviewers;
  - seven `contract-<gateway>` environments (about 25–35 secrets in total);
  - Dependabot;
  - private vulnerability reporting;
  - when contributors join: move the repository to a `bawaba` org, then update `CODEOWNERS` and every package `repository.url` (npm provenance requires the URL to match the repository that publishes).
- **npm settings:**
  - the `@bawabajs` org with 2FA enforced;
  - trusted publishing (OIDC) configured **separately for each of the ten packages** (plus the three adapters later);
  - possibly a one-time `0.0.0` placeholder publish per name, if npm requires a package to exist first (GEN-02; decision D7).

## 12. Validation tooling (`tools/`, never published)

1. **Webhook receiver:** a permanent public HTTPS endpoint, either a Cloudflare Worker with KV or a Vercel function (free tier).
   - It stores the raw callbacks (body bytes, headers, query) for CI to fetch.
   - Each sandbox is configured to call it.
   - It never stores secrets.
2. **Local tunnel** (cloudflared or ngrok), for interactive capture.
3. **Playwright (dev dependency only)**, to drive hosted pages, 3DS challenges, the Amazon Payment Services form POST and Geidea's JS checkout. Gateways may block headless browsers (Uncertain); the fallback is a documented manual capture run before each release.
4. **Fixture recorder and scrubber:** saves a scenario's request, response and callback, scrubs it (section 10, including phone numbers) and re-signs it with a test secret.

## 13. Uncertainty register

`docs/uncertainty-register.md` holds every open question from the "Open questions" table of each gateway spec file, with the same IDs (PMB, KSH, FWY, GDA, PTB, APS, TAP), plus these cross-cutting items:

| ID | Question |
|---|---|
| GEN-01 | Whether `fetch` errors distinguish "never sent" from "sent" |
| GEN-02 | The npm trusted-publishing bootstrap (decision D7), and whether `changeset publish` uses OIDC |
| GEN-03 | IQD's exponent per gateway |
| GEN-04 | Whether Node 26 still accepts `--experimental-strip-types` for the TypeScript scripts |

TS 7 compatibility with tsdown declarations, formerly an open item, was settled by spike A4 (8.2).

## 14. Sources

- **Gateway docs:** listed at the end of each gateway spec file.
- **Sarraf:** [repository](https://github.com/muhammedalaa1/sarraf), read at commit `9e4bc8f`; [npm](https://www.npmjs.com/package/@sarrafjs/core).
- **PayKernel** (Secondary): [npm](https://www.npmjs.com/package/@paykernel/core) and [GitHub](https://github.com/aashahin/paykernel).
- **Tap's official SDK:** [`@tap-payments/node`](https://www.npmjs.com/package/@tap-payments/node).
- **Paymob plugin CVEs:** [CVE-2026-87978](https://app.opencve.io/cve/CVE-2026-87978) and [CVE-2026-15205](https://app.opencve.io/cve/CVE-2026-15205).
- **CBE payment-service regulation:** [Baker McKenzie summary](https://insightplus.bakermckenzie.com/bm/banking-finance_1/egypt-new-regulation-on-payment-solutions).
- **Stripe availability** (Secondary): [Shopify community](https://community.shopify.com/t/i-m-from-egypt-and-i-cant-add-a-payment-method/169088), [Dodo Payments](https://dodopayments.blogspot.com/2026/04/stripe-supported-countries-2026-and.html), [Stripe UAE launch](https://stripe.com/es-gr/newsroom/news/stripe-launches-uae); confirm on [stripe.com/global](https://stripe.com/global).
