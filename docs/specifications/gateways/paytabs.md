# PayTabs: gateway specification

*Package `@bawabajs/paytabs` (the PT2 API). Last updated 17 November 2026.*

**Validation status:** no sandbox yet, so every operation is `beta`.

**Sources:**
- **support.paytabs.com:** read 17 November 2026 (Verified unless marked).
- **Regional hosts:** from third-party module docs (Secondary).

This file is the source of truth for `@bawabajs/paytabs`. When a sandbox contradicts it, update this file first, then the code, then `docs/logs/validation.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Markets | KSA, UAE, Egypt, Qatar, Oman, Jordan, Iraq and others |
| Currencies (`cart_currency`) | AED, BHD, EGP, EUR, GBP, IQD, JOD, KWD, MAD, OMR, QAR, SAR, USD and others |
| Checkout | A hosted payment page; the response returns `redirect_url` |
| Facade result kind | `redirect` |
| Amount format | Decimal major units (`cart_amount`, from 0.01 to 9,999,999,999.99) |
| Signature family | HMAC-SHA256 hex over the **raw body** (IPN); sorted, URL-encoded fields (return POST) |
| Server-side idempotency | None. `cart_id` is **not** unique, because refunds and captures reuse it. |
| Test vs live | Uncertain (PTB-03) |

## 2. Configuration and authentication

| Option | Used for | Secret |
|---|---|---|
| `serverKey` | The `authorization` header (Uncertain, PTB-02; widely used in samples) and the HMAC key for the IPN and return signatures | Yes |
| `profileId` | `profile_id` (an integer) in every request | No |
| `region` | Selects the host. **A server key is bound to one region** (Secondary). | No |
| `host` | An explicit override, needed until the official host list is confirmed | No |

**Hosts:** every endpoint is `{{domain}}/...`, with the domain set by the region. The official region page failed to load (PTB-01).

| Region | Host | Label |
|---|---|---|
| KSA | `https://secure.paytabs.sa` | Secondary |
| UAE | `https://secure.paytabs.com` | Secondary |
| Egypt | `https://secure-egypt.paytabs.com` | Secondary |
| Qatar (Doha) | `https://secure-doha.paytabs.com` | Secondary |
| Global | `https://secure-global.paytabs.com` | Secondary |
| Oman, Jordan, Iraq, Kuwait | — | Uncertain |

## 3. Operations

All operations are POSTs with JSON bodies.

| Client method | HTTP | Key fields | Kind | Label |
|---|---|---|---|---|
| `payments.request` | `POST {domain}/payment/request` | `profile_id`, `tran_type` (`sale` or `auth`), `tran_class` (`ecom`), `cart_id` (1–64 characters), `cart_description`, `cart_currency`, `cart_amount`; optional `callback` (server POST) and `return` (browser POST) | mutation | Verified |
| `transactions.refund` | `POST {domain}/payment/request` | `tran_type: "refund"`, `tran_ref`, plus the cart fields | mutation | Verified |
| `transactions.capture` | `POST {domain}/payment/request` | `tran_type: "capture"`, `tran_ref`, plus the cart fields | mutation | Verified |
| `transactions.void` | `POST {domain}/payment/request` | `tran_type: "void"`, `tran_ref`, plus the cart fields | mutation | Verified |
| `transactions.query` | `POST {domain}/payment/query` | `profile_id`, plus `tran_ref` (one transaction) or `cart_id` (an array of every transaction on that cart) | read: a POST that moves no money | Verified |

The `payments.request` response includes `redirect_url`, and is expected to include `tran_ref` (to confirm, PTB-07).

**Excluded:** the "own form" and direct card APIs. They accept raw card data.

## 4. Signatures

### 4.1 IPN (server callback to `callback`)

- **Delivery:** a POST to the `callback` URL. The signature is in the **`Signature` header**.
- **Algorithm:** HMAC-SHA256 hex of the **entire raw body**, keyed with `serverKey`. Hash the exact bytes received. Never re-serialize.
- **`signed` fields:** every field, because the whole body is signed.
- **Acknowledgement:** 200.
- **Retries:** no retry policy is documented (PTB-06).
- **Dedupe key:** `paytabs:{tran_ref}:{response_status}`. Where `response_status` sits in the payload is to be confirmed (PTB-08).

