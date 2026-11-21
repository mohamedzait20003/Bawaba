# @bawabajs/testing

Test helpers for [Bawaba](../../README.md) gateway clients and for your own tests. No secrets needed.

> **Unofficial.** Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments.

**Status: pre-alpha.** The skeleton is in place:
- `fakeFetch(...)`: answers each request with the next scripted response or error, records every call, and rejects any request that wasn't scripted, so an unexpected retry fails the test;
- `jsonResponse(body, init)`;
- `webhookRequest({ body, headers, query })`: serializes a body once, so the bytes a test signs are the bytes it sends;
- `parseFixture(json)` and `fixtureRequest(fixture)`: read and check a fixture in the [fixtures/README.md](../../fixtures/README.md) format.

Scrubbed fixtures and an independent test signer for each gateway arrive on that gateway's build day.

## Licence

MIT
