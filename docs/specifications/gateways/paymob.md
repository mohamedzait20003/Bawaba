# Paymob: gateway specification

*Package `@bawaba/paymob`. Last updated 17 November 2026.*

**Validation status:** no sandbox access yet, so every operation is `beta`.

**Sources:**
- **Paymob's docs:** read 16 November 2026 (Verified).
- **Sarraf's implementation** (commit `9e4bc8f`, synthetic fixtures only): Secondary.

This file is the source of truth for `@bawaba/paymob`. When a sandbox contradicts it, update this file first, then the code, then `docs/validation-log.md`. The labels (Verified, Secondary, Uncertain, Proposal) are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Markets and default currencies | Egypt (EGP), KSA (SAR), UAE (AED), Oman (OMR). The currency per region is Secondary (Sarraf's config). |
| Checkout | Unified Checkout redirect, or Pixel (embedded) |
| Facade result kind | `redirect` (`embedded` via Pixel later) |
| Amount format | Integer minor units (`amount`, `amount_cents`) |
| Signature family | HMAC-SHA512 hex over fixed fields |
| Server-side idempotency | None |
| Test vs live | Same host; the mode follows the keys and integration IDs |
| Not available | A customer resource, list/pagination endpoints, idempotency keys, API versioning |

## 2. Configuration and authentication

| Option | Used for | Secret |
|---|---|---|
| `secretKey` | `Authorization: Token <secret_key>` on the intention, refund, void and capture APIs | Yes |
| `apiKey` | `POST api/auth/tokens`, which returns a legacy auth token valid for about an hour. The token is used as Bearer on transaction retrieve, and as `auth_token` in the inquiry body. | Yes |
| `publicKey` | The Unified Checkout URL | No |
| `hmacSecret` | Callback and redirect HMAC | Yes |
| `integrationIds` | `payment_methods` in the intention (one integration ID per method, e.g. `{ card: 158 }`) | No |
| `region` | `"EG" \| "SA" \| "AE" \| "OM"` | No |

**Token cache:** single-flight. Concurrent callers share one in-flight token request, and the token is refreshed before it expires. The exact expiry is Uncertain (PMB-01).

**Hosts (Verified):**

| Region | API host | Checkout |
|---|---|---|
| EG | `https://accept.paymob.com` | `https://eg.checkout.paymob.com/?publicKey=...&clientSecret=...` |
| SA | `https://ksa.paymob.com` | `https://ksa.checkout.paymob.com/...` |
| AE | `https://uae.paymob.com` | `https://uae.checkout.paymob.com/...` |
| OM | `https://oman.paymob.com` | `https://om.checkout.paymob.com/...` |

## 3. Operations

| Client method | HTTP | Auth | Kind | Label |
|---|---|---|---|---|
| `intentions.create` | `POST /v1/intention/` | Token (secret key) | mutation | Verified |
| `intentions.update` | `PUT /v1/intention/{client_secret}/` | Token | mutation | Verified |
| `checkout.url()` | Built locally from `publicKey` and `client_secret` | none | — | Verified |
| (internal) auth token | `POST /api/auth/tokens` with the API key | none | read: it moves no money, so it is safe to retry (Proposal) | Verified |
| `transactions.retrieve(id)` | `GET /api/acceptance/transactions/{id}` | Bearer legacy token | read | Verified |
| `transactions.retrieveByOrderId` / `retrieveByMerchantOrderId` | `POST /api/ecommerce/orders/transaction_inquiry` | `auth_token` in the body | read: a POST that moves no money | Verified |
| `transactions.refund` | `POST /api/acceptance/void_refund/refund` | Token | mutation | Verified |
| `transactions.void` | `POST /api/acceptance/void_refund/void` | Token | mutation | Verified |
| `transactions.capture` | `POST /api/acceptance/capture` | Token | mutation | Verified |

**Request fields:**
- **Intention:** `amount`, `currency`, `payment_methods` (integration IDs), `items`, `billing_data` (`first_name`, `last_name`, `email`, `phone_number`), `special_reference` and `extras`. The notification and redirection URL field names are Uncertain (PMB-07). The response carries `client_secret`.
- **Refund and capture:** `transaction_id` and `amount_cents`. **Void:** `transaction_id`. These field names should be confirmed on the operation pages (PMB-08).

**Known contradictions in the docs:** `phone_number` handling, and whether IDs are integers or strings (PMB-03).

## 4. Callbacks and signatures

Every callback carries an HMAC-SHA512 (lowercase hex) keyed with `hmacSecret`. Verification runs over the **raw body**, parsed only inside the verifier.

### 4.1 Transaction processed (`type: "TRANSACTION"`)

- **Delivery:** a POST with JSON `{ type, obj }`. The HMAC is in the **`hmac` query parameter** (Verified).
- **Signed string:** these 20 values from `obj`, in this order, concatenated with no separator. The list is Secondary (Sarraf's implementation); confirm it on Paymob's HMAC page (PMB-04). Note Paymob's spelling `error_occured`.

  ```text
  amount_cents, created_at, currency, error_occured, has_parent_transaction, id,
  integration_id, is_3d_secure, is_auth, is_capture, is_refunded, is_standalone_payment,
  is_voided, order.id, owner, pending, source_data.pan, source_data.sub_type,
  source_data.type, success
  ```
- **Value formatting:** booleans become `"true"` / `"false"` and numbers their plain string. Null or missing values become `""` (Uncertain, PMB-05).
- **Fields that go in `signed`:** exactly the 20 above.

### 4.2 Card token saved (`type: "TOKEN"`)

- **Delivery:** like 4.1. The HMAC is in the `hmac` query parameter.
- **Signed string:** `card_subtype, created_at, email, id, masked_pan, merchant_id, order_id, token`, concatenated (Secondary).
- **Event type:** `card.saved`.

### 4.3 Subscription callbacks (after 1.0)

- **Location:** the HMAC is in the **body**, not the query.
- **Signed string:** `"{trigger_type}for{subscription_data.id}"` (Verified pattern; field path Secondary).

### 4.4 Fail-closed rules

- **Accepted types:** only `TRANSACTION` and `TOKEN` (subscriptions are verified separately).
- **Missing `type`:** Sarraf treats a missing `type` as `TRANSACTION`. **Bawaba rejects it** until real callbacks show whether `type` is always present (PMB-06).
- **Missing `obj`:** reject.

### 4.5 Delivery

- **Acknowledgement:** 200.
- **Retries:** no retry policy is documented. There is no signed timestamp.
- **Dedupe key:** `paymob:{obj.id}:{derived status}`. For subscriptions, use `paymob_request_id`.

## 5. Redirect (`redirects.verify`)

- **Delivery:** a GET to the redirection URL. The query carries the transaction fields as strings.
- **The `hmac` parameter:** Sarraf assumes the query may carry an `hmac` over the same 20 fields, with `order` in place of `order.id`, but this is unverified (PMB-02).
- **Result:** `authenticated: true` only when the `hmac` is present and matches. A redirect never drives order state.

## 6. Status mapping (draft)

Every row is `verified: false` until it is proven with a sandbox fixture. The rows are adapted from Sarraf's table (Secondary).

| Paymob state | Bawaba status | Event type |
|---|---|---|
| `is_voided: true` | `canceled` | `payment.canceled` |
| `pending: true`, kiosk source (`source_data.type` aggregator) | `awaiting_payment` | `payment.pending` |
| `pending: true` | `pending` | `payment.pending` |
| `success: true`, `is_auth: true`, nothing captured | `authorized` | `payment.authorized` |
| `success: true`, `is_capture: true` | `succeeded` | `payment.succeeded` |
| `success: true`, no refund or void | `succeeded` | `payment.succeeded` |
| `success: true`, `is_refunded: true`, partly refunded (the `refunded_amount_cents` field name is unconfirmed) | `partially_refunded` | — |
| `success: true`, `is_refunded: true`, fully refunded | `refunded` | — |
| `is_refund: true` (a refund transaction) | — | `refund.succeeded` / `refund.failed`, by `success` |
| `success: false`, `pending: false` | `failed` | `payment.failed` (the message is in `data.message`) |

**Refund callbacks** describe the refund transaction (`is_refund`, `parent_transaction`). To report the payment's totals, read the parent transaction.

## 7. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `intentions.create`, then `checkout.url()`. Result: `redirect`. `gatewayPaymentId` is the intention ID (Proposal); the transaction ID arrives with the callback. |
| `retrievePayment` / `reconcile` | By transaction ID through `transactions.retrieve`, or by merchant reference through the inquiry |
| `refund`, `void`, `capture` | Native methods; all three exist |
| `confirmWithStatusQuery` default | Off (callbacks sign the key state fields) |
| Idempotency | Client-side only. Whether a duplicate `special_reference` is rejected is Uncertain (PMB-09). |

## 8. Test vectors

- **Needed before the verifier is written:** one documented or captured example each of a transaction callback, a token callback and a redirect, with the signed string and HMAC.
- **Available now:** none from Paymob. Sarraf's Paymob fixtures are synthetic and can't serve as proof.

## 9. Open questions (uncertainty register)

| ID | Question |
|---|---|
| PMB-01 | Auth-token expiry (about an hour?) |
| PMB-02 | Does the redirect carry an `hmac`, and over which field names? |
| PMB-03 | `phone_number` handling; integer vs string IDs |
| PMB-04 | The exact 20-field transaction HMAC list and order, from Paymob's page |
| PMB-05 | How null or missing values are stringified in the HMAC |
| PMB-06 | Is `type` always present on callbacks? |
| PMB-07 | Intention field names for the notification and redirection URLs; response fields |
| PMB-08 | Refund, void and capture body field names |
| PMB-09 | What a duplicate `special_reference` does |
| PMB-10 | `refunded_amount_cents` (or equivalent) on partly refunded transactions |

## 10. Validation checklist

- [ ] Diff the official Postman collections against the portal pages.
- [ ] Capture a transaction POST (paid, declined, refunded), a redirect GET and a card-token callback.
- [ ] Reproduce each HMAC from the captured payloads.
- [ ] Decode the auth token's expiry.
- [ ] Test a duplicate `special_reference`.
- [ ] Do a partial refund, a void and a capture in the sandbox.

## 11. Traps

- **CVE-2026-15205** (Paymob's WooCommerce plugin) ran a SQL query before the HMAC check. Verification goes first.
- **Units:** amounts are cents. Never send major units to the native client.
- **Boolean types:** booleans are JSON booleans in callbacks but strings in redirects.

## 12. Sources

- [developers.paymob.com/paymob-docs](https://developers.paymob.com/paymob-docs/llms.txt)
- [PaymobAccept/API-Postman-Collections](https://github.com/PaymobAccept/API-Postman-Collections)
- Sarraf `packages/paymob/src/signature.ts` and `mappers.ts`, commit `9e4bc8f` (Apache-2.0; read for design, not copied)