### 4.2 Return (browser POST to `return`)

- **Recipe:**
  1. Remove `signature` and every empty field.
  2. Sort the rest by key.
  3. URL-encode them as a query string.
  4. Compute HMAC-SHA256 hex with `serverKey`.
  5. Compare with `signature`.
- **Encoding:** whether spaces encode as `+` or `%20` is Uncertain (PTB-04). PHP's `http_build_query`, used in PayTabs' samples, produces `+`.
- **Result:** `redirects.verify` returns `authenticated` only. Order state comes from the IPN or `transactions.query`.

## 5. Status mapping (draft)

The full list of `response_status` values, and their meanings, must be read from PayTabs' docs and confirmed with captures before writing the table (PTB-08). Each `tran_type` (`sale`, `auth`, `capture`, `void`, `refund`) combines with a status:

| PayTabs state | Bawaba status |
|---|---|
| `sale` approved | `succeeded` |
| `auth` approved | `authorized` |
| `capture` approved | `succeeded` |
| `void` approved | `canceled` |
| `refund` approved | `refunded` / `partially_refunded` (by totals from `transactions.query`) |
| Declined or error | `failed` |
| Pending or on hold | `pending` |

## 6. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` | `payments.request` returns `redirect`: `{ url: redirect_url, gatewayPaymentId: tran_ref }` |
| `retrievePayment` / `reconcile` | `transactions.query` by `tran_ref`, or by `cart_id` (returns a list) |
| `refund`, `capture`, `void` | Native methods (partial refund and capture limits: PTB-05) |
| `confirmWithStatusQuery` default | Off (the whole body is signed) |
| Idempotency | Client-side only. A `cart_id` can't serve as an idempotency key, because it isn't unique. |

## 7. Test vectors

- **Needed:** a real IPN with its raw bytes and `Signature` header, and a real return POST containing a value with a space (settles PTB-04).
- **Available now:** examples on the signatures page (extract one with a known output if the page has one).

## 8. Open questions

| ID | Question |
|---|---|
| PTB-01 | The official regional host list (Oman, Jordan, Iraq, Kuwait) |
| PTB-02 | The auth header name |
| PTB-03 | Whether test and live share hosts |
| PTB-04 | `+` or `%20` for spaces in the return signature |
| PTB-05 | Partial refund and capture limits |
| PTB-06 | The IPN retry policy |
| PTB-07 | The `payments.request` response fields (`tran_ref`, …) |
| PTB-08 | `response_status` values and where they sit in the IPN and query payloads |

## 9. Validation checklist

- [ ] Get a test profile per region to be tested (each key is bound to one region).
- [ ] Confirm the host and auth header with a real `payments.request`.
- [ ] Capture an IPN for sale, auth, capture, void and refund, and reproduce each signature from the raw bytes.
- [ ] Capture a return POST with a space in a value.
- [ ] Do a partial refund and a partial capture.

## 10. Traps

- **Raw bytes:** PayTabs is the only gateway of the seven that signs the raw body. Any framework that parses JSON before the verifier breaks it.
- **Duplicates:** `cart_id` is not unique across transactions on the same order.
- **Regions:** a server key from one region fails on another region's host.

## 11. Sources

- [PT2 manual](https://support.paytabs.com/en/support/solutions/articles/60000709775)
- [Hosted payment page request](https://support.paytabs.com/en/support/solutions/articles/60000992876)
- [Signatures](https://support.paytabs.com/en/support/solutions/articles/60000718961)
- [Query](https://support.paytabs.com/en/support/solutions/articles/60000806381)
- [Refund](https://support.paytabs.com/en/support/solutions/articles/60000807026), [capture](https://support.paytabs.com/en/support/solutions/articles/60000807019), [void](https://support.paytabs.com/en/support/solutions/articles/60000807023)
- Regional hosts (Secondary): [Ecosire Odoo module docs](https://docs.ecosire.com/odoo-modules/paytabs-gateway)
