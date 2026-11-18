# Amazon Payment Services (formerly PayFort): gateway specification

*Package `@bawabajs/payfort`. Last updated 17 November 2026.*

**Validation status:** no sandbox yet, so every operation is `beta`.

**Sources:**
- **paymentservices.amazon.com:** read 17 November 2026 (Verified unless marked).

This file is the source of truth for `@bawabajs/payfort`. When a sandbox contradicts it, update this file first, then the code, then `docs/validation-log.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

**Naming:** the package follows the API's host names (`*.payfort.com`). Its README calls it "a client for the Amazon Payment Services (formerly PayFort) API". Never put "amazon" in a package name, and never use the logo.

---

## 1. Overview

| Item | Value |
|---|---|
| Markets | UAE, KSA, Egypt, Kuwait, Qatar, Oman, Bahrain, Jordan |
| Methods (depend on account configuration) | **Egypt:** Meeza, Apple Pay, valU. **Gulf:** mada, KNET, NAPS, OmanNet, Benefit, STC Pay, Tabby, Tamara. |
| Checkout | **A browser form POST** of signed fields to the hosted `paymentPage`. It must not be embedded in an iframe. |
| Facade result kind | `form_post` |
| Amount format | **Integer minor units** ("AED ×100, KWD ×1000"), the same model as Bawaba's `Money` |
| Signature family | A hash of sorted `name=value` pairs, wrapped with a phrase at both ends; the SHA type is configurable |
| Server-side idempotency | `merchant_reference` must be unique per merchant; `maintenance_reference` allows a refund retry (APS-03) |
| Test vs live | Different hosts |

## 2. Configuration

| Option | Wire name / use | Secret |
|---|---|---|
| `merchantIdentifier` | `merchant_identifier` | No |
| `accessCode` | `access_code` | Yes (treat as secret) |
| `requestPhrase` | The SHA request phrase: signs requests | Yes |
| `responsePhrase` | The SHA response phrase: verifies responses and feedback | Yes |
| `shaType` | Set in the merchant dashboard; must match it. **The docs conflict** (APS-01): the configuration table lists SHA-256 (recommended), SHA-512 and SHA-128, while the signature calculator lists SHA-256, SHA-512, HMAC-SHA256 and HMAC-SHA512. | No |
| `mode` | `"sandbox" \| "production"` | No |

The dashboard sections are "Merchant Management → Security Settings" for the credentials and "Technical Settings" for the SHA type and feedback URLs. Rotating the phrases every 90 days is recommended.

**Hosts (Verified):**

| Use | Sandbox | Production |
|---|---|---|
| Hosted checkout (`paymentPage`, browser form POST) | `https://sbcheckout.payfort.com/FortAPI/paymentPage` | `https://checkout.payfort.com/FortAPI/paymentPage` |
| Server-to-server (`paymentApi`, JSON) | `https://sbpaymentservices.payfort.com/FortAPI/paymentApi` | `https://paymentservices.payfort.com/FortAPI/paymentApi` |

## 3. Operations

| Client method | Endpoint | Command and key fields | Kind | Label |
|---|---|---|---|---|
| `checkout.formFields()` | `paymentPage` (built locally; the browser POSTs it) | `command: PURCHASE` or `AUTHORIZATION`; `access_code`, `merchant_identifier`, `merchant_reference`, `amount`, `currency`, `language`, `customer_email`, `return_url`, `signature` | — (no server call) | Verified |
| `payments.capture` | `paymentApi` | `command: CAPTURE`; `merchant_reference` or `fort_id`, `amount`; within 7 days of authorization | mutation | Verified |
| `payments.voidAuthorization` | `paymentApi` | `command: VOID_AUTHORIZATION`; `merchant_reference` or `fort_id`; within 7 days, before capture | mutation | Verified |
| `payments.refund` | `paymentApi` | `command: REFUND`; `merchant_reference` or `fort_id`, `amount`; optional `maintenance_reference` | mutation | Verified |
| `payments.checkStatus` | `paymentApi` | `query_command: CHECK_STATUS`; `merchant_reference` or `fort_id`, or `maintenance_reference` for one refund | read | Verified |

**Server-to-server details:**
- Every request carries `access_code`, `merchant_identifier`, `language` and `signature`.
- Responses carry `response_code`, `response_message`, `status` and `signature`.
- **Failures arrive inside 200 responses** through `response_code`. The client maps them. The mapping from code to outcome must come from APS's response-code table (APS-07).
- **Verify the response signature** of every server-to-server response (4.2) before using it.

**Excluded:** tokenization and direct card APIs ("merchant page" / own form). They involve raw card data.

## 4. Signatures

### 4.1 Request signature

1. Take every parameter that will be sent (excluding `signature`).
2. Sort them by name (case-sensitive).
3. Concatenate them as `name=value` with **no separators**. Nulls are excluded; empty strings are kept as `name=`.
4. Wrap the string with the **request phrase at both ends**: `{phrase}{pairs}{phrase}`.
5. Hash it with the configured SHA type, as hex (implied by the examples).

