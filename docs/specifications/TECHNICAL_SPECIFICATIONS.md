# Bawaba: technical specifications

*Last updated 17 November 2026. Status: Proposal. No code has been written or run against any gateway.*

This document says **how Bawaba is built**:
- the architecture and the design of `@bawaba/core`;
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
3. **Node `>=22.12`**, with dual ESM/CJS builds.
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
paymob   kashier     fawry     geidea   paytabs    payfort      tap        ← @bawaba/* gateway-native clients
   └─────────┴──────────┴─────────┴────┬────┴──────────┴──────────┴────────┘
                                       ▼
                        @bawaba/core  (pipeline, errors, money, crypto, idempotency, capabilities, redaction)

@bawaba/testing → fixtures + independent signers (depends on core only)
@bawaba/express | nestjs | next → thin adapters (peer-depend on the framework; after 1.0)
```

**Dependency rules, enforced by `scripts/check-deps.mjs` (§9):**
- **One way:** core ← gateway clients ← facade ← adapters. Gateway packages never import each other.
- **Testing:** `@bawaba/testing` depends on core only. The gateway packages list it as a dev dependency, so there is no cycle.
- **No runtime dependencies other than `@bawaba/*`** in core, the gateways and the facade. The one exception is core's `./conformance` subpath, which lists Vitest as an **optional** peer dependency and is used only in test code.
- **No `node:` imports** in core, the gateways or the facade.

## 3. `@bawaba/core`

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

### 3.10 Conformance suite (`@bawaba/core/conformance`)

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

**Proposal:** build `@bawaba/tap` as a full native client, because:
1. the facade needs Bawaba's pipeline (the no-retry rule, idempotency claims, redaction) under every gateway;
2. wrapping a 0.1.x SDK adds a runtime dependency and ties Bawaba to its release pace;
3. Tap's API is the cleanest of the seven, so the client is cheap to build.

**Revisit before 1.0:** if `@tap-payments/node` reaches 1.0 with zero dependencies and portable crypto, consider a facade-only adapter that peer-depends on it.

## 7. Repository layout

```text
bawaba/
├── .changeset/                 config.json, README.md
├── .github/
│   ├── workflows/              ci.yml, contract.yml, release.yml
│   ├── CODEOWNERS              an owner per gateway package, plus a reviewer from another track
│   └── dependabot.yml          GitHub Actions and root dev dependencies only
├── .claude/
│   └── CLAUDE.md               project rules for Claude Code sessions
├── docs/
│   ├── requirements/PRODUCT_REQUIREMENTS.md
│   ├── specifications/PRODUCT_SPECIFICATIONS.md
│   ├── specifications/TECHNICAL_SPECIFICATIONS.md   (this file)
│   ├── specifications/gateways/ paymob.md kashier.md fawry.md geidea.md paytabs.md payfort.md tap.md
│   ├── roadmap/ROADMAP.md
│   ├── validation-log.md       what was confirmed, in which sandbox, and when
│   └── uncertainty-register.md seeded from the gateway spec files and section 13
├── examples/
│   └── minimal/                one runnable example (day 12); more after 1.0
├── fixtures/                   source of truth for scrubbed payloads (section 10)
│   ├── paymob/ kashier/ fawry/ geidea/ paytabs/ payfort/ tap/
│   └── README.md
├── packages/
│   ├── core/  paymob/  kashier/  fawry/  geidea/  paytabs/  payfort/  tap/
│   ├── bawaba/                 facade
│   └── testing/
├── scripts/
│   ├── check-deps.mjs          dependency guard (section 9)
│   ├── check-no-secrets.mjs
│   └── smoke/                  run.mjs, consumer-esm/, consumer-cjs/
├── tools/                      validation tooling, never published (section 12)
├── .editorconfig  .gitattributes (* text=auto eol=lf)  .gitignore  .node-version (24)
├── biome.json
├── CONTRIBUTING.md  LICENSE (MIT)  README.md  SECURITY.md
├── package.json                private root
├── pnpm-workspace.yaml
├── tsconfig.base.json  tsconfig.json (solution file)
└── vitest.config.ts
```

The adapter packages (`express/`, `nestjs/`, `next/`) are created after 1.0, not as empty folders.

## 8. Tooling and configuration

### 8.1 Versions (checked with `npm view`, 17 November 2026)

| Tool | Pin | Notes |
|---|---|---|
| pnpm | 12.21.0, through `packageManager` | Local machine has 12.3.4; update it before pinning |
| `typescript` | 7.0.2 | The native (Go) compiler. Whether tsdown's declaration build works with it is Uncertain (spike A4). |
| `tsdown` | 0.23.7 | Pinned exactly. Fallbacks: tsup 9, or `tsc` for declarations plus tsdown for JS. |
| `vitest` | 5.1.0 | `test.projects` |
| `msw` | 3.0.6 | Tests of the real `fetch` path |
| `publint` | 0.3.25 | |
| `@arethetypeswrong/cli` | 0.18.5 | `--profile node16` (decision D5) |
| `@changesets/cli` | 3.0.3 | |
| `@biomejs/biome` | 2.6.8 | Lint and format (decision D1) |
| `@types/node` | 22.x | Root tooling and scripts only; never in core, gateway or facade packages |

Record the spike results (ROADMAP §3.1) here once they are known.

### 8.2 Root `package.json`

```jsonc
{
  "name": "bawaba-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.21.0",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "build": "pnpm -r --filter \"./packages/*\" build",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome format --write .",
    "check:packages": "pnpm -r --filter \"./packages/*\" check",
    "check:deps": "node scripts/check-deps.mjs",
    "check:secrets": "node scripts/check-no-secrets.mjs",
    "smoke": "node scripts/smoke/run.mjs",
    "ci": "pnpm lint && pnpm typecheck && pnpm check:deps && pnpm check:secrets && pnpm test && pnpm build && pnpm check:packages && pnpm smoke",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "pnpm build && changeset publish"
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "catalog:", "@biomejs/biome": "catalog:", "@changesets/cli": "catalog:",
    "@types/node": "catalog:", "msw": "catalog:", "publint": "catalog:", "tsdown": "catalog:",
    "typescript": "catalog:", "vitest": "catalog:"
  }
}
```

### 8.3 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "examples/*"

catalog:
  typescript: 7.0.2
  vitest: 5.1.0
  tsdown: 0.23.7
  msw: 3.0.6
  publint: 0.3.25
  "@arethetypeswrong/cli": 0.18.5
  "@changesets/cli": 3.0.3
  "@biomejs/biome": 2.6.8
  "@types/node": 22.x          # confirm the exact pin in spike A2

strictPeerDependencies: true   # setting name confirmed in spike A2
```

Commit `pnpm-lock.yaml`. Internal dependencies use `workspace:^`, which pnpm rewrites to a real range on publish. Turborepo is optional; add it if CI build time passes about five minutes.

### 8.4 TypeScript

These options must be confirmed under TS 7 in spike A3.

- **`tsconfig.base.json`:**
  - strictness: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`;
  - modules: `module` and `moduleResolution` set to `nodenext`; `target: es2023`;
  - emit: `verbatimModuleSyntax`, `isolatedDeclarations`, `declaration`, `composite`.
- **Core, gateway and facade packages:**
  - `types: []`, so they get no Node types and a stray Node global fails type-checking;
  - Web API types (`fetch`, `Response`, `crypto.subtle`, `TextEncoder`) come from `lib: ["es2024", "dom"]`, or from a minimal web-types dev dependency if `dom` lets browser-only globals through. Settle this in spike A3.
- **Scripts and tests:** may use `@types/node`.
- **Root `tsconfig.json`:** `files: []`, plus references to the ten packages. `pnpm typecheck` runs `tsc -b`.

### 8.5 Vitest and Changesets

- **`vitest.config.ts`:** `test.projects: ["packages/*"]`, with the `v8` coverage provider. Thresholds are turned on once core is implemented.
- **`.changeset/config.json`:**

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["bawaba", "@bawaba/*"]],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": { "version": false, "tag": false }
}
```

The fixed group keeps all versions in step during `0.x`. At `1.0`, the gateway packages switch to independent versions.

### 8.6 Package template

```text
packages/<name>/
├── src/index.ts            (+ src/webhooks.ts for gateway packages)
├── test/index.test.ts      (+ test/contract/ for sandbox tests)
├── package.json
├── tsconfig.json           extends ../../tsconfig.base.json; references its workspace dependencies
├── tsdown.config.ts        entries index (+ webhooks); format ["esm", "cjs"]; dts: true
└── README.md               purpose, unofficial notice, capability table, status
```

Placeholder rule for the scaffold: each package exports only a `VERSION` constant (plus `GATEWAY` for gateway packages) and one test. No gateway endpoint, field or signature recipe goes into code before that gateway's build day.

```jsonc
// packages/paymob/package.json (excerpt)
{
  "name": "@bawaba/paymob",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "description": "Paymob client for Bawaba. Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.",
  "engines": { "node": ">=22.12" },
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./webhooks": { "...": "same shape" }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": { "build": "tsdown", "check": "publint && attw --pack . --profile node16" },
  "dependencies": { "@bawaba/core": "workspace:^" },
  "devDependencies": { "@bawaba/testing": "workspace:^" },
  "repository": { "type": "git", "url": "…", "directory": "packages/paymob" },
  "publishConfig": { "access": "public", "provenance": true }
}
```

| Package | Entries | `dependencies` | Workspace dev dependencies |
|---|---|---|---|
| `@bawaba/core` | `.`, `./conformance` (optional peer: `vitest`) | none | none |
| each of the seven gateway packages | `.`, `./webhooks` | `@bawaba/core` | `@bawaba/testing` |
| `bawaba` | `.`, plus `./paymob` … `./tap` | core and all seven gateway packages | `@bawaba/testing` |
| `@bawaba/testing` | `.`, plus one subpath per gateway | `@bawaba/core` | none |

All packages start at `0.0.0`; the first changeset sets the version.

## 9. Enforcement scripts

- **`scripts/check-deps.mjs`** fails when:
  - a gateway package depends on another gateway package;
  - core, a gateway package or the facade declares a runtime dependency outside `@bawaba/*`, other than the Vitest optional peer on `./conformance`;
  - `@bawaba/testing` depends on anything other than core;
  - any source file in core, a gateway package or the facade imports a `node:` module, or a bare Node built-in (`crypto`, `buffer` and so on);
  - a package README or `description` lacks the unofficial notice.
- **`scripts/check-no-secrets.mjs`** fails if a fixture or source file contains anything that looks like:
  - a real gateway key (for example `sk_live_` or long high-entropy strings in key fields);
  - a full card number that passes the Luhn check;
  - an unscrubbed email or phone number in a fixture.
- **`scripts/smoke/run.mjs`** packs every package, installs the tarballs into temporary ESM and CJS consumers, and imports every entry point.

## 10. Fixtures

- **Location:** root `fixtures/<gateway>/` is the single source of truth. `@bawaba/testing` copies the fixtures into its `dist/` at build time, so nothing is committed twice.
- **Format:** one JSON file per scenario, with these fields:
  - `gateway`, `scenario`, `description`;
  - `source` (`"sandbox"` or `"synthetic"`) and `recordedAt`;
  - the test `secret`, the `signedString` and the `expectedSignature`;
  - `request`: `{ rawBody (exactly as received), headers, query }`.
- **Scrubbing:**
  - Replace real keys, card BINs and last-4 digits, names, emails, phones and merchant IDs with clearly fake values.
  - Record the sandbox account's alias, not its ID.
  - Re-sign the scrubbed payload with the **test** secret.
- **Proof rule:** only `source: "sandbox"` fixtures can move a capability from `beta` to `supported`.

## 11. CI/CD and repository settings

- **`ci.yml`** runs on pushes to `main` and on all PRs, with `permissions: contents: read`.
  - **Matrix:** Node 22.12 (pinned exactly), 24 and 26 on `ubuntu-latest`, plus `windows-latest` on Node 24.
  - **Steps:** checkout → `pnpm/action-setup` → `setup-node` with the pnpm cache → `pnpm install --frozen-lockfile` → `pnpm run ci`.
  - **Runtime-portability job:** import every package's ESM build under Bun and Deno, installed by their official setup actions. Any Node-only API fails it.
- **`contract.yml`** runs nightly and on `workflow_dispatch`, **never on `pull_request`**.
  - **Jobs:** seven independent jobs, one per gateway. Each is gated on a repository variable (`CONTRACT_PAYMOB`, `CONTRACT_KASHIER`, `CONTRACT_FAWRY`, `CONTRACT_GEIDEA`, `CONTRACT_PAYTABS`, `CONTRACT_PAYFORT`, `CONTRACT_TAP`).
  - **Secrets:** each job runs in its own GitHub environment holding only that gateway's secrets, so one sandbox outage doesn't block the others.
  - **Command:** `vitest run --project <gateway> --dir test/contract`.
- **`release.yml`** runs on pushes to `main`.
  - `changesets/action` opens the "Version packages" PR.
  - After that PR merges, the publish job runs in the protected `npm-publish` environment (required reviewers; `permissions: id-token: write, contents: write`) and runs `pnpm release`.
  - It stays dormant until the trusted publishers are configured.
- **`dependabot.yml`:** weekly, for Actions and root dev dependencies, with catalog bumps grouped into one PR.
- **GitHub settings:**
  - branch protection on `main`;
  - the `npm-publish` environment;
  - seven contract-test environments (about 25–35 secrets in total);
  - Dependabot;
  - private vulnerability reporting;
  - `CODEOWNERS`.
- **npm settings:**
  - the `@bawaba` org with 2FA enforced;
  - trusted publishing (OIDC) configured **separately for each of the ten packages** (plus the three adapters later);
  - possibly a one-time `0.0.0` placeholder publish per name, if npm requires a package to exist before a trusted publisher can be added (Uncertain; decision D7).

## 12. Validation tooling (`tools/`, never published)

1. **Webhook receiver:** a permanent public HTTPS endpoint, either a Cloudflare Worker with KV or a Vercel function (free tier).
   - It stores the raw callbacks (body bytes, headers, query) for CI to fetch.
   - Each sandbox is configured to call it.
   - It never stores secrets.
2. **Local tunnel** (cloudflared or ngrok), for interactive capture.
3. **Playwright (dev dependency only)**, to drive hosted pages, 3DS challenges, the Amazon Payment Services form POST and Geidea's JS checkout. Gateways may block headless browsers (Uncertain); the fallback is a documented manual capture run before each release.
4. **Fixture recorder and scrubber:** saves a scenario's request, response and callback, scrubs it (section 10) and re-signs it with a test secret.

## 13. Uncertainty register seed

`docs/uncertainty-register.md` has the columns *ID, gateway, item, source label, how to confirm, status, date confirmed, evidence link*.

**Gateway rows:** seed one row from every entry in the "Open questions" table of each gateway spec file. Keep the IDs: PMB, KSH, FWY, GDA, PTB, APS and TAP.

**Cross-cutting rows (prefix GEN):**

| ID | Question |
|---|---|
| GEN-01 | Whether `fetch` errors distinguish "never sent" from "sent" |
| GEN-02 | The npm trusted-publishing bootstrap (decision D7) |
| GEN-03 | IQD's exponent per gateway |
| GEN-04 | TS 7 compatibility with tsdown declarations (spike A4) |

## 14. Sources

- **Gateway docs:** listed at the end of each gateway spec file.
- **Sarraf:** [repository](https://github.com/muhammedalaa1/sarraf), read at commit `9e4bc8f`; [npm](https://www.npmjs.com/package/@sarrafjs/core).
- **PayKernel** (Secondary): [npm](https://www.npmjs.com/package/@paykernel/core) and [GitHub](https://github.com/aashahin/paykernel).
- **Tap's official SDK:** [`@tap-payments/node`](https://www.npmjs.com/package/@tap-payments/node).
- **Paymob plugin CVEs:** [CVE-2026-87978](https://app.opencve.io/cve/CVE-2026-87978) and [CVE-2026-15205](https://app.opencve.io/cve/CVE-2026-15205).
- **CBE payment-service regulation:** [Baker McKenzie summary](https://insightplus.bakermckenzie.com/bm/banking-finance_1/egypt-new-regulation-on-payment-solutions).
- **Stripe availability** (Secondary): [Shopify community](https://community.shopify.com/t/i-m-from-egypt-and-i-cant-add-a-payment-method/169088), [Dodo Payments](https://dodopayments.blogspot.com/2026/04/stripe-supported-countries-2026-and.html), [Stripe UAE launch](https://stripe.com/es-gr/newsroom/news/stripe-launches-uae); confirm on [stripe.com/global](https://stripe.com/global).
