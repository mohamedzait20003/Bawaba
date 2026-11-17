# Tap Payments: gateway specification

*Package `@bawaba/tap`. Last updated 17 November 2026.*

**Validation status:** no sandbox yet, so every operation is `beta`.

**Sources:**
- **developers.tap.company:** read 17 November 2026 (Verified unless marked).

This file is the source of truth for `@bawaba/tap`. When a sandbox contradicts it, update this file first, then the code, then `docs/validation-log.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Markets | Kuwait, KSA, UAE, Bahrain, Qatar, Oman, Egypt |
| Checkout | Redirect to `transaction.url` |
| Facade result kind | `redirect`; possibly `reference` for `src_eg.fawry` (TAP-06) |
| Amount format | Decimal major units with the currency's ISO decimals: 3 for BHD, KWD, OMR and JOD, 2 for the others. The minimum is 0.100. |
| Signature family | HMAC-SHA256 hex over labelled fields (`hashstring` header) |
| Server-side idempotency | **Yes.** `reference.idempotent` returns the original response for the same value within 24 hours. Tap is the only gateway of the seven with it. |
| Test vs live | The same host; differs by key (`sk_test_…` / `sk_live_…`, inferred from the examples) |
| Official SDK | `@tap-payments/node` 0.1.4. Bawaba still builds a native client (TECHNICAL_SPECIFICATIONS §6.4). |

## 2. Configuration and authentication

| Option | Used for | Secret |
|---|---|---|
| `secretKey` | `Authorization: Bearer <secret key>`, and the webhook HMAC key | Yes |

**Host:** `https://api.tap.company/v2/`.

## 3. Operations

| Client method | HTTP | Kind | Label |
|---|---|---|---|
| `charges.create` | `POST /v2/charges` | mutation | Verified |
| `charges.retrieve` | GET path Uncertain (TAP-01) | read | Uncertain |
| `authorizations.create` | `POST /v2/authorize` | mutation | Verified |
| `authorizations.capture` | `POST /v2/charges` with `source.id` = the `auth_…` ID | mutation | Verified |
| `refunds.create` | `POST /v2/refunds` (`charge_id`, `amount`, `currency`, `reason`) | mutation | Verified; the `amount` type is Uncertain (TAP-03) |

**Charge fields:**
- **Required:** `amount`, `currency`, `customer` (`first_name`, `email`), `source.id` and `redirect.url`.
- **Optional:** `post.url` (the webhook), plus `reference.transaction`, `reference.order` and `reference.idempotent`.

**`source.id` helpers:**
- generic: `src_all`, `src_card`, or a token;
- local methods: `src_kw.knet`, `src_sa.mada`, `src_bh.benefit`, `src_benefitpay`, `src_qa.qpay`, `src_omannet`, `src_eg.fawry`, `src_sa.stcpay`;
- wallets and instalments: Tabby, Apple Pay, Google Pay and Samsung Pay.

**Void:** **there is no manual void endpoint.** A void is scheduled with an `auto` rule on the authorization (1–168 hours). The native client exposes that rule; the facade's immediate `void` is `unsupported`.

**Enabling local methods** may need a request to Tap, even in test mode (Uncertain).

## 4. Webhook signature

- **Delivery:** a POST with JSON to `post.url`. The signature is in the **`hashstring`** header.
- **Algorithm:** HMAC-SHA256 hex, keyed with `secretKey`.
- **Signed string, for charges, authorizations and voids:**

  ```text
  x_id{id}x_amount{amount}x_currency{currency}x_gateway_reference{reference.gateway}
  x_payment_reference{reference.payment}x_status{status}x_created{transaction.created}
  ```

  This is one continuous string; the line break is only for display. The amount is formatted to the currency's decimals (e.g. `1.500` for KWD, `10.00` for SAR).
- **Other event types:**
  - **Refunds** use the same pattern with the refund's fields. The exact field paths are Uncertain (TAP-07).
  - **Invoices** use a different pattern (not in scope).