For HMAC variants, whether the phrase also serves as the key, or whether the plain wrap still applies, is Uncertain (APS-01). Support SHA-256 and SHA-512 first; the HMAC variants stay `beta`.

### 4.2 Response and feedback signature

- **Recipe:** remove `signature` from the received parameters, then recompute 4.1 using the **response phrase**.
- **Feedback:** whether feedback is signed this way is Uncertain (APS-02). It is expected, but not stated.

### 4.3 Feedback (webhooks)

- **Types:** "Direct Transaction Feedback" for immediate results, and "Notification Feedback" for later changes (capture, refund, delayed status). Both are JSON POSTs to URLs configured in "Technical Settings".
- **Acknowledgement:** the merchant **must answer 2xx**.
- **Retries:** not documented (APS-04).
- **`signed` fields:** all received parameters except `signature`, once APS-02 is confirmed. Until then, every field is treated as untrusted and the status re-query is on.
- **Dedupe key:** `payfort:{fort_id}:{command}:{status}`.

## 5. Status mapping (draft)

APS reports a two-part result: a `status` and a 5-digit `response_code`. The code values and their meanings must be read from APS's response-code table and confirmed with captures (APS-07). Every row is written then, all `verified: false`.

| APS result | Bawaba status |
|---|---|
| `PURCHASE` success | `succeeded` |
| `AUTHORIZATION` success | `authorized` |
| `CAPTURE` success | `succeeded` |
| `VOID_AUTHORIZATION` success | `canceled` |
| `REFUND` success | `refunded` / `partially_refunded` (by totals from `checkStatus`) |
| Declined or failed | `failed` |
| Pending or 3DS in progress | `pending` / `requires_action` |

## 6. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `checkout.formFields()` returns `form_post`: `{ action: paymentPage URL, fields, merchantReference }`. There is **no gateway ID until feedback arrives**: `fort_id` comes with it. |
| `retrievePayment` / `reconcile` | `payments.checkStatus` by `merchant_reference` or `fort_id` |
| `refund` | `payments.refund`. The `idempotencyKey` maps to `maintenance_reference` once APS-03 is confirmed. |
| `capture` / `void` | `payments.capture` / `payments.voidAuthorization` (7-day windows) |
| `confirmWithStatusQuery` default | **On**, until APS-02 confirms that feedback is signed |

## 7. Test vectors

- **Needed:** an example from APS's signature calculator for each SHA type (a known input and its output); a sandbox `PURCHASE` round trip; and captured direct and notification feedback with signatures.
- **Available now:** the signature page's worked example (extract its inputs and output when the build starts).

## 8. Open questions

| ID | Question |
|---|---|
| APS-01 | Which SHA types the dashboard offers, and how the HMAC variants are computed |
| APS-02 | Whether feedback is signed with the response phrase |
| APS-03 | `maintenance_reference` retry semantics (safe idempotent refund retry?) |
| APS-04 | The feedback retry policy |
| APS-05 | The 302 response conflict noted in the docs |
| APS-06 | Visa's "last decimal is 0" rule in practice for 3-decimal currencies |
| APS-07 | The response-code and status table |

## 9. Validation checklist

- [ ] Open a sandbox account, and enable the SHA type and feedback URLs.
- [ ] Complete an EGP or AED `PURCHASE` through the form POST in a real browser.
- [ ] Capture direct and notification feedback, and reproduce their signatures.
- [ ] Authorize, capture, void and refund; test a refund retry with the same `maintenance_reference`.
- [ ] Reproduce the request signature for each available SHA type.

## 10. Traps

- **Empty values:** empty strings are signed as `name=`; nulls are dropped. Getting this wrong fails silently on optional fields.
- **Phrases:** the request phrase signs; the **response** phrase verifies. Swapping them is a classic bug.
- **Amounts:** amounts are already minor units. Don't multiply by 100 again.
- **Embedding:** the hosted page must not be put in an iframe.

## 11. Sources

- [Signature](https://paymentservices.amazon.com/docs/developer-resources/signature)
- [API reference](https://paymentservices.amazon.com/docs/api)
- [Hosted checkout](https://paymentservices.amazon.com/docs/api/accepting-payments/hosted-checkout)
- [Refund](https://paymentservices.amazon.com/docs/api/managing-payments/refund), [capture](https://paymentservices.amazon.com/docs/api/managing-payments/capture), [void](https://paymentservices.amazon.com/docs/api/managing-payments/void-auth), [check status](https://paymentservices.amazon.com/docs/api/managing-payments/check-status)
- [Webhooks (feedback)](https://paymentservices.amazon.com/docs/managing-payments/tracking-a-payment/webhooks)
- [Payment methods](https://paymentservices.amazon.com/docs/payment-methods/payment-methods-support)
