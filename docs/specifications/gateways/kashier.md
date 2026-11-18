# Kashier: gateway specification

*Package `@bawabajs/kashier`. Last updated 17 November 2026.*

**Validation status:** no Bawaba sandbox yet, so every operation is `beta`.

**Sources:**
- **developers.kashier.io:** read 16 November 2026 (Verified).
- **Sarraf's implementation** (commit `9e4bc8f`): Secondary. Sarraf ran it against **the real Kashier sandbox** on 21 October 2026, which makes it the strongest secondary source of the three Egyptian gateways.

This file is the source of truth for `@bawabajs/kashier`. When a sandbox contradicts it, update this file first, then the code, then `docs/validation-log.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Market | Egypt (EGP) |
| Checkout | The hosted payment page (a signed URL), or Payment Sessions v3. **Which one is primary is undecided** (KSH-01). |
| Facade result kind | `redirect` |
| Amount format | Decimal string in major units (`"100.00"`); webhook payloads carry numbers (`10`) |
| Signature family | HMAC-SHA256 hex over a listed set of keys (`signatureKeys`) |
| Server-side idempotency | None documented |
| Test vs live | Different hosts |

## 2. Configuration and authentication

| Option | Used for | Secret |
|---|---|---|
| `merchantId` | The hosted-page hash path and session body (`MID-…`) | No |
| `secretKey` | The `Authorization: <secret key>` header (Sessions, orders, refunds, voids) | Yes |
| `apiKey` | The `api-key: <API key>` header (Sessions) | Yes |
| `paymentApiKey` | HMAC key for the hosted-page hash, redirect signature and webhook signature. Sarraf uses one key for both `apiKey` and `paymentApiKey`; whether they are the same is Uncertain (KSH-02). | Yes |
| `mode` | `"test" \| "live"` | No |

**Hosts:**

| Purpose | Test | Live | Label |
|---|---|---|---|
| API (sessions, transactions, order lookup) | `https://test-api.kashier.io` | `https://api.kashier.io` | Verified |
| Order operations (refund, void) | `https://test-fep.kashier.io` | `https://fep.kashier.io` | Secondary (Sarraf, sandbox-confirmed) |
| Hosted checkout page | `https://checkout.kashier.io` | `https://checkout.kashier.io` | Secondary (Sarraf) |

All three hosts get a per-host override option.

## 3. Operations

