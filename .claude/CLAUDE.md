# CLAUDE.md

Bawaba (بوابة, "gateway") is an open-source, zero-dependency TypeScript SDK for seven payment gateways in Egypt and the Gulf: Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services (formerly PayFort; package `@bawaba/payfort`) and Tap Payments. It is unofficial and not affiliated with any of them.

**Status:** pre-scaffold, with no code yet. The current plan is the two-week build in [ROADMAP.md](../docs/roadmap/ROADMAP.md) §2.

## Documents

All paths are relative to the repository root.

| Document | Holds |
|---|---|
| [docs/requirements/PRODUCT_REQUIREMENTS.md](../docs/requirements/PRODUCT_REQUIREMENTS.md) | Why and what: users, scope, FR/NFR requirement IDs, priorities, non-goals, release criteria |
| [docs/specifications/PRODUCT_SPECIFICATIONS.md](../docs/specifications/PRODUCT_SPECIFICATIONS.md) | The public API: packages, facade, native clients, errors, webhooks, guarantees |
| [docs/specifications/TECHNICAL_SPECIFICATIONS.md](../docs/specifications/TECHNICAL_SPECIFICATIONS.md) | How it's built: core design, webhook rules, the cross-gateway comparison (§5), repo, tooling, CI |
| [docs/specifications/gateways/](../docs/specifications/gateways/) `<gateway>.md` | **One spec per gateway** (`paymob`, `kashier`, `fawry`, `geidea`, `paytabs`, `payfort`, `tap`): hosts, credentials, operations, signature recipes, status mapping, facade mapping, test vectors, open questions, validation checklist, traps |
| [docs/roadmap/ROADMAP.md](../docs/roadmap/ROADMAP.md) | Schedule, day-1 scaffold steps, milestones, team, prerequisites, decisions, risks |
| `docs/validation-log.md`, `docs/uncertainty-register.md` | Created by the scaffold: what has been proven, and what is still unconfirmed (register IDs match the gateway files: PMB, KSH, FWY, GDA, PTB, APS, TAP, GEN) |

Read the relevant section before changing anything. When the docs and the code disagree, the docs win until they are updated. When a sandbox disagrees with a gateway spec file, the sandbox wins: update that file first, then the code, then the validation log and register.

## Non-negotiable rules

1. **Zero runtime dependencies** in `@bawaba/core`, the gateway packages and `bawaba`. The only exception is core's `./conformance` subpath, which has Vitest as an optional peer. Adapters list their framework as a peer dependency only.
2. **No `node:` imports or Node built-ins** in core, the gateways or the facade. Use only global `fetch`, Web Crypto (`crypto.subtle`) and `TextEncoder`. The constant-time compare is an XOR over decoded bytes.
3. **Dependency direction:** core ← gateways ← `bawaba` ← adapters. Gateway packages never import each other. `@bawaba/testing` depends on core only.
4. **Wire-format field names** inside gateway clients. Never rename gateway fields, and never drop unknown ones.
5. **Webhooks:**
   - verifiers take the raw body (`string | Uint8Array`);
   - verification runs before any other use of the input: no lookups, and no parsing for logic;
   - unknown or missing event types fail closed;
   - document exactly which fields are signed, and put only those fields in `signed`.
6. **Never retry a money-moving call** (create payment, refund, capture, void).
   - A timeout, network error or 5xx on a mutation throws `OutcomeUnknownError`. It is never retryable, and the idempotency claim is kept.
   - Only a 4xx is a definite failure.
   - Reads may retry at most twice, with backoff and jitter.
7. **Money** in core and the facade is `{ minor: integer, currency }`. Convert with string or `BigInt` math; reject floats and excess precision; never round.
8. **Never invent** an endpoint, field, header, host or signature recipe. If it isn't in the gateway's spec file, stop: add it to that file's open questions and to the uncertainty register, and ask. Anything labelled Uncertain in a spec file must not be coded as fact. Implement it behind a `beta` flag, or leave it out.
9. **Unconfirmed means `beta`.** Anything not proven in a sandbox ships as `beta` and needs `allowBeta: true`. Only `source: "sandbox"` fixtures can promote a capability to `supported`.
10. **Secrets and personal data** never appear in logs, errors, `toJSON`, hook payloads, `inspect` output, fixtures, test snapshots or commits. Never use live gateway accounts or keys.
11. **No card data:** no API accepts raw card numbers or CVV.
12. **Declines are data:** a declined payment is a result, not an exception.

## How to work

- **One gateway per session, branch and pull request.** Read `docs/specifications/gateways/<gateway>.md` in full before touching its package. Work through its "Test vectors" and "Traps" sections first.
- **Test vectors first.** Write each verifier's test from a value the gateway provided (a documentation example or a captured callback) before implementing it. Never generate both the signature code and its expected values yourself. If no gateway-provided vector exists, write the test against a `@bawaba/testing` signer, mark the capability `beta`, and add a register entry.
- **Proof travels with the code.** Commit the validation evidence (scrubbed fixture, validation-log entry, register update) in the same PR as the code it proves.
- **Reviews:** run `/code-review` before merging each PR, and `/security-review` before publishing. A human reads every verifier and every money-moving method line by line.
- **Fact labels:** use Verified (with a date), Secondary, Uncertain and Proposal in the docs, as defined in PRODUCT_REQUIREMENTS.
- **Placeholder rule:** until a gateway's build day, its package exports only `VERSION` and `GATEWAY`.

## Commands (available once the scaffold exists)

```sh
pnpm install --frozen-lockfile
pnpm run ci                                  # lint, typecheck, check:deps, check:secrets, test, build, check:packages, smoke
pnpm test                                # all Vitest projects
pnpm vitest run --project <package>      # one package
pnpm typecheck                           # tsc -b
pnpm lint / pnpm format                  # Biome
pnpm build && pnpm check:packages        # tsdown, then publint + attw --profile node16
pnpm changeset                           # add a changeset for any published change
```

## Conventions

- **Node `>=22.12`**; pnpm is pinned through `packageManager`. The repository is developed on Windows, with LF line endings enforced by `.gitattributes`.
- **Notice:** every package README and `package.json` description includes *"Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments."*
- **Trademarks:** no gateway logos, and no "amazon" in package names.
- **Fixtures:** live in root `fixtures/<gateway>/`. They are scrubbed and re-signed with a test secret; the format is in TECHNICAL_SPECIFICATIONS §10.
- **Commits:** carry a DCO sign-off (`git commit -s`). Never commit or push unless asked.
- **Licence:** MIT. Every `package.json` has `"license": "MIT"`. Never copy third-party code. Copying third-party data (for example Sarraf's Apache-2.0 fixtures) needs `THIRD_PARTY_NOTICES.md`.