- **Third-party recipe:** `@commercejs/webhook-verifier` describes a **different** recipe. Follow Tap's.
- **`signed` fields:** `id`, `amount`, `currency`, `reference.gateway`, `reference.payment`, `status` and `transaction.created`. Everything else is untrusted, which is why the status re-query defaults to on.
- **Timestamp:** whether `x_created` means delivery time or transaction time is Uncertain (TAP-08). It isn't used for replay protection.
- **Other headers:** a `hash` header also appears; its meaning is Uncertain (TAP-05).
- **Retries:** payloads carry `post.attempt` and `post.status`, but the schedule isn't documented (TAP-04).
- **Acknowledgement:** 200.
- **Dedupe key:** `tap:{id}:{status}`.

## 5. Redirect

- **Delivery:** the customer returns to `redirect.url` with appended parameters.
- **Unknowns:** which parameters are appended, and whether they are signed (TAP-02).
- **Until then:** `redirects.verify` returns `authenticated: false` and reads the charge by ID.

## 6. Status mapping (draft)

The charge `status` values must be read from Tap's charge-object reference and confirmed with captures (TAP-09). Every row is written then, all `verified: false`.

| Tap state | Bawaba status |
|---|---|
| Captured charge | `succeeded` |
| Authorized (`auth_…`) | `authorized` |
| Initiated or in progress (3DS, redirect pending) | `pending` / `requires_action` |
| Declined, failed or restricted | `failed` |
| Cancelled or abandoned | `canceled` |
| Timed out | `expired` |
| Voided (scheduled `auto`) | `canceled` |
| Refund succeeded | `refunded` / `partially_refunded` |

## 7. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `charges.create` returns `redirect`: `{ url: transaction.url, gatewayPaymentId: charge id }` |
| `retrievePayment` / `reconcile` | `charges.retrieve` (`beta` until TAP-01) |
| `refund` | `refunds.create` |
| `capture` | `authorizations.capture` |
| `void` | `unsupported` (scheduled only) |
| Idempotency | The caller's `idempotencyKey` is sent as `reference.idempotent` on charges, authorizations and refunds, as well as stored client-side. Its length and charset limits are Uncertain (TAP-10). |
| `confirmWithStatusQuery` default | **On** (few fields are signed) |

## 8. Test vectors

- **Needed:** a captured charge webhook with its `hashstring` for a 2-decimal and a 3-decimal currency; a refund webhook; an authorize webhook.
- **Available now:** the webhook page's recipe. Use a worked example if the page has one.

## 9. Open questions

| ID | Question |
|---|---|
| TAP-01 | The retrieve-charge path |
| TAP-02 | The parameters appended to `redirect.url`, and whether they are signed |
| TAP-03 | The refund `amount` type (integer or decimal) |
| TAP-04 | The webhook retry schedule |
| TAP-05 | The meaning of the `hash` header |
| TAP-06 | The result shape of `src_eg.fawry` (a reference code?) |
| TAP-07 | The exact field paths in the refund `hashstring` |
| TAP-08 | Whether `x_created` means delivery or transaction time |
| TAP-09 | The charge `status` values |
| TAP-10 | Length and charset limits of `reference.idempotent` |

## 10. Validation checklist

- [ ] Create charges in KWD and SAR, and capture both webhooks; reproduce `hashstring`.
- [ ] Prove `reference.idempotent` replay: the same value returns the same charge.
- [ ] Authorize then capture; schedule an auto-void.
- [ ] Refund, and capture the refund webhook.
- [ ] Return 500 once, and record the `post.attempt` behaviour.

## 11. Traps

- **Amount decimals:** format with the **currency's** decimals in the signed string. KWD has 3.
- **Void:** there is no immediate void; don't fake one with a refund.
- **Third-party recipes:** ignore them; Tap's own recipe wins.

## 12. Sources

- [Webhook](https://developers.tap.company/docs/webhook)
- [Create charge](https://developers.tap.company/reference/create-a-charge)
- [Authentication](https://developers.tap.company/reference/api-endpoint)
- [Authorize](https://developers.tap.company/docs/authorize), [authorize and capture](https://developers.tap.company/docs/authorize-and-capture)
- [Refund](https://developers.tap.company/reference/create-a-refund)
- [Idempotency](https://developers.tap.company/docs/idempotency)
- Official SDK: [`@tap-payments/node`](https://www.npmjs.com/package/@tap-payments/node)
