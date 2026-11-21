# Bawaba: roadmap

*Last updated 17 November 2026. This roadmap replaces all earlier plan documents.*

This document says **when and how** Bawaba gets built: the two-week schedule, the day-1 setup, the milestones, the team, the prerequisites, the decisions and the risks. What is being built is in [PRODUCT_REQUIREMENTS.md](../requirements/PRODUCT_REQUIREMENTS.md), [PRODUCT_SPECIFICATIONS.md](../specifications/PRODUCT_SPECIFICATIONS.md) and [TECHNICAL_SPECIFICATIONS.md](../specifications/TECHNICAL_SPECIFICATIONS.md).

---

## 1. Summary

- **Who:** the lead, working **solo** and building with **Claude Code**. Up to two more developers may join later (section 8).
- **Scope:** **all seven gateways from the start**: Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services and Tap. There are no waves; no gateway is deferred or released without the others.
- **Two-week target:** `0.1.0` of all ten packages (core, seven clients, facade, testing) on the npm **`next`** tag. Every operation not yet proven in a sandbox is marked `beta`.
- **Then `1.0.0`:** once every gateway's verifiers are proven against real callbacks and an outside reviewer has checked the security-critical code. That depends on gateway onboarding, not on coding speed.
- **Critical path:** sandbox access. Request all seven on day 1.

## 2. The two-week build

### 2.1 What two weeks can and cannot deliver

With Claude Code, writing the code is no longer the bottleneck. Drafting the core, all seven clients and the facade in two weeks is realistic. Three things are **not** sped up by any tool:

| Bottleneck | Why it doesn't shrink | Consequence |
|---|---|---|
| **Gateway onboarding** | Fawry, Geidea and Amazon Payment Services issue credentials through their own teams, which can take days to weeks (Uncertain) | Some gateways won't have a sandbox by day 14 |
| **Real-world proof** | A verifier is `supported` only once it verifies a **real captured callback**. Code can match the docs and still be wrong where the docs are wrong (the Geidea timestamp, PayTabs encoding, Fawry field order). | Every unconfirmed operation ships as `beta` |
| **Review of security-critical code** | Signature verifiers, redaction and the no-retry paths must be read and understood line by line by a human, whoever wrote them | Budget review time every day, not only on the last day |

**What each stage delivers:**
- **By day 14:** `0.1.0` on `next`, containing core, the seven clients, the facade and the testing package, plus one minimal example. Every gateway with a sandbox by then is validated; everything else is `beta`.
- **After day 14, before 1.0:** validation of the remaining gateways, the outside security review, reconciliation guides and the Paymob subscription verifier.
- **After 1.0:** the framework adapters, the docs site, multi-gateway examples and the PayKernel source read.

### 2.2 Day-by-day schedule (solo, full days)

| Day | Build (with Claude Code) | In parallel (only the lead can do these) |
|---|---|---|
| **1** | Toolchain spike and full scaffold (section 3); CI green | Create the project email and the npm org; the GitHub repository lives under the lead's own account until contributors join. **Request sandbox access from all seven gateways and contact their partner teams.** |
| **2** | `@bawabajs/core`: request pipeline, retry and no-retry policy, errors with `code`, `Money` and `Currency`, crypto (SHA-256/512, HMAC, hex/base64, constant-time compare) | Review every core file; chase sandbox replies |
| **3** | `@bawabajs/core`: idempotency store, capability levels, webhook input helpers, redaction, conformance suite. `@bawabajs/testing` skeleton. Webhook receiver and fixture recorder/scrubber in `tools/`. | Deploy the webhook receiver; register its URL in every sandbox that exists |
| **4** | `@bawabajs/fawry` (the most unusual; it shapes the core) | Validate any sandbox that has arrived |
| **5** | `@bawabajs/payfort` (Amazon Payment Services: form POST, phrase-wrapped hash) | Same |
| **6** | `@bawabajs/paymob` | Paymob validation if the keys exist: capture transaction, redirect and token callbacks |
| **7** | `@bawabajs/kashier` | Kashier validation: decide the primary checkout flow |
| **8** | `@bawabajs/geidea` | Settle the timestamp format against a real session, if credentials exist |
| **9** | `@bawabajs/paytabs` | Confirm the regional host and auth header against a real test profile |
| **10** | `@bawabajs/tap` | Prove `reference.idempotent` replay in the Tap sandbox |
| **11** | `bawaba` facade: types from the real overlap, four result kinds, statuses, dedupe keys, `webhooks.verify/inspect` | Paper design check: does Stripe fit the facade types? |
| **12** | Facade finish; `examples/minimal`; per-package READMEs with the capability table and the unofficial notice | Re-run the conformance suite across all seven |
| **13** | Hardening: `/code-review` on each package; fix the findings; secret scan; confirm there are no `node:` imports and no retried mutations | Line-by-line review of all seven verifiers |
| **14** | Changesets; publish `0.1.0` to `next`; update `docs/logs/validation.md` and `docs/logs/uncertainty.md`; set every unproven operation to `beta` | Publish the status table: which gateways are proven and which are beta |

A gateway's day is for writing its client. **Its validation happens whenever its credentials arrive**, even after day 14. Its `beta` flags are then lifted in a patch release.

### 2.3 How to work with Claude Code

