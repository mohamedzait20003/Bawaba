---
"@bawabajs/core": minor
"@bawabajs/testing": minor
---

Complete the core: idempotency claims with an in-memory store (an unknown outcome keeps the claim; a 4xx releases it), capability levels with the beta gate, webhook input helpers that take the raw body and verify before parsing, redaction of secrets and personal data (error headers and bodies no longer appear when an error is logged), and the conformance suite at `@bawabajs/core/conformance`. Add the `@bawabajs/testing` skeleton: `fakeFetch`, `jsonResponse`, `webhookRequest` and `parseFixture`.
