# Contributing to Bawaba

Thank you for helping. Bawaba handles payment secrets and money-moving calls, so the rules below are strict. Please read them before opening a pull request.

## Licence and sign-off

- Bawaba is licensed under [MIT](LICENSE). By contributing, you agree that your contribution is licensed under MIT too.
- Every commit needs a **Developer Certificate of Origin** sign-off (`git commit -s`), certifying that you wrote the change or have the right to submit it ([developercertificate.org](https://developercertificate.org)).
- **Never copy code from another project**, even a permissively licensed one. Ideas are fine; code is not. Copying third-party *data* (such as fixtures) needs its licence and attribution in `THIRD_PARTY_NOTICES.md`.

## Workflow

1. **Read the spec first.** The facts about each gateway live in [docs/specifications/gateways/](docs/specifications/gateways/), and they are the source of truth. If a sandbox disagrees with a spec file, update the spec file in the same pull request.
2. **One gateway per pull request**, kept small.
3. **Test vectors first.** Write each signature verifier's test from a value the gateway provided (a docs example or a captured callback) before implementing it. Never generate both the code and its expected values yourself.
4. **Use Conventional Commits:** `feat(paymob): …`, `fix(core): …`, `docs: …`, `test: …`, `build: …`, `ci: …`, `chore: …`.
5. **Add a changeset** (`pnpm changeset`) for any change to a published package.
6. **Run `pnpm run ci`.** It must pass locally before review.

## Non-negotiable rules

The full list is in [.claude/CLAUDE.md](.claude/CLAUDE.md). The most important:
- **Dependencies:** none at runtime, and no Node built-ins in core, gateway or facade code (`pnpm check:deps` enforces both).
- **Webhooks:** verify over the raw body, before any other use of the input, and fail closed.
- **Money:** never retry a money-moving call. A timeout, network error or 5xx on one is `OutcomeUnknownError`.
- **No guessing:** never invent an endpoint, field or signature recipe. Unconfirmed behaviour ships as `beta`.

## Fixtures and secrets

- **Never commit real credentials, card numbers or personal data.** Scrub every captured payload as described in [fixtures/README.md](fixtures/README.md); `pnpm check:secrets` checks this.
- **Sandboxes only:** never use live gateway accounts for development or tests.

## Reviews

- **Two approvals for verifiers:** every change to a signature verifier or a money-moving method needs a review from someone other than its author (see `.github/CODEOWNERS`).
- **Security issues** go through the private process in [SECURITY.md](SECURITY.md), never a public issue.
