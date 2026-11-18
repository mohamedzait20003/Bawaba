# Geidea: gateway specification

*Package `@bawabajs/geidea`. Last updated 17 November 2026.*

**Validation status:** no sandbox yet, so every operation is `beta`.

**Sources:**
- **docs.geidea.net:** read 17 November 2026 (Verified unless marked).
- **No other SDK** was available to cross-check.

This file is the source of truth for `@bawabajs/geidea`. When a sandbox contradicts it, update this file first, then the code, then `docs/logs/validation.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Markets | Egypt, KSA, UAE |
| Methods | **All markets:** cards, Apple Pay, Google Pay. **Egypt:** Meeza QR, valU, Souhoola, instalments. **KSA and UAE:** Tabby, Tamara. |
| Checkout | **A JavaScript checkout started with a session ID.** Whether a plain redirect URL also exists is Uncertain (GDA-06). |
| Facade result kind | `embedded` |
| Amount format | Decimal major units, 2 dp (`19.99`) |
| Signature family | HMAC-SHA256, **base64**, over fixed fields, keyed with the API password |
| Server-side idempotency | None documented |
| Test vs live | Probably the same host, with the `isTest` flag and credentials (Uncertain, GDA-05) |

## 2. Configuration and authentication

| Option | Used for | Secret |
|---|---|---|
| `publicKey` | The HTTP Basic username; the first field of every signed string | No |
| `apiPassword` | The HTTP Basic password; the HMAC key | Yes |
| `region` | `"EG" \| "SA" \| "AE"` | No |

**Auth:** HTTP Basic (`publicKey:apiPassword`).

**Hosts (Verified):**

| Region | API host | Checkout script |
|---|---|---|
| EG | `https://api.merchant.geidea.net` | `https://www.merchant.geidea.net/hpp/geideaCheckout.min.js` |
| SA | `https://api.ksamerchant.geidea.net` | Uncertain (GDA-09) |
| AE | `https://api.geidea.ae` | Uncertain (GDA-09) |

## 3. Operations

| Client method | HTTP | Kind | Label |
|---|---|---|---|
| `sessions.create` | `POST /payment-intent/api/v2/direct/session` | mutation | Verified |
| `checkout.scriptUrl()` | Local, per region | — | EG Verified; SA and AE Uncertain |
| `orders.retrieve` | `GET /pgw/api/v1/direct/order/{orderId}`: the status, plus authorized, captured and refunded totals | read | Verified |
| `orders.refund` | `POST /pgw/api/v2/direct/refund` (`orderId`, `refundAmount`, `timestamp`, `signature`, `callbackUrl`) | mutation | Verified path; **signature formula Uncertain** (GDA-04) |
| `orders.capture` | `POST /pgw/api/v1/direct/capture` | mutation | Verified path; body to confirm |
| `orders.void` | `POST /pgw/api/v3/direct/void` | mutation | Verified path; body to confirm |

**Session fields:**
- `amount`, `currency`, `timestamp`, `merchantReferenceId`, `signature`;
- `callbackUrl`, and `returnUrl` (mandatory for Tabby);
- `language`;
- `paymentOperation` (`Pay`, `PreAuthorize` or `AuthorizeCapture`);
- customer, order-item and card-on-file fields.

The session expires after **15 minutes**.

**`merchantReferenceId`:** the schema says "must be a valid UUID", but the examples use other formats (GDA-02). Until this is settled, the client accepts any string and documents the conflict.

**Errors inside 200 responses:** Geidea reports results in `responseCode` (and probably a message field). The success values are Uncertain (GDA-07). The client maps failures to errors, and declines to results.

## 4. Signatures

### 4.1 Request signature (session)