The full rules are in [.claude/CLAUDE.md](../../.claude/CLAUDE.md). In short:
- **The gateway spec file is the source of truth.** Claude builds each gateway from its file in [specifications/gateways/](../specifications/gateways/). When a sandbox contradicts it, fix the file first, then the code.
- **Test vectors first.** Write each verifier's test from a documented or captured example before the implementation. The same session must never generate both the signature code and its expected values from scratch.
- **One gateway per session, branch and pull request.** Keep diffs small and reviewable.
- **Review discipline:** read every verifier and money-moving method before merging. Run `/code-review` on each PR, and `/security-review` before publishing.
- **Commit the validation evidence** (scrubbed fixtures, validation-log entries) in the same PR as the code it proves.

## 3. Day 1: study and scaffold

### 3.1 Toolchain spike

Prove the build on the first package (`@bawabajs/core`, commit 8) before copying it to the others. Nothing is committed until its check passes. Record the results in TECHNICAL_SPECIFICATIONS §8 (commit 27).

| # | Check | Pass condition |
|---|---|---|
| A1 | Update pnpm to 12.21.0 and set `packageManager` | `pnpm --version` matches the pin |
| A2 | Settings and catalog in `pnpm-workspace.yaml` (`catalog:`, `strictPeerDependencies`, `onlyBuiltDependencies` if needed) | `pnpm install --frozen-lockfile` passes; `catalog:` resolves |
| A3 | TS 7 type-check with project references (`tsc -b` from a root solution file); the Web API types source without `@types/node` | Errors in a referenced package are reported; incremental rebuild works; a Node global in a core file fails type-checking |
| A4 | tsdown 0.23.7 dual build with declarations under TS 7 and `isolatedDeclarations: true` | `dist/` has `index.js`, `index.cjs`, `index.d.ts` and `index.d.cts`, and the same for `./webhooks` |
| A5 | `publint` and `attw --pack . --profile node16` | Both pass |
| A6 | Vitest 5 with `test.projects: ["packages/*"]` | Each package's tests run under its own project name |
| A7 | `pnpm pack` with `workspace:^` and `catalog:` | The packed `package.json` has real version ranges |
| A8 | CJS and ESM consumer imports of the packed tarball | `require` and `import` both work on Node 22.12 and 24 |
| A9 | Changesets fixed group | `changeset version` bumps every package together |

If A4 fails, fall back to tsup 9, or emit declarations with `tsc` and bundle the JS with tsdown. Record which one was chosen.

### 3.2 Reference checks (about two hours)

| # | Read | Extract |
|---|---|---|
| B1 | Sarraf's `.changeset/config.json`, `scripts/check-no-secrets.ts`, `scripts/record-fixtures.ts`, fixture JSON, `packages/core/src/conformance.ts`, and CI workflows | Ideas for the fixture format, secret scanning and conformance layout. Design only; no code is copied. |
| B2 | Changesets and npm docs on trusted publishing | Whether a first manual publish is needed (decision D7); the setup steps for each package |
| B3 | `pnpm/action-setup` and `actions/setup-node` current majors; OIDC `id-token: write` | Exact snippets for `ci.yml` and `release.yml` |

### 3.3 Account actions (the lead)

- Create the project email address that every gateway account is registered under (9.1).
- Create the `@bawabajs` npm org (with 2FA enforced). The repository lives under the lead's own GitHub account (`mohamedzait20003/Bawaba`) until contributors join; then it moves to a `bawaba` GitHub org (GitHub redirects the old URL).
- Request sandbox or test access from all seven gateways, and contact each one's partner or developer-relations team.

### 3.4 Day-1 commit plan

The scaffold is built as a series of small commits on `main`. Each commit leaves the repository working: its check passes before it is committed.

**Commit rules:**
- **Messages:** Conventional Commits (`type(scope): summary`).
- **Trailers:** a DCO `Signed-off-by` (`git commit -s`), plus the Claude co-author trailer when Claude wrote the commit.
- **The spike:** the toolchain spike (3.1) runs inside these commits rather than in a throwaway folder. A check that fails is fixed, or worked around and recorded, before the commit is made. Commit 27 records the results.

The target tree and file contents are in TECHNICAL_SPECIFICATIONS §7–§11.