| Client method | HTTP | Auth | Kind | Label |
|---|---|---|---|---|
| `checkout.hostedPageUrl()` | Built locally on the checkout host, with `hash` = the HMAC in 4.1 | none | — | Hash path Secondary (Kashier's official demo, sandbox-confirmed by Sarraf). The **other URL parameters are Uncertain** (KSH-03). |
| `sessions.create` | `POST {api}/v3/payment/sessions` | `Authorization` + `api-key` | mutation | Verified |
| `sessions.retrievePayment` | `GET {api}/v3/payment/sessions/{sessionId}/payment` | Uncertain | read | Verified path |
| `transactions.list` | `GET {api}/v2/aggregator/transactions` | Uncertain | read | Verified path |
| `transactions.retrieve` | `GET {api}/v2/aggregator/transactions/{transactionId}` | Uncertain | read | Verified path |
| `orders.find(merchantOrderId)` | `GET {api}/v3/payment/orders?search={merchantOrderId}` | `Authorization` | read | Secondary (sandbox) |
| `orders.refund` | `PUT {fep}/v3/orders/{orderId}`, body `{ apiOperation: "REFUND", reason, transaction: { amount } }` | `Authorization` | mutation | Secondary (sandbox) |
| `orders.void` | `PUT {fep}/v3/orders/{orderId}`, body `{ apiOperation: "VOID", transaction: { targetTransactionId, amount } }` | `Authorization` | mutation | Secondary (sandbox) |
| `orders.capture` | Uncertain (KSH-04) | — | mutation | Uncertain |

**Details:**
- **Session body** (Secondary): `expireAt`, `maxFailureAttempts`, `paymentType` (`"credit"`), `amount` (string), `currency`, `order`, `merchantRedirect`, `serverWebhook`, `failureRedirect`, `display` (`"en"` or `"ar"`), `type` (`"one-time"`), `allowedMethods`, `merchantId`, `metaData`, `customer`, `description`. The response has `_id` and `sessionUrl`.
- **Order lookup:** `search` is a partial, case-insensitive match. Pick the exact `merchantOrderId` from the results, so `order_1` never matches `order_12`.
- **Refund:** **always send an amount.** Sarraf found that the sandbox returns HTTP 500 without one, even for a full refund.
- **Void:** pay transactions can be voided on the same day only (Secondary).
- **Other resources** (after 1.0): saved cards (`GET /v3/cards/customer`), customers, payment links, payment pages, payouts, webhook management (`/v2/webhooks`), settlement reports.

## 4. Signatures

### 4.1 Hosted-page hash

- **Signed string:** `/?payment={merchantId}.{orderId}.{amount}.{currency}`. A saved-card `customerReference` may be appended as `.{ref}` (Uncertain).
- **Algorithm:** HMAC-SHA256 hex, keyed with `paymentApiKey`.
- **Amount:** the string must be **identical** in the hash and in the URL (e.g. `250.00`).

### 4.2 Webhook

- **Delivery:** a POST with `{ event, data }`; the signature is in the `x-kashier-signature` header (Verified).
- **Recipe (Verified):**
  1. Sort `data.signatureKeys` alphabetically.
  2. Take each key's value from `data`.
  3. URL-encode the values only, with **strict RFC 3986** encoding.
  4. Join them as `key=value` with `&`.
  5. Compute HMAC-SHA256 with `paymentApiKey`, as hex.
  6. Compare case-insensitively with the header.
- **Encoding details** (Secondary, from Sarraf's sandbox-confirmed `query-string` behaviour):
  - `encodeURIComponent` plus encoding of `! ' ( ) *`;
  - arrays as repeated keys;
  - `null` as a bare key.
- **Example:** `channel=online | e-commerce` is signed as `channel=online%20%7C%20e-commerce`.
- **`signed` fields:** exactly the keys listed in `data.signatureKeys`.
- **Fail closed:** reject a missing header, a missing or empty `signatureKeys`, invalid JSON, or an unknown `event`.

### 4.3 Redirect (`merchantRedirect`)

- **Signed string** (Secondary, sandbox-confirmed by Sarraf): every query parameter except `signature` and `mode`, **in the order received**, as `key=value` with decoded values, joined with `&`.
- **Algorithm:** HMAC-SHA256 hex, keyed with `paymentApiKey`, compared with the `signature` parameter.
- **Result:** `authenticated` only. Order state comes from webhooks or a lookup.

### 4.4 Delivery

- **Events:** `pay`, `authorize`, `capture`, `refund`, `partial_refund`, `void`, `reject`, `reversal`, plus `idempotency` for replays.
- **Status:** `SUCCESS`, `FAILURE` or `PENDING`. **Branch on `data.status`, not on `event`** (Kashier's own guidance).
- **Acknowledgement:** `200`, or **`409` for already processed** (`alreadyProcessed()` returns 409).
- **Timeout and retries:** 30-second timeout; up to 10 retries at 2 min, 10 min, 30 min, 1 h, 2 h and 4 h, then every 4 h.
- **Dedupe:** Kashier deduplicates on `{transactionId}::{webhookUrl}::{status}`. Bawaba's dedupe key is `kashier:{transactionId}:{status}`.

## 5. Status mapping (draft)

The rows marked "sandbox (Sarraf)" were confirmed by Sarraf, but they stay `verified: false` in Bawaba until our own capture.

| Kashier state | Bawaba status | Evidence |
|---|---|---|
| Event `pay`, status `SUCCESS` | `succeeded` | Sandbox (Sarraf) |
| Status `PENDING` / `INITIATED` | `pending` | Secondary |
| Status `FAILURE` / `FAILED` / `DECLINED` | `failed` | Secondary |
| Event `authorize`, `SUCCESS` | `authorized` | Secondary |
| Event `capture`, `SUCCESS` | `succeeded` | Secondary |
| Event `refund`, `SUCCESS`, partial (totals from the order lookup) | `partially_refunded` | Sandbox (Sarraf) |
| Event `refund`, `SUCCESS`, full | `refunded` | Sandbox (Sarraf) |
| Event `void`, `SUCCESS` | `canceled` | Sandbox (Sarraf) |
| Order lookup `CAPTURED` with `totalRefundedAmount` < amount | `partially_refunded` | Sandbox (Sarraf) |
| Order lookup `CAPTURED` with `totalRefundedAmount` = amount | `refunded` | Sandbox (Sarraf) |
| Order lookup `CANCELLED` (after a void) | `canceled` | Sandbox (Sarraf) |
| Status `EXPIRED` | `expired` | Secondary |
| `ORDER_PAID_BEFORE` | Keep in `raw`; map after a capture | Uncertain |

Kashier keeps a refunded order `CAPTURED` and tracks refunds in `totalRefundedAmount`, so refund status must come from the totals.

## 6. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `redirect`: either the hosted-page URL (no gateway ID until payment, so `gatewayPaymentId: null`) or the session URL (`gatewayPaymentId` = session `_id`). Decided with KSH-01. |
| `retrievePayment` / `reconcile` | `orders.find` by merchant reference, or `transactions.retrieve` |
| `refund` / `void` | `orders.refund` / `orders.void` |
| `capture` | `beta` until KSH-04 is resolved |
| `confirmWithStatusQuery` default | Off. For refund events, the order lookup supplies the refund totals. |

## 7. Test vectors

- **Needed:** a `pay` webhook, a `refund` webhook, a failure webhook, a redirect and a hosted-page hash, each with the raw body (or query), the signed string and the expected signature.
- **Available as secondary vectors:** Sarraf's `fixtures/kashier/sandbox-*.json`. These are real sandbox payloads, scrubbed and re-signed with a test secret. They are Apache-2.0, so copying them into this MIT repository needs their licence text and attribution in a `THIRD_PARTY_NOTICES.md`, and a note on each copied file that it was changed. They can seed tests, but **only our own capture can promote a capability to `supported`.**

## 8. Open questions

| ID | Question |
|---|---|
| KSH-01 | Which checkout flow Kashier recommends now: hosted page or Payment Sessions |
| KSH-02 | Are `apiKey` (header) and the Payment API Key (HMAC) the same key? |
| KSH-03 | The full parameter list of the hosted-page URL (`mode`, `merchantRedirect`, `serverWebhook`, `display`, …) |
| KSH-04 | The capture and reversal operations: paths and bodies |
| KSH-05 | The retry schedule in practice |
| KSH-06 | Whether idempotency headers exist |
| KSH-07 | Auth headers for the `v2/aggregator` endpoints |
| KSH-08 | Meaning and mapping of `ORDER_PAID_BEFORE` |

## 9. Validation checklist

- [ ] Decide the primary checkout flow (KSH-01).
- [ ] Capture `pay`, `refund` (full and partial), `void` and failure webhooks, and a redirect.
- [ ] Reproduce every signature, including a value that needs strict RFC 3986 encoding.
- [ ] Confirm the capture path, and confirm the refund and void paths ourselves.
- [ ] Return 500 once, and record the actual retry timings.

## 10. Traps

- **Wrong key:** webhooks are signed with the Payment API Key, **not** the secret key.
- **Encoding:** plain `encodeURIComponent` breaks signatures containing `! ' ( ) *`.
- **Search:** order search is a partial match.
- **Refunds:** a refund without an amount gets a 500, which our pipeline would turn into `OutcomeUnknownError`. Always send the amount.

## 11. Sources

- [Payment sessions](https://developers.kashier.io/docs/accept-payments/payment-sessions), [API reference](https://developers.kashier.io/docs/api-reference), [webhooks](https://developers.kashier.io/docs/webhooks), [payloads](https://developers.kashier.io/docs/webhooks/payloads), [webhook management](https://developers.kashier.io/docs/webhooks/manage)
- Sarraf `packages/kashier/src/{client,signature,mappers,config}.ts` and `fixtures/kashier/`, commit `9e4bc8f` (Apache-2.0; read for design, not copied)