- **Algorithm:** HMAC-SHA256 keyed with `apiPassword`, output as **base64**.
- **Signed string** (from Geidea's PHP and C# samples; the prose only says "SHA-256"):

  ```text
  {publicKey}{amount formatted to 2 dp}{currency}{merchantReferenceId}{timestamp}
  ```
- **The timestamp format conflicts** (GDA-01). The sample uses `Y/m/d H:i:s`, while the OpenAPI default looks like `2/21/2024 5:16:48 AM`. The client must use **one tested format**, sending the same string in the body and the signature.

### 4.2 Callback signature

- **Algorithm:** the same as 4.1.
- **Signed string:** `{publicKey}{orderAmount}{orderCurrency}{orderId}{status}{merchantReferenceId}{timestamp}`.
- **Unknowns:** the HTTP method, the full body field list and the name of the signature field are Uncertain (GDA-03).
- **`signed` fields:** `orderAmount`, `orderCurrency`, `orderId`, `status`, `merchantReferenceId` and `timestamp`.
- **When callbacks are sent:** no callback while an order is `InProgress`. A callback **is** sent when the customer cancels.
- **Acknowledgement and retries:** Uncertain (GDA-08).
- **The signed `timestamp`:** whether it means delivery time or transaction time is Uncertain (GDA-10). It isn't used for replay protection.
- **Dedupe key:** `geidea:{orderId}:{status}`.

## 5. Status mapping (draft)

The callback `status` values and the order statuses from `orders.retrieve` must be taken from Geidea's sample callback page and a real capture (GDA-11). Known so far: an `InProgress` state exists, and no callback is sent in it, and cancellation produces a callback. Every mapping row is written after GDA-11, all `verified: false`.

| Geidea state | Bawaba status |
|---|---|
| Paid (`Pay` or `AuthorizeCapture`) | `succeeded` |
| Authorized (`PreAuthorize`) | `authorized` |
| Customer cancelled | `canceled` |
| Failed or declined | `failed` |
| Refunded (totals from `orders.retrieve`) | `refunded` / `partially_refunded` |
| Session expired (15 min) | `expired` (whether Geidea reports it is Uncertain) |

## 6. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `sessions.create` returns `embedded`: `{ sessionId, scriptUrl: checkout.scriptUrl(region), expiresAt: created + 15 min }`. The order ID arrives with the callback. |
| `retrievePayment` / `reconcile` | `orders.retrieve(orderId)` |
| `refund`, `capture`, `void` | Native methods; refund stays `beta` until GDA-04 |
| `confirmWithStatusQuery` default | Off. The callback signs the status and amount. Turn it on if GDA-03 shows fewer signed fields. |

## 7. Test vectors

- **Needed:** Geidea's sample signature (a documented input and its base64 output), a real session request accepted by the sandbox, and a real callback with its signature.
- **Available now:** the PHP and C# samples in the docs (inputs only; extract an example with a known output if one exists).

## 8. Open questions

| ID | Question |
|---|---|
| GDA-01 | The request timestamp format |
| GDA-02 | Whether `merchantReferenceId` must be a UUID |
| GDA-03 | The callback HTTP method, body fields and signature field name |
| GDA-04 | The refund (and capture/void) signature formula |
| GDA-05 | Whether test and live share hosts |
| GDA-06 | Whether a plain redirect URL exists besides the JS checkout |
| GDA-07 | `responseCode` success values and the error format |
| GDA-08 | The callback acknowledgement and retry policy |
| GDA-09 | The checkout script URLs for KSA and UAE |
| GDA-10 | Whether the signed `timestamp` means delivery or transaction time |
| GDA-11 | The full list of order and callback status values |

## 9. Validation checklist

- [ ] Create a session in the sandbox with the chosen timestamp format (settles GDA-01).
- [ ] Complete an embedded checkout in a real browser (Playwright or manual).
- [ ] Capture success, failure and customer-cancel callbacks, and reproduce their signatures.
- [ ] Refund, capture and void, and confirm their signatures.
- [ ] Try a non-UUID `merchantReferenceId`.

## 10. Traps

- **Output encoding:** the output is **base64**, not hex. Compare by decoding both sides to bytes.
- **Amount formatting:** amounts in the signed string are formatted to 2 dp. The callback's `orderAmount` must be used exactly as received in the raw body, or as the recipe defines it; confirm which with a capture.
- **Embedded checkout:** the hosted script must load in the merchant's page. It can't be a server-side redirect.

## 11. Sources

- [Checkout v2](https://docs.geidea.net/docs/geidea-checkout-v2)
- [Create session](https://docs.geidea.net/reference/create-session-v2)
- [Merchant-initiated transactions](https://docs.geidea.net/docs/merchant-initiated-mit)
- [Sample callbacks](https://docs.geidea.net/docs/sample-callback-responses)
- [Refund](https://docs.geidea.net/reference/refund-1-1), [capture](https://docs.geidea.net/reference/capture-transaction-1), [void](https://docs.geidea.net/reference/void-payment-1), [fetch order](https://docs.geidea.net/reference/get-order-by-id-1)