| # | Commit | Contents | Check before committing |
|---|---|---|---|
| 1 | `chore: initialize repository` | `git init -b main`; `.gitignore`, `.gitattributes` (LF), `.editorconfig`, `.node-version` | `git status` shows only these files |
| 2 | `docs: add requirements, specifications and roadmap` | `docs/requirements`, `docs/specifications` (including `gateways/`), `docs/roadmap` | Links resolve |
| 3 | `docs: add Claude Code project rules` | `.claude/CLAUDE.md` | — |
| 4 | `chore: add MIT licence` | `LICENSE` | — |
| 5 | `build: set up pnpm workspace with pinned toolchain` | Root `package.json` (`packageManager: pnpm@12.21.0`), `pnpm-workspace.yaml` (catalog, `strictPeerDependencies`), `pnpm-lock.yaml` | A1, A2: `pnpm install --frozen-lockfile` passes |
| 6 | `build: add TypeScript and Biome configuration` | `tsconfig.base.json`, root `tsconfig.json`, `biome.json` | `pnpm lint` passes |
| 7 | `test: configure Vitest projects` | `vitest.config.ts` | `pnpm test` runs, with no projects yet |
| 8 | `feat(core): scaffold @bawabajs/core` | `packages/core` with `.` and `./conformance` | A3–A6: build, `publint`, `attw`, typecheck and tests pass |
| 9 | `feat(testing): scaffold @bawabajs/testing` | `packages/testing` | Same checks |
| 10–16 | `feat(<gateway>): scaffold @bawabajs/<gateway>`, one commit each for paymob, kashier, fawry, geidea, paytabs, payfort and tap | `packages/<gateway>` with `.` and `./webhooks` | Same checks |
| 17 | `feat(bawaba): scaffold the facade with gateway subpaths` | `packages/bawaba` with `.` plus seven subpaths | Same checks, for all ten packages |
| 18 | `build: add dependency guard` | `scripts/check-deps.mjs` | Passes, and fails on a forbidden dependency or a `node:` import added on purpose |
| 19 | `build: add secret scanner` | `scripts/check-no-secrets.mjs` | Passes, and fails on a fake live key added on purpose |
| 20 | `test: add ESM and CJS smoke consumers` | `scripts/smoke/` | A7, A8: `pnpm smoke` imports all ten packages both ways |
| 21 | `build: configure Changesets fixed release group` | `.changeset/` | A9: a snapshot version bumps all ten together, then is reverted |
| 22 | `test: add fixture folders and scrubbing rules` | `fixtures/<gateway>/.gitkeep`, `fixtures/README.md` | — |
| 23 | `docs: seed validation log and uncertainty register` | `docs/validation-log.md`, `docs/uncertainty-register.md` (every open question from the gateway files, plus GEN) | — |
| 24 | `docs: add README, contributing guide and security policy` | `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Every README and description has the unofficial notice (checked by `check-deps`) |
| 25 | `ci: add CI, contract and release workflows` | `.github/workflows/ci.yml`, `contract.yml`, `release.yml` | YAML parses; `pnpm run ci` passes locally |
| 26 | `chore: add Dependabot and CODEOWNERS` | `.github/dependabot.yml`, `.github/CODEOWNERS` | — |
| 27 | `docs: record toolchain spike results` | TECHNICAL_SPECIFICATIONS §8 notes; ticks in 3.5 | `pnpm run ci` passes from a clean install |

**After commit 27 (the lead):** create the GitHub repository, add it as `origin`, push `main`, and confirm that `ci.yml` is green on every matrix entry and that `contract.yml` runs from `workflow_dispatch` as a no-op.

### 3.5 Day-1 definition of done

Status on 17 November 2026, after the day-1 commits:

- [x] `pnpm run ci` passes locally on Windows (Node 24.16.0). The scripts also run on Node 22.12.0.
- [ ] `pnpm run ci` passes in GitHub Actions on Node 22.18, 24 and 26, and the runtime-floor job passes on Node 22.12 *(first push: 22.12 failed because tsdown needs 22.18; Node 24, 26, Windows and Bun/Deno passed)*.
- [x] All ten packages build to ESM and CJS with types; `publint` and `attw` are clean.
- [x] The smoke consumers import every package with both `require` and `import`; every entry point also imports under Deno and Bun.
- [x] The dependency guard enforces the one-way dependency direction, zero dependencies and no `node:` imports.
- [x] No gateway endpoint, field name or signature recipe exists in code yet.
- [x] The uncertainty register is seeded, and the validation log exists.
- [x] The lockfile is committed, and pnpm is pinned through `packageManager`.
- [x] The GitHub repository exists (`mohamedzait20003/Bawaba`, the lead's own account) and `main` is pushed.
- [ ] `main` is protected by a ruleset, and the `npm-publish` environment and repository variables exist *(the lead; TECHNICAL_SPECIFICATIONS §11)*.
- [x] The `@bawabajs` npm org exists *(created 18 November 2026; the `bawaba` scope was taken, decision D8)*.
- [ ] Sandbox requests have been sent to all seven gateways *(the lead)*.

## 4. Day 2: `@bawabajs/core` foundations

**Goal:** the half of core that every gateway client needs first: errors, money, encoding, crypto and the request pipeline with its retry rules (TECHNICAL_SPECIFICATIONS §3.1–§3.6). Day 3 adds idempotency, capabilities, webhook input helpers, redaction and the conformance suite.

### 4.1 Before starting (the lead)

1. Push the commits already on `main`.
2. Create the `npm-publish` environment and the `NPM_PUBLISH_ENABLED` / `CONTRACT_*` variables.
3. Check that CI is green, including the new runtime-floor job.
4. Turn on the `main` ruleset (TECHNICAL_SPECIFICATIONS §11).

### 4.2 How the day runs

- **Branch and PR:** all work goes on the branch `feat/core-foundations` and ends as **one pull request**, merged with "Rebase and merge" so that every commit below lands on `main`.
- **Every commit passes `pnpm run ci`** before it is made.
- **Tests first:** each commit writes its tests before the code.
- **Expected values for crypto and encoding** come only from published standards (FIPS 180-4, RFC 4231, RFC 4648), never from our own code.
- **Code style:** no `node:` imports in `packages/core/src`; Sonar-clean code; minimal comments.

### 4.3 Day-2 commit plan

| # | Commit | Contents | Tests (written first) |
|---|---|---|---|
| 1 | `feat(core): add error classes with stable codes` | `src/errors.ts`: `BawabaError` (`code`, `gateway`, `cause`), `ApiError` (`status`, `headers`, `requestId`, `raw`) with `BadRequestError`, `AuthenticationError`, `PermissionError`, `NotFoundError`, `RateLimitError`, `GatewayServerError`; plus `ConnectionError`, `OutcomeUnknownError` (`operation`, `merchantReference`), `SignatureVerificationError`, `CapabilityError`, `IdempotencyError`, `ConfigError`. **No `retryable` property on any error** (the Sarraf trap). `toJSON()` keeps `name`, `code`, `gateway` and `status` and leaves out `raw` and `headers` (full redaction arrives on Day 3). | Every class and code from PRODUCT_SPECIFICATIONS §4; `instanceof` chains; `code` survives `JSON.stringify`; `cause` kept; no `retryable` anywhere |
| 2 | `feat(core): add currencies and exact money conversion` | `src/money.ts`: the `Currency` union and exponent table (2 or 3 decimals); `isCurrency`; `Money` validation (non-negative safe integer `minor`); `toDecimalString(money, exponent?)` and `fromDecimalString(text, currency, exponent?)` using string and `BigInt` math. Accepted text: `^\d+(\.\d+)?$` only. | Every currency, 2 and 3 decimals; `250` → `"250.00"`; KWD `1500` ↔ `"1.500"`; rejects `"1.005"` for EGP, floats, `"1e3"`, `"+1"`, `"1."`, `".5"`, whitespace, negatives, unsafe integers; round-trips at `Number.MAX_SAFE_INTEGER` |
| 3 | `feat(core): add byte encoding helpers` | `src/encoding.ts`: UTF-8 (`TextEncoder`/`TextDecoder`), lowercase hex, base64. Hand-written, with no `Buffer`; `btoa` is avoided because of its Latin-1 limits. | The RFC 4648 §10 base64 vectors; hex of all 256 byte values; odd-length or invalid hex rejected; UTF-8 for Arabic text |
| 4 | `feat(core): add Web Crypto hashing, HMAC and constant-time compare` | `src/crypto.ts`: `sha256`/`sha512` and `hmacSha256`/`hmacSha512` over `string \| Uint8Array` (raw bytes hashed as is), with hex or base64 output; `timingSafeEqual(a, b)` (length check, then an XOR over every byte); `safeEqualHex` and `safeEqualBase64` that decode before comparing | The FIPS 180-4 `"abc"` and empty-string digests; RFC 4231 test cases 1–7 for HMAC-SHA-256 and HMAC-SHA-512; uppercase and lowercase hex are equal; a length mismatch is false; a malformed input is false and never throws |
| 5 | `feat(core): add the request pipeline` | `src/http/request.ts`: an injectable `fetch`; per-attempt timeout via `AbortSignal.timeout` combined with the caller's signal through `AbortSignal.any`; URI-encoded path parameters; query strings; JSON and form bodies; default and custom headers; `onRequest`/`onResponse` hooks (method, URL without the query, status, duration; never bodies); response parsing (JSON, text, or empty); `requestId` taken from a configurable header list; non-2xx statuses mapped to `ApiError` subclasses | A fake `fetch` records every request; path injection is encoded; hooks never see bodies or headers; the caller's abort is respected; a timeout fires; status mapping for 400/401/403/404/429/5xx. One MSW test covers the real-`fetch` path. |
| 6 | `feat(core): enforce read retries and the no-retry rule for mutations` | `src/http/retry.ts`: the TECHNICAL_SPECIFICATIONS §3.2 table. Reads retry at most twice on network errors, 5xx and 429, with exponential backoff and full jitter, and honour `Retry-After` (capped). **Mutations never retry:** a timeout, network error or 5xx gives `OutcomeUnknownError`; a 4xx gives the definite `ApiError`. Clock, sleep and random are injectable for tests. | The full table: **a 5xx on a mutation makes exactly one `fetch` call and throws `OutcomeUnknownError`**; the same for a timeout and a network error; 429 on a mutation is not retried; a read retries twice then throws; `Retry-After` is respected; the jitter stays within its bounds |
| 7 | `test(core): enforce coverage for the core foundations` | Coverage thresholds of 100% for lines and branches on the new core files in `vitest.config.ts`; `pnpm run ci` runs the tests with `--coverage` | The CI pipeline fails below the threshold |
| 8 | `docs: record Day 2 decisions` | TECHNICAL_SPECIFICATIONS §3 and PRODUCT_SPECIFICATIONS §4 updated with the exact names chosen; GEN-01 notes (how "never sent" is detected); a changeset for `@bawabajs/core` (`minor`) | — |

### 4.4 Decisions to settle during the day

Record them in commit 8.

- **Default timeout:** 30 s per attempt (Proposal).
- **`Retry-After` cap:** 5 s, so a read never blocks longer than its timeout budget (Proposal).
- **Default request-ID headers:** `x-request-id` and `request-id`. Each client can add its own.
- **"Never sent" (GEN-01):** only configuration errors raised before `fetch` is called count as never sent. Every `fetch` rejection on a mutation is an unknown outcome.
- **Negative money:** rejected. Refunds carry a positive amount; direction comes from the operation.

### 4.5 In parallel (the lead)

- Review every core file in the PR, line by line, with extra care on commits 4 and 6.
- Chase sandbox replies, and create the `@bawabajs` npm org.

### 4.6 Day-2 definition of done

- [x] The PR is merged into `main` with CI green on every check.
- [x] Core exports errors, money, encoding, crypto and `request()`, still with zero dependencies and no Node built-ins (`check-deps` passes).
- [x] Every crypto and encoding expected value cites its standard in the test name.
- [x] A 5xx, timeout or network error on a mutation is proven to make exactly one call and to throw `OutcomeUnknownError`.
- [ ] `/code-review` has been run on the PR, and its findings are fixed or explained.

## 5. Day 3: `@bawabajs/core` completion, testing skeleton and capture tooling

**Goal:** the rest of core (TECHNICAL_SPECIFICATIONS §3.3 and §3.7–§3.10), the `@bawabajs/testing` skeleton, and the `tools/` that capture real callbacks (§12), so that Day 4 can start on Fawry with nothing missing underneath.

### 5.1 How the day runs

The same rules as Day 2 (4.2), on the branch `feat/core-completion`. Nothing here contains a gateway endpoint, field or signature recipe: those arrive on each gateway's day.

### 5.2 Day-3 commit plan

| # | Commit | Contents | Tests (written first) |
|---|---|---|---|
| 1 | `docs: plan Day 3 (core completion)` | This section | — |
| 2 | `feat(core): add redaction for secrets and personal data` | `src/redaction.ts`: a `Redactor` holding the configured secrets (never shown by `toJSON`, `String` or Node's `inspect`), `redact(text)` in one pass, `redactValue(value)` that also masks sensitive keys (credentials, card and billing data); `isSensitiveKey`. `ApiError.headers` and `raw` become non-enumerable, so logging an error shows neither. The pipeline redacts the hook URL through `config.redactor`. | Each secret and its URL-encoded form replaced; overlapping secrets; a replacement is never re-matched; nested and cyclic values; every key family; `JSON.stringify`, `String` and `inspect` of a redactor and of an `ApiError` show no secret |
| 3 | `feat(core): add capability levels and the beta gate` | `src/capabilities.ts`: `CapabilityLevel`, `defineCapabilities` (validated, frozen), `assertCapability` (beta needs `allowBeta: true`; unsupported and undeclared always throw) | Every level × `allowBeta`; an undeclared name fails closed; invalid levels rejected |
| 4 | `feat(core): add idempotency claims with an in-memory store` | `src/idempotency.ts`: the §3.3 `IdempotencyStore` interface, `MemoryIdempotencyStore`, `stableStringify`, `fingerprint` and `runIdempotent` | Replay; reuse with other parameters; a held key; **a 5xx on a mutation keeps the claim**; a 4xx and the never-sent errors release it; a failing store never hides a successful payment |
| 5 | `feat(core): add webhook input helpers` | `src/webhooks.ts`: `normalizeWebhookRequest` (raw body only, lowercase headers, first query values), `verifyWebhook` (verify, then parse; fails closed), `parseJsonObject`, `parseFormBody`, `requireEventType`, `pickSigned` | A parsed object instead of the raw body is refused; string and bytes give the same text; a throwing or false verifier is a `SignatureVerificationError`; the parser never runs before verification succeeds |
| 6 | `feat(core): add the conformance suite` | `src/conformance.ts`: `runConformanceSuite(subject)` for Vitest, over check functions that return problems (capabilities, money round-trips, webhook tampering, raw-body input, mutations, leaks, `inspect`) | A well-behaved example client passes; each kind of broken client is reported |
| 7 | `feat(testing): add the testing skeleton` | `fakeFetch` (records calls, scripted responses), `jsonResponse`, `webhookRequest`, `parseFixture` (the `fixtures/README.md` format) | Each helper; fixtures with a real-looking secret or an unknown source are rejected |
| 8 | `feat(tools): add the webhook receiver and local capture server` | `tools/webhook-receiver/` (Cloudflare Worker with KV: stores raw callbacks, read back with a bearer token) and `tools/capture-server.ts` (local, for a tunnel) | Capture and read-back; wrong token; unknown gateway; body size limit |
| 9 | `feat(tools): add the fixture scrubber and recorder` | `tools/fixtures/scrub.ts` (byte-preserving scrub of JSON, form and query values) and `record.ts` (writes `fixtures/<gateway>/` only when that gateway has a re-signing signer) | Names, emails, phones, addresses, cards, masked PANs, credentials and merchant IDs replaced; every other byte unchanged |
| 10 | `test(core): enforce coverage for the core completion` | The 100% thresholds extended to the new core files | — |
| 11 | `docs: record Day 3 decisions` | TECHNICAL_SPECIFICATIONS §3.3, §3.7–§3.10 and §12, and PRODUCT_SPECIFICATIONS §2 and §8, updated with the names chosen; changesets for core and testing | — |

### 5.3 Decisions to settle during the day

Record them in commit 11.

- **Idempotency key:** a non-empty string of at most 255 characters (Proposal). The fingerprint covers the gateway and operation as well as the parameters, so one key can't be reused across operations.
- **Completed records** in the memory store expire after 24 hours; held records never expire, because only `reconcile` may release them.
- **Which errors release a claim:** a 4xx `ApiError`, and the never-sent errors (`InvalidArgumentError`, `ConfigError`, `CapabilityError`). Every other error keeps it, which is the safe side.
- **Receiver:** a Cloudflare Worker (free tier) rather than a Vercel function, because KV gives storage with no database.

### 5.4 In parallel (the lead)

- Deploy the receiver (`tools/webhook-receiver/README.md`) and register its URL in the Paymob and Kashier sandboxes, then in each other sandbox as access arrives.
- Review every core file in the PR, with extra care on commits 4 and 5.

### 5.5 Day-3 definition of done

- [ ] The PR is merged into `main` with CI green on every check.
- [ ] Core exports idempotency, capabilities, webhook input helpers and redaction, and `@bawabajs/core/conformance` runs; still zero dependencies and no Node built-ins.
- [ ] A 5xx on a mutation is proven to keep the idempotency claim (Milestone 1 acceptance).
- [ ] The receiver is deployed and has captured at least one sandbox callback *(the lead)*.
- [ ] `/code-review` has been run on the PR, and its findings are fixed or explained.

## 6. Milestones

The milestones define what each stage must achieve. The two-week schedule compresses Milestones 1–3 into days 1–12. Milestone 0 runs throughout and continues after day 14, and Milestone 4 follows day 14.

### Milestone 0: Validation (all seven gateways, continuous from day 1)

Milestone 0 decides **what ships as `supported` and what ships as `beta`**.

**Tasks for all gateways:** capture real callbacks, reproduce every signature, and record the results in `docs/logs/validation.md` and `docs/logs/uncertainty.md`.

**Tasks per gateway:**
- **Paymob:**
  - diff the official Postman collections against the portal;
  - capture a real transaction POST, a redirect GET and a card-token callback;
  - decode the auth token's expiry;
  - test a duplicate `special_reference`.
- **Kashier:**
  - decide the primary checkout flow;
  - confirm the refund, void and capture paths;
  - capture `pay`, `refund` and failure webhooks;
  - reproduce the `signatureKeys` signature with strict RFC 3986 encoding;
  - observe the retry schedule by returning 500.
- **Fawry:**
  - read the official server-API pages;
  - confirm the charge, status v2 and notification v2 field lists;
  - reproduce the request and notification signatures;
  - complete a PayAtFawry reference payment in staging.
- **Geidea:**
  - settle the timestamp format and the `merchantReferenceId` rule;
  - capture a real callback;
  - check whether a plain redirect exists;
  - find the refund signature formula.
- **PayTabs:**
  - get the official regional host list;
  - confirm the auth header;
  - reproduce the IPN and return signatures, including `+` vs `%20`;
  - confirm partial refunds.
- **Amazon Payment Services:**
  - confirm which SHA types the dashboard offers;
  - reproduce the request signatures;
  - confirm that feedback is signed with the response phrase;
  - test the `maintenance_reference` retry behaviour;
  - complete an EGP or AED payment.
- **Tap:**
  - confirm the retrieve-charge path and the redirect parameters;
  - reproduce `hashstring` for charge, authorize and refund events;
  - prove `reference.idempotent` replay;
  - observe webhook retries.

| Element | Detail |
|---|---|
| Deliverables | The validation log; sanitized fixtures for each gateway; a capability table for each gateway |
| Acceptance | Every signature recipe reproduced from at least one real captured callback, for all seven gateways |
| Fallback | A gateway whose signatures can't yet be reproduced ships its verifier as `beta`. **It is not dropped.** |

### Milestone 1: Foundation (days 1–3)

| Element | Detail |
|---|---|
| Tasks | The scaffold (section 3); `@bawabajs/core` in full (TECHNICAL_SPECIFICATIONS §3); the `@bawabajs/testing` skeleton; the validation tooling in `tools/` |
| Acceptance | Core has full unit coverage of: the retry and no-retry paths, **including a 5xx on a mutation, which yields `OutcomeUnknownError` and keeps the idempotency claim**; idempotent replay, and rejection of a reused key with different parameters; error mapping; money conversion for 2- and 3-decimal currencies; the constant-time compare; every hash and encoding combination the seven gateways need. No secret appears in any log or error. `publint` and `attw` pass. |

### Milestone 2: All seven gateway clients (days 4–10)

| Element | Detail |
|---|---|
| Tasks | Each client's first-release resources (PRODUCT_SPECIFICATIONS §5.2) and verifiers, built from each gateway's spec file (`docs/specifications/gateways/`); each file's validation checklist defines its Milestone 0 work |
| Acceptance, for every gateway with a sandbox | Contract tests pass for a paid transaction and a partial refund, plus void and capture where supported; every captured callback verifies; changing any signed field fails verification; the conformance suite passes. Also: Tap's idempotent replay proven; an Amazon Payment Services `form_post` checkout and a Geidea embedded checkout completed in a real browser; a Fawry reference code paid in staging. |
| Fallback | A gateway without a sandbox still ships its client, with every unconfirmed operation set to `beta`. The release is never held back for one gateway. |

### Milestone 3: Unified facade (days 11–12)

| Element | Detail |
|---|---|
| Tasks | Normalized types from the actual overlap of the clients; every facade operation (PRODUCT_SPECIFICATIONS §3); status tables with `verified` flags; dedupe keys; acknowledgement helpers; status re-query; the Stripe paper check |
| Acceptance | The same example app switches between all seven gateways by changing one argument and handling the four result kinds. No gateway field is lost: everything is reachable through `raw` or the native client. |

### Milestone 4: Production readiness (after day 14, toward `1.0.0-rc`)

| Element | Detail |
|---|---|
| Tasks | The outside security review (redaction, verification order, dependency surface); a reconciliation guide for each gateway; retry-behaviour tests; full READMEs; the Paymob subscription verifier; the uncertainty register made public; the revisit of the Tap SDK question (TECHNICAL_SPECIFICATIONS §6.4) |
| Acceptance | No money-moving call is retried in any test path. Every gateway's verifiers are proven against real callbacks. A new developer can reach a verified sandbox payment and webhook on each gateway using only the README. |

### Milestone 5: Ecosystem (after 1.0)

| Element | Detail |
|---|---|
| Tasks | `@bawabajs/express`, `@bawabajs/nestjs` (a module with a raw-body-aware webhook guard) and `@bawabajs/next` (route-handler helpers); runnable examples; a docs site (Astro Starlight or VitePress); issue templates; outreach to each gateway's developer relations and to developer communities in Egypt and the Gulf |
| Candidates | Paymob subscriptions and QuickLinks; Kashier payment links and saved cards; more gateways by demand (MyFatoorah, Moyasar, HyperPay, Checkout.com); a facade-only `@bawabajs/stripe` |

## 7. After day 14: the path to 1.0

1. **Keep validating:** as each sandbox arrives, capture callbacks, add fixtures and lift `beta` flags in patch releases.
2. **Track proof publicly:** keep the public status table and the validation log current.
3. **Get an outside review:** find a security reviewer outside the team for the verifiers, redaction and the no-retry paths.
4. **Finish Milestone 4,** then publish `1.0.0-rc`, then `1.0.0` on `latest`.

There is no fixed date: 1.0 waits on the slowest gateway's onboarding and on the review.

## 8. Team

### 8.1 Roles

The lead holds every role until others join.

| Role | Responsibilities | When |
|---|---|---|
| **Lead maintainer** | Core, Fawry and Amazon Payment Services, the facade, releases, gateway relationships, final review of every verifier | From day 1 |
| **Developer 2** | Paymob, Kashier and Geidea; second reviewer for PayTabs and Tap | When they join |
| **Developer 3** | PayTabs and Tap; the validation tooling (receiver, Playwright, recorder); second reviewer for Paymob, Kashier and Geidea | When they join |
| **Security reviewer** | Independent review of the verifiers, redaction and the no-retry paths before 1.0. Must be someone outside the team. | Milestone 4 |
| **Gulf-based tester** (optional) | Access to Gulf merchant accounts and local methods (KNET, mada, Benefit) | Any time |

The ownership areas follow the signature families, so shared helpers are written once:
- **Track A**, HMAC over fixed or listed fields: Paymob, Kashier and Geidea.
- **Track B**, a hash with the secret appended or wrapped around: Fawry and Amazon Payment Services.
- **Track C**, raw-body and labelled-field HMAC plus server-side idempotency: PayTabs and Tap.

After day 14, the new developers' main work is **validation and hardening** (capturing callbacks, lifting `beta` flags, adapters, docs), not first drafts.

### 8.2 Working rules

- **`CODEOWNERS`:** each gateway package has an owner and a second reviewer from another track. No verifier change merges with only its author's approval.
- **`CONTRIBUTING.md`:** contributions are licensed under MIT; the fixture-scrubbing rules; a DCO sign-off (`git commit -s`); and Conventional Commit messages (`feat(paymob): …`). There is no separate contributor licence agreement.
- **Credentials:** nobody keeps gateway credentials on a personal machine longer than needed. CI secrets are the source of truth.
- **Coordination:** a short weekly call, plus a GitHub Project board with one column per milestone, showing blocked sandbox requests.

## 9. Prerequisites besides code

### 9.1 Gateway accounts

| Gateway | How test access is obtained | What may be needed |
|---|---|---|
| Paymob | Self-serve dashboard with test mode (Uncertain per region) | An Egyptian account for EG; separate accounts for KSA, UAE and Oman if those regions are tested |
| Kashier | Self-serve test mode | Egyptian merchant sign-up |
| Fawry | Staging credentials issued by Fawry's team | A request to its integration or sales team, possibly with a company profile; the longest lead time is expected here |
| Geidea | Credentials from its enablement team, or the portal ("Payment Gateway → Gateway Settings") | A merchant onboarding conversation per country |
| PayTabs | A test profile per region (Uncertain) | One profile per region, because each key is bound to one region |
| Amazon Payment Services | A sandbox through the merchant portal ("Merchant Management → Security Settings") | Sandbox sign-up; enabling the SHA type and the feedback URLs ("Technical Settings") |
| Tap | Self-serve `sk_test_…` keys (inferred) | Enabling local methods may need a request (Uncertain) |

- **Account holder (Proposal; confirm):** the lead registers as an individual developer **under a project email address**, not a personal one, so the accounts survive team changes. The other developers use the shared credentials through the CI environments.
- **If a gateway asks for a commercial registration** (possible for Fawry, Geidea and Amazon Payment Services):
  1. explain to its partner team that this is an open-source SDK, and ask for a developer sandbox;
  2. ask a merchant who already uses that gateway to share sandbox access;
  3. otherwise, ship that gateway as `beta` until access arrives.
- **Never use live accounts** for development or tests.
- **Sandbox terms:** check that each gateway allows nightly tests from public CI and the publication of scrubbed callbacks. If one doesn't, keep its fixtures in a private repository and publish only the signature test vectors.
- **Partner or developer-relations contacts:** Paymob, PayTabs, Tap and Geidea run partner programs (Secondary). A contact speeds up credentials and settles documentation contradictions.
- **Test data:**
  - test cards, including 3DS-challenge cards;
  - test wallet numbers;
  - a way to pay a Fawry reference code in staging;
  - at least one 3-decimal currency account (KWD or BHD).
- **Documentation packs:** official Postman collections or PDFs, wherever the public pages are incomplete (Fawry's portal, PayTabs' region page).

### 9.2 Legal and policy

- **Licence: MIT** (decided 17 November 2026):
  - it is short, permissive and the most familiar licence on npm;
  - the copyright line is "The Bawaba contributors";
  - contributions are accepted under the same licence ("inbound = outbound"), confirmed by the DCO sign-off on every commit (8.2);
  - it has no explicit patent grant;
  - **no third-party code is copied.** Copying third-party data, such as Sarraf's Apache-2.0 fixtures, needs that data's licence text and attribution in `THIRD_PARTY_NOTICES.md`.
- **Trademarks:**
  - the unaffiliated notice names all seven gateways;
  - no logos;
  - no "amazon" in any package name;
  - optionally, ask each gateway for written acknowledgement of the package names.
- **Regulation:** no licence should be needed for an SDK that never holds funds or card data. This changes if routing or failover is added (not legal advice).
- **Security policy:**
  - `SECURITY.md` with a private reporting address;
  - GitHub private vulnerability reporting;
  - a target response time;
  - advisories published for verifier bugs.
- **Data:**
  - fixtures contain no real personal data;
  - sandboxes only;
  - contract tests never use live keys.

### 9.3 Budget

| Item | Cost |
|---|---|
| Gateway sandboxes | Usually free (Uncertain per gateway) |
| GitHub, Actions and npm (public) | Free |
| Webhook receiver and tunnel | Free tier |
| Domain for the docs site | About US$10–20 a year |
| Security review | Free from a trusted volunteer; otherwise a paid review before 1.0 |

## 10. Decisions

### 10.1 Settled

| ID | Decision | Date |
|---|---|---|
| — | Build Bawaba rather than join Sarraf | 17 Nov 2026 |
| — | Seven gateways from the first milestone, with no waves | 17 Nov 2026 |
| — | Open source; the lead starts solo with Claude Code; up to two developers later | 17 Nov 2026 |
| — | Two weeks to `0.1.0` on `next`; `1.0.0` after validation and review | 17 Nov 2026 |
| — | Stripe: not in scope; possibly a facade-only adapter after 1.0 | 17 Nov 2026 |
| D1 | Lint and format: **Biome** (one dependency, fast; revisit for the NestJS and Next.js adapters) | 17 Nov 2026 |
| D3 | Fixture source of truth: **root `fixtures/`**, copied into `@bawabajs/testing` at build time | 17 Nov 2026 |
| D4 | `@bawabajs/testing` depends on **core only**, with signers re-implemented independently from the docs | 17 Nov 2026 |
| D5 | attw profile: **`--profile node16`** (confirm in spike A5) | 17 Nov 2026 |
| D6 | Licence: **MIT** (9.2) | 17 Nov 2026 |
| D8 | npm scope: **`@bawabajs`**, because another account holds `bawaba`. The unscoped facade stays `bawaba`. | 18 Nov 2026 |

### 10.2 Proposed, awaiting confirmation

| ID | Decision | Recommendation |
|---|---|---|
| — | Gateway account holder | **The lead as an individual, under a project email** (9.1) |
| D7 | Reserve npm names with `0.0.0` placeholders | **Yes, if** spike B2 confirms trusted publishing needs an existing package |

### 10.3 Open

1. **Partner programs:** whether to approach each gateway's partner program now. Recommended: yes, together with the sandbox requests.
2. **Kashier's primary flow** (hosted page or Payment Sessions). Decide from the validation results.
3. **Tap:** a native client (current plan) or a wrapper of the official SDK. Revisit in Milestone 4.

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Competition.** Sarraf is about three months ahead on the Egyptian gateways and could close its gaps quickly (its 5xx fix is one line). PayKernel has richer Gulf infrastructure. Tap's official SDK may mature. | Lead on the combination nobody else has: Egypt plus the Gulf, native clients, zero dependencies, strict money safety, and signed vs untrusted fields. Be first with real fixtures for Paymob, Fawry, Geidea, PayTabs and Amazon Payment Services, and publish the validation log early. |
| 2 | **API drift ×7.** No gateway versions its API. | Nightly contract tests per gateway, the conformance suite, tolerant types, the public validation log |
| 3 | **Maintainer load.** Seven gateways for one maintainer. | Claude Code for drafting; ownership by signature family when developers join; `CODEOWNERS`; the conformance suite; the `beta` fallback, so one slow gateway never blocks a release |
| 4 | **Sandbox and documentation access.** Fawry is mostly Secondary today; PayTabs' region details didn't load; onboarding at Geidea and Amazon Payment Services goes through their teams. | Request all access on day 1; no client leaves `beta` without official pages and real fixtures |
| 5 | **Silent signature errors**, the worst failure possible, across five signature families | Test vectors from the gateways, never self-generated; independent signers in `@bawabajs/testing`; `supported` only with captured fixtures; human line-by-line review |
| 6 | **AI-generated code that looks right but isn't** | The rules in `.claude/CLAUDE.md`; spec-first development; small PRs; `/code-review` and `/security-review`; an outside reviewer before 1.0 |
| 7 | **A leaky unified abstraction** (four checkout shapes, seven status models) | Facade built after all clients exist; `raw` on every result; escape hatch to the native client; the Stripe paper check |
| 8 | **Scope creep toward orchestration** | Routing and failover stay out of scope (PRODUCT_REQUIREMENTS §3) |
| 9 | **Trademark or naming objections** | Neutral project name, the unaffiliated notice, no logos, no "amazon" in package names |
