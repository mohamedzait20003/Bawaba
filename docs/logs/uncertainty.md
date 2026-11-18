# Uncertainty register

Every fact about a gateway that is not yet confirmed, with how it will be confirmed. Rows are seeded from the "Open questions" table in each gateway spec file ([docs/specifications/gateways/](../specifications/gateways/)), so the IDs match.

**When an item is settled:**
1. Update the gateway spec file (the source of truth).
2. Set **Status** to `Confirmed` or `Changed`, fill in the date and link the evidence (a fixture, a validation-log entry, or a docs page).
3. Do all of this in the same pull request as the code that depends on it.

Labels: **Verified**, **Secondary**, **Uncertain** (see PRODUCT_REQUIREMENTS).

| ID | Gateway | Question | Label | How to confirm | Status | Date confirmed | Evidence |
|---|---|---|---|---|---|---|---|
| PMB-01 | Paymob | Auth-token expiry (about an hour?) | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-02 | Paymob | Does the redirect carry an `hmac`, and over which field names? | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-03 | Paymob | `phone_number` handling; integer vs string IDs | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-04 | Paymob | The exact 20-field transaction HMAC list and order, from Paymob's page | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-05 | Paymob | How null or missing values are stringified in the HMAC | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-06 | Paymob | Is `type` always present on callbacks? | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-07 | Paymob | Intention field names for the notification and redirection URLs; response fields | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-08 | Paymob | Refund, void and capture body field names | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-09 | Paymob | What a duplicate `special_reference` does | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| PMB-10 | Paymob | `refunded_amount_cents` (or equivalent) on partly refunded transactions | Uncertain | [paymob.md](../specifications/gateways/paymob.md) validation checklist | Open | | |
| KSH-01 | Kashier | Which checkout flow Kashier recommends now: hosted page or Payment Sessions | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-02 | Kashier | Are `apiKey` (header) and the Payment API Key (HMAC) the same key? | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-03 | Kashier | The full parameter list of the hosted-page URL (`mode`, `merchantRedirect`, `serverWebhook`, `display`, …) | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-04 | Kashier | The capture and reversal operations: paths and bodies | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-05 | Kashier | The retry schedule in practice | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-06 | Kashier | Whether idempotency headers exist | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-07 | Kashier | Auth headers for the `v2/aggregator` endpoints | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| KSH-08 | Kashier | Meaning and mapping of `ORDER_PAID_BEFORE` | Uncertain | [kashier.md](../specifications/gateways/kashier.md) validation checklist | Open | | |
| FWY-01 | Fawry | The charge path, body and signature order, from the official portal | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-02 | Fawry | The status v2 path and its signature | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-03 | Fawry | The notification V2 field list and order | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-04 | Fawry | How the notification URL is set (per request or in the dashboard) | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-05 | Fawry | The acknowledgement code and retry policy | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-06 | Fawry | The dedupe-key fields | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-07 | Fawry | Amount-format edge cases (e.g. `paymentAmount` ≠ `orderAmount` when fees apply) | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-08 | Fawry | Card and wallet flows without raw card data (hosted checkout `payments/init`?) | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-09 | Fawry | How to "pay" a reference code in staging | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-10 | Fawry | The refund and cancel signature orders; transaction listing; saved cards | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| FWY-11 | Fawry | Allowed `language` values | Uncertain | [fawry.md](../specifications/gateways/fawry.md) validation checklist | Open | | |
| GDA-01 | Geidea | The request timestamp format | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-02 | Geidea | Whether `merchantReferenceId` must be a UUID | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-03 | Geidea | The callback HTTP method, body fields and signature field name | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-04 | Geidea | The refund (and capture/void) signature formula | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-05 | Geidea | Whether test and live share hosts | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-06 | Geidea | Whether a plain redirect URL exists besides the JS checkout | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-07 | Geidea | `responseCode` success values and the error format | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-08 | Geidea | The callback acknowledgement and retry policy | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-09 | Geidea | The checkout script URLs for KSA and UAE | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-10 | Geidea | Whether the signed `timestamp` means delivery or transaction time | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| GDA-11 | Geidea | The full list of order and callback status values | Uncertain | [geidea.md](../specifications/gateways/geidea.md) validation checklist | Open | | |
| PTB-01 | PayTabs | The official regional host list (Oman, Jordan, Iraq, Kuwait) | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-02 | PayTabs | The auth header name | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-03 | PayTabs | Whether test and live share hosts | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-04 | PayTabs | `+` or `%20` for spaces in the return signature | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-05 | PayTabs | Partial refund and capture limits | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-06 | PayTabs | The IPN retry policy | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-07 | PayTabs | The `payments.request` response fields (`tran_ref`, …) | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| PTB-08 | PayTabs | `response_status` values and where they sit in the IPN and query payloads | Uncertain | [paytabs.md](../specifications/gateways/paytabs.md) validation checklist | Open | | |
| APS-01 | Amazon Payment Services | Which SHA types the dashboard offers, and how the HMAC variants are computed | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-02 | Amazon Payment Services | Whether feedback is signed with the response phrase | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-03 | Amazon Payment Services | `maintenance_reference` retry semantics (safe idempotent refund retry?) | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-04 | Amazon Payment Services | The feedback retry policy | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-05 | Amazon Payment Services | The 302 response conflict noted in the docs | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-06 | Amazon Payment Services | Visa's "last decimal is 0" rule in practice for 3-decimal currencies | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| APS-07 | Amazon Payment Services | The response-code and status table | Uncertain | [payfort.md](../specifications/gateways/payfort.md) validation checklist | Open | | |
| TAP-01 | Tap | The retrieve-charge path | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-02 | Tap | The parameters appended to `redirect.url`, and whether they are signed | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-03 | Tap | The refund `amount` type (integer or decimal) | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-04 | Tap | The webhook retry schedule | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-05 | Tap | The meaning of the `hash` header | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-06 | Tap | The result shape of `src_eg.fawry` (a reference code?) | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-07 | Tap | The exact field paths in the refund `hashstring` | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-08 | Tap | Whether `x_created` means delivery or transaction time | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-09 | Tap | The charge `status` values | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| TAP-10 | Tap | Length and charset limits of `reference.idempotent` | Uncertain | [tap.md](../specifications/gateways/tap.md) validation checklist | Open | | |
| GEN-01 | All | Whether `fetch` errors distinguish "never sent" from "sent" (affects `OutcomeUnknownError` on mutations) | Uncertain | CI run or npm docs | Open (mitigated) | | Day 2 rule, without relying on the answer: only errors raised before `fetch` is called (invalid input, invalid config, an already-aborted signal) count as never sent; every `fetch` rejection on a mutation is `OutcomeUnknownError`. Tests: `packages/core/test/retry.test.ts` ("never sent") |
| GEN-02 | All | The npm trusted-publishing bootstrap: whether a package must exist before a trusted publisher can be added (decision D7), and whether `changeset publish` authenticates through OIDC | Uncertain | CI run or npm docs | Open | | |
| GEN-03 | All | IQD exponent per gateway | Uncertain | CI run or npm docs | Open | | |
| GEN-04 | All | Whether Node 26 still accepts `--experimental-strip-types` for the TypeScript scripts | Verified | CI run | Confirmed | 2026-11-17 | CI "Node 26 (ubuntu-latest)" passed on commit b7e8fae |
