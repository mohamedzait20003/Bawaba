# Bawaba: roadmap

*Last updated 17 November 2026. This roadmap replaces all earlier plan documents.*

This document says **when and how** Bawaba gets built: the two-week schedule, the day-1 setup, the milestones, the team, the prerequisites, the decisions and the risks. What is being built is in [PRODUCT_REQUIREMENTS.md](../requirements/PRODUCT_REQUIREMENTS.md), [PRODUCT_SPECIFICATIONS.md](../specifications/PRODUCT_SPECIFICATIONS.md) and [TECHNICAL_SPECIFICATIONS.md](../specifications/TECHNICAL_SPECIFICATIONS.md).

---

## 1. Summary

- **Who:** the lead, working **solo** and building with **Claude Code**. Up to two more developers may join later (section 6).
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
| **1** | Toolchain spike and full scaffold (section 3); CI green | Create the project email, npm org and GitHub org. **Request sandbox access from all seven gateways and contact their partner teams.** |
| **2** | `@bawaba/core`: request pipeline, retry and no-retry policy, errors with `code`, `Money` and `Currency`, crypto (SHA-256/512, HMAC, hex/base64, constant-time compare) | Review every core file; chase sandbox replies |
| **3** | `@bawaba/core`: idempotency store, capability levels, webhook input helpers, redaction, conformance suite. `@bawaba/testing` skeleton. Webhook receiver and fixture recorder/scrubber in `tools/`. | Deploy the webhook receiver; register its URL in every sandbox that exists |
| **4** | `@bawaba/fawry` (the most unusual; it shapes the core) | Validate any sandbox that has arrived |
| **5** | `@bawaba/payfort` (Amazon Payment Services: form POST, phrase-wrapped hash) | Same |
| **6** | `@bawaba/paymob` | Paymob validation if the keys exist: capture transaction, redirect and token callbacks |
| **7** | `@bawaba/kashier` | Kashier validation: decide the primary checkout flow |
| **8** | `@bawaba/geidea` | Settle the timestamp format against a real session, if credentials exist |
| **9** | `@bawaba/paytabs` | Confirm the regional host and auth header against a real test profile |
| **10** | `@bawaba/tap` | Prove `reference.idempotent` replay in the Tap sandbox |
| **11** | `bawaba` facade: types from the real overlap, four result kinds, statuses, dedupe keys, `webhooks.verify/inspect` | Paper design check: does Stripe fit the facade types? |
| **12** | Facade finish; `examples/minimal`; per-package READMEs with the capability table and the unofficial notice | Re-run the conformance suite across all seven |
| **13** | Hardening: `/code-review` on each package; fix the findings; secret scan; confirm there are no `node:` imports and no retried mutations | Line-by-line review of all seven verifiers |
| **14** | Changesets; publish `0.1.0` to `next`; update `docs/validation-log.md` and the uncertainty register; set every unproven operation to `beta` | Publish the status table: which gateways are proven and which are beta |

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

Prove the build on the first package (`@bawaba/core`, commit 8) before copying it to the others. Nothing is committed until its check passes. Record the results in TECHNICAL_SPECIFICATIONS §8 (commit 27).

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

- Create the project email address that every gateway account is registered under (7.1).
- Create the `@bawaba` npm org (with 2FA enforced) and the `bawaba` GitHub org (or `bawaba-js`) on the same day.
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
| 8 | `feat(core): scaffold @bawaba/core` | `packages/core` with `.` and `./conformance` | A3–A6: build, `publint`, `attw`, typecheck and tests pass |
| 9 | `feat(testing): scaffold @bawaba/testing` | `packages/testing` | Same checks |
| 10–16 | `feat(<gateway>): scaffold @bawaba/<gateway>`, one commit each for paymob, kashier, fawry, geidea, paytabs, payfort and tap | `packages/<gateway>` with `.` and `./webhooks` | Same checks |
| 17 | `feat(bawaba): scaffold the facade with gateway subpaths` | `packages/bawaba` with `.` plus seven subpaths | Same checks, for all ten packages |
| 18 | `build: add dependency guard` | `scripts/check-deps.mjs` | Passes, and fails on a forbidden dependency or a `node:` import added on purpose |
| 19 | `build: add secret scanner` | `scripts/check-no-secrets.mjs` | Passes, and fails on a fake live key added on purpose |
| 20 | `test: add ESM and CJS smoke consumers` | `scripts/smoke/` | A7, A8: `pnpm smoke` imports all ten packages both ways |
| 21 | `build: configure Changesets fixed release group` | `.changeset/` | A9: a snapshot version bumps all ten together, then is reverted |
| 22 | `test: add fixture folders and scrubbing rules` | `fixtures/<gateway>/.gitkeep`, `fixtures/README.md` | — |
| 23 | `docs: seed validation log and uncertainty register` | `docs/validation-log.md`, `docs/uncertainty-register.md` (every open question from the gateway files, plus GEN) | — |
| 24 | `docs: add README, contributing guide and security policy` | `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Every README and description has the unofficial notice (checked by `check-deps`) |
| 25 | `ci: add CI, contract and release workflows` | `.github/workflows/ci.yml`, `contract.yml`, `release.yml` | YAML parses; `pnpm ci` passes locally |
| 26 | `chore: add Dependabot and CODEOWNERS` | `.github/dependabot.yml`, `.github/CODEOWNERS` | — |
| 27 | `docs: record toolchain spike results` | TECHNICAL_SPECIFICATIONS §8 notes; ticks in 3.5 | `pnpm ci` passes from a clean install |

**After commit 27 (the lead):** create the GitHub repository, add it as `origin`, push `main`, and confirm that `ci.yml` is green on every matrix entry and that `contract.yml` runs from `workflow_dispatch` as a no-op.

### 3.5 Day-1 definition of done

- [ ] `pnpm ci` passes locally on Windows and in GitHub Actions on Node 22.12, 24 and 26.
- [ ] All ten packages build to ESM and CJS with types; `publint` and `attw` are clean.
- [ ] The smoke consumers import every package with both `require` and `import`.
- [ ] The dependency guard enforces the one-way dependency direction, zero dependencies and no `node:` imports.
- [ ] No gateway endpoint, field name or signature recipe exists in code yet.
- [ ] The uncertainty register is seeded, and the validation log exists.
- [ ] The lockfile is committed, and pnpm is pinned through `packageManager`.
- [ ] Sandbox requests have been sent to all seven gateways.

## 4. Milestones

The milestones define what each stage must achieve. The two-week schedule compresses Milestones 1–3 into days 1–12. Milestone 0 runs throughout and continues after day 14, and Milestone 4 follows day 14.

### Milestone 0: Validation (all seven gateways, continuous from day 1)

Milestone 0 decides **what ships as `supported` and what ships as `beta`**.

**Tasks for all gateways:** capture real callbacks, reproduce every signature, and record the results in `docs/validation-log.md` and the uncertainty register.

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
| Tasks | The scaffold (section 3); `@bawaba/core` in full (TECHNICAL_SPECIFICATIONS §3); the `@bawaba/testing` skeleton; the validation tooling in `tools/` |
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
| Tasks | `@bawaba/express`, `@bawaba/nestjs` (a module with a raw-body-aware webhook guard) and `@bawaba/next` (route-handler helpers); runnable examples; a docs site (Astro Starlight or VitePress); issue templates; outreach to each gateway's developer relations and to developer communities in Egypt and the Gulf |
| Candidates | Paymob subscriptions and QuickLinks; Kashier payment links and saved cards; more gateways by demand (MyFatoorah, Moyasar, HyperPay, Checkout.com); a facade-only `@bawaba/stripe` |

## 5. After day 14: the path to 1.0

1. **Keep validating:** as each sandbox arrives, capture callbacks, add fixtures and lift `beta` flags in patch releases.
2. **Track proof publicly:** keep the public status table and the validation log current.
3. **Get an outside review:** find a security reviewer outside the team for the verifiers, redaction and the no-retry paths.
4. **Finish Milestone 4,** then publish `1.0.0-rc`, then `1.0.0` on `latest`.

There is no fixed date: 1.0 waits on the slowest gateway's onboarding and on the review.

## 6. Team

### 6.1 Roles

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

### 6.2 Working rules

- **`CODEOWNERS`:** each gateway package has an owner and a second reviewer from another track. No verifier change merges with only its author's approval.
- **`CONTRIBUTING.md`:** contributions are licensed under MIT; the fixture-scrubbing rules; a DCO sign-off (`git commit -s`); and Conventional Commit messages (`feat(paymob): …`). There is no separate contributor licence agreement.
- **Credentials:** nobody keeps gateway credentials on a personal machine longer than needed. CI secrets are the source of truth.
- **Coordination:** a short weekly call, plus a GitHub Project board with one column per milestone, showing blocked sandbox requests.

## 7. Prerequisites besides code

### 7.1 Gateway accounts

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

### 7.2 Legal and policy

- **Licence: MIT** (decided 17 November 2026):
  - it is short, permissive and the most familiar licence on npm;
  - the copyright line is "The Bawaba contributors";
  - contributions are accepted under the same licence ("inbound = outbound"), confirmed by the DCO sign-off on every commit (6.2);
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

### 7.3 Budget

| Item | Cost |
|---|---|
| Gateway sandboxes | Usually free (Uncertain per gateway) |
| GitHub, Actions and npm (public) | Free |
| Webhook receiver and tunnel | Free tier |
| Domain for the docs site | About US$10–20 a year |
| Security review | Free from a trusted volunteer; otherwise a paid review before 1.0 |

## 8. Decisions

### 8.1 Settled

| ID | Decision | Date |
|---|---|---|
| — | Build Bawaba rather than join Sarraf | 17 Nov 2026 |
| — | Seven gateways from the first milestone, with no waves | 17 Nov 2026 |
| — | Open source; the lead starts solo with Claude Code; up to two developers later | 17 Nov 2026 |
| — | Two weeks to `0.1.0` on `next`; `1.0.0` after validation and review | 17 Nov 2026 |
| — | Stripe: not in scope; possibly a facade-only adapter after 1.0 | 17 Nov 2026 |
| D1 | Lint and format: **Biome** (one dependency, fast; revisit for the NestJS and Next.js adapters) | 17 Nov 2026 |
| D3 | Fixture source of truth: **root `fixtures/`**, copied into `@bawaba/testing` at build time | 17 Nov 2026 |
| D4 | `@bawaba/testing` depends on **core only**, with signers re-implemented independently from the docs | 17 Nov 2026 |
| D5 | attw profile: **`--profile node16`** (confirm in spike A5) | 17 Nov 2026 |
| D6 | Licence: **MIT** (7.2) | 17 Nov 2026 |

### 8.2 Proposed, awaiting confirmation

| ID | Decision | Recommendation |
|---|---|---|
| — | Gateway account holder | **The lead as an individual, under a project email** (7.1) |
| D7 | Reserve npm names with `0.0.0` placeholders | **Yes, if** spike B2 confirms trusted publishing needs an existing package |

### 8.3 Open

1. **Partner programs:** whether to approach each gateway's partner program now. Recommended: yes, together with the sandbox requests.
2. **Kashier's primary flow** (hosted page or Payment Sessions). Decide from the validation results.
3. **Tap:** a native client (current plan) or a wrapper of the official SDK. Revisit in Milestone 4.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Competition.** Sarraf is about three months ahead on the Egyptian gateways and could close its gaps quickly (its 5xx fix is one line). PayKernel has richer Gulf infrastructure. Tap's official SDK may mature. | Lead on the combination nobody else has: Egypt plus the Gulf, native clients, zero dependencies, strict money safety, and signed vs untrusted fields. Be first with real fixtures for Paymob, Fawry, Geidea, PayTabs and Amazon Payment Services, and publish the validation log early. |
| 2 | **API drift ×7.** No gateway versions its API. | Nightly contract tests per gateway, the conformance suite, tolerant types, the public validation log |
| 3 | **Maintainer load.** Seven gateways for one maintainer. | Claude Code for drafting; ownership by signature family when developers join; `CODEOWNERS`; the conformance suite; the `beta` fallback, so one slow gateway never blocks a release |
| 4 | **Sandbox and documentation access.** Fawry is mostly Secondary today; PayTabs' region details didn't load; onboarding at Geidea and Amazon Payment Services goes through their teams. | Request all access on day 1; no client leaves `beta` without official pages and real fixtures |
| 5 | **Silent signature errors**, the worst failure possible, across five signature families | Test vectors from the gateways, never self-generated; independent signers in `@bawaba/testing`; `supported` only with captured fixtures; human line-by-line review |
| 6 | **AI-generated code that looks right but isn't** | The rules in `.claude/CLAUDE.md`; spec-first development; small PRs; `/code-review` and `/security-review`; an outside reviewer before 1.0 |
| 7 | **A leaky unified abstraction** (four checkout shapes, seven status models) | Facade built after all clients exist; `raw` on every result; escape hatch to the native client; the Stripe paper check |
| 8 | **Scope creep toward orchestration** | Routing and failover stay out of scope (PRODUCT_REQUIREMENTS §3) |
| 9 | **Trademark or naming objections** | Neutral project name, the unaffiliated notice, no logos, no "amazon" in package names |
