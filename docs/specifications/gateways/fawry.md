# Fawry: gateway specification

*Package `@bawabajs/fawry`. Last updated 17 November 2026.*

**Validation status:** no sandbox yet, so every operation is `beta`.

**Sources:**
- **Fawry's official portal** was unreachable during research, so most facts are **Secondary**: API catalogues, a community guide, a PHP validator package, and Sarraf's implementation (synthetic fixtures only; every Sarraf Fawry status row is `verified: false`).

This file is the source of truth for `@bawabajs/fawry`. When a sandbox or the official portal contradicts it, update this file first, then the code, then `docs/logs/validation.md`. The labels are defined in [PRODUCT_REQUIREMENTS](../../requirements/PRODUCT_REQUIREMENTS.md).

---

## 1. Overview

| Item | Value |
|---|---|
| Market | Egypt (EGP) |
| Methods | Cards (including 3DS), e-wallets (`MWALLET`), ValU, instalments, **PayAtFawry** reference codes paid later at an outlet |
| Facade result kind | `reference` (PayAtFawry). Card payments without raw card data need Fawry's hosted checkout, which gives a `redirect` (FWY-08). |
| Amount format | Decimal, 2 dp (`"0.00"`); JSON bodies carry numbers |
| Signature family | **Plain SHA-256** hex with `secureKey` appended (not an HMAC); the field order differs per operation |
| Server-side idempotency | None (`merchantRefNum` is unique per merchant) |
| Test vs live | Different hosts |

## 2. Configuration

| Option | Used for | Secret |
|---|---|---|
| `merchantCode` | Every request (`merchantCode`, or `merchantAccount` for cancel) | No |
| `secureKey` | Appended to every signed string | Yes |
| `mode` | `"staging" \| "production"` | No |
| `language` | `language` / `lang` (e.g. `"en-gb"` or `"ar-eg"`; the values are Uncertain) | No |

**Hosts (Secondary):** staging `https://atfawry.fawrystaging.com`, production `https://www.atfawry.com`.

## 3. Operations and request signatures

Every signature is `sha256Hex(concat(fields) + secureKey)`. Undefined fields become `""`, and amounts are always written to **2 dp** (`250` → `"250.00"`).

| Client method | HTTP | Signed fields, in order | Kind | Label |
|---|---|---|---|---|
| `charges.create` | `POST /ECommerceWeb/Fawry/payments/charge` | `merchantCode, merchantRefNum, customerProfileId, paymentMethod, amount(2dp)` | mutation | Secondary (FWY-01) |
| `payments.status` | `GET /ECommerceWeb/Fawry/payments/status/v2?merchantCode&merchantRefNumber&signature` | `merchantCode, merchantRefNumber` | read | Secondary (FWY-02) |
| `refunds.create` | `POST /ECommerceWeb/Fawry/payments/refund` | `merchantCode, referenceNumber, refundAmount(2dp), reason` | mutation | Path Secondary (apis.io); signature Uncertain |
| `orders.cancelUnpaid` | `POST /ECommerceWeb/api/orders/cancel-unpaid-order` | `merchantAccount, orderRefNo, lang` | mutation | Path Secondary; signature Uncertain |
| `checkout.init` (hosted checkout, if FWY-08 confirms it) | `POST /fawrypay-api/api/payments/init` | `merchantCode, merchantRefNum, customerProfileId, returnUrl`, then for each item sorted by `itemId`: `itemId, quantity, price(2dp)` | mutation | Uncertain |

**Request fields:**
- **Charge body** (Secondary): `merchantCode`, `merchantRefNum`, `customerProfileId`, `customerName`, `customerMobile`, `customerEmail`, `paymentMethod` (`PAYATFAWRY`, …), `amount` (number), `currencyCode` (`EGP`), `description`, `paymentExpiry`, `chargeItems` (`itemId`, `description`, `price`, `quantity`), `language`, `signature`.
- **Charge response:** `type`, `referenceNumber`, `merchantRefNumber`, `expirationTime`, `statusCode`, `statusDescription`, `orderStatus`.
- **Mobile format:** Fawry expects local Egyptian numbers (`01xxxxxxxxx`), so convert from `+20…` (Secondary).

**Errors inside 200 responses:** Fawry reports failures in the body's `statusCode` even on HTTP 200, and a `statusCode` other than 200 is a failure. Secondary codes:
- `9946`: duplicate reference;
- `9901` / `9919`: authentication or signature errors.

The client maps these to `ApiError` subclasses. A 200 body with a failure `statusCode` on a mutation is a **definite failure**, not an unknown outcome (Proposal).

## 4. Server notification V2

- **Delivery:** a POST with JSON to the merchant's notification URL. **How that URL is configured is Uncertain** (FWY-04).
- **Fields** (Secondary): `requestId`, `fawryRefNumber`, `merchantRefNumber`, `customerMobile`, `customerMail`, `paymentAmount`, `orderAmount`, `fawryFees`, `orderStatus`, `paymentMethod`, `paymentTime`, `paymentRefrenceNumber` (Fawry's spelling), `orderExpiryDate`, `orderItems`, `messageSignature`.
- **Signature (Secondary, FWY-03):** `messageSignature` is plain SHA-256 hex over:

  ```text
  fawryRefNumber + merchantRefNumber + paymentAmount(2dp) + orderAmount(2dp)
  + orderStatus + paymentMethod + paymentRefrenceNumber ("" if missing) + secureKey
  ```

  The JSON carries `250`, but the signature uses `250.00`. Rule 2 still applies: verify from the raw body, and reformat the amounts exactly as the recipe says.
- **`signed` fields:** the seven fields above. Everything else (customer data, fees, items, times) is untrusted.
- **V1 notifications** use MD5 and a different format. **Reject them** with a clear message.
- **Acknowledgement and retries:** Uncertain (FWY-05).
- **Dedupe key:** `fawry:{fawryRefNumber}:{orderStatus}` (to confirm, FWY-06).

## 5. Status mapping (draft)

From Sarraf's table (Secondary). Every row is `verified: false`.

| `orderStatus` | Bawaba status | Event type |
|---|---|---|
| `NEW` / `UNPAID`, method `PAYATFAWRY` | `awaiting_payment` | `payment.pending` |
| `NEW` / `UNPAID`, card or wallet | `pending` | `payment.pending` |
| `PAID` | `succeeded` | `payment.succeeded` |
| `EXPIRED` | `expired` | `payment.expired` |
| `CANCELED` / `CANCELLED` | `canceled` | `payment.canceled` |
| `REFUNDED` | `refunded` | `refund.succeeded` |
| `PARTIAL_REFUNDED` | `partially_refunded` | `refund.succeeded` |
| `FAILED` | `failed` | `payment.failed` |

The payment-method values `PAYATFAWRY`, `CARD`, `MWALLET`, `VALU` and `CASHONDELIVERY` are Secondary.

## 6. Facade mapping

| Facade item | Mapping |
|---|---|
| `createPayment` (PayAtFawry) | `charges.create` with `PAYATFAWRY`. The result is `reference`: `referenceNumber`, `expiresAt` from `expirationTime`, and `gatewayPaymentId` = the reference number. |
| `createPayment` (card or wallet) | `beta`: through hosted checkout (`redirect`) once FWY-08 is settled |
| `retrievePayment` / `reconcile` | `payments.status` by `merchantRefNumber` |
| `refund` | `refunds.create` (by `referenceNumber`) |
| `void` | `orders.cancelUnpaid` for an unpaid reference code. Card voids are `unsupported` until confirmed. |
| `capture` | Auth/capture exists in the API catalogue; paths are Uncertain, so it starts `unsupported` |
| `confirmWithStatusQuery` default | **On.** The notification signs few fields, and the recipe is Secondary. |

## 7. Test vectors

- **Needed:** a documented example of each request signature and a real V2 notification (paid, expired, refunded), with the expected `messageSignature`.
- **Available now:** none official. Sarraf's Fawry fixtures and the `appssquare/payment-validator` recipe are synthetic or third-party. They can be used to cross-check our reading of the recipe, never as proof.

## 8. Open questions

| ID | Question |
|---|---|
| FWY-01 | The charge path, body and signature order, from the official portal |
| FWY-02 | The status v2 path and its signature |
| FWY-03 | The notification V2 field list and order |
| FWY-04 | How the notification URL is set (per request or in the dashboard) |
| FWY-05 | The acknowledgement code and retry policy |
| FWY-06 | The dedupe-key fields |
| FWY-07 | Amount-format edge cases (e.g. `paymentAmount` ≠ `orderAmount` when fees apply) |
| FWY-08 | Card and wallet flows without raw card data (hosted checkout `payments/init`?) |
| FWY-09 | How to "pay" a reference code in staging |
| FWY-10 | The refund and cancel signature orders; transaction listing; saved cards |
| FWY-11 | Allowed `language` values |

## 9. Validation checklist

- [ ] Read the official server-API pages and correct this file.
- [ ] Create a PayAtFawry charge in staging and pay it.
- [ ] Capture paid, expired and refunded V2 notifications, and reproduce `messageSignature`.
- [ ] Reproduce the charge, status, refund and cancel signatures from Fawry's examples.
- [ ] Try a duplicate `merchantRefNum` and record the code.

## 10. Traps

- **Not an HMAC:** the signature is a plain hash with the key appended. Using HMAC gives a wrong signature that still "looks" valid.
- **Amount formatting:** amounts in signatures are always 2 dp; the JSON uses numbers.
- **Spelling:** `paymentRefrenceNumber` is Fawry's spelling.
- **HTTP 200 doesn't mean success:** check `statusCode`.

## 11. Sources

- Official portal, to confirm: [developer.fawrystaging.com](https://developer.fawrystaging.com/docs/server-apis/server-apis-overview)
- Secondary:
  - [API catalogue](https://providers.apievangelist.com/providers/fawry/)
  - [apis.io refunds](https://apis.io/apis/fawry/fawry-refunds-api/) and [orders](https://apis.io/apis/fawry/fawry-orders-api/)
  - [community guide](https://dev.to/_moehab/a-comprehensive-guide-to-integrate-fawrypay-api-into-your-own-restful-api-server-478d)
  - [appssquare/payment-validator](https://packagist.org/packages/appssquare/payment-validator)
- Sarraf `packages/fawry/src/{client,signature,mappers}.ts`, commit `9e4bc8f` (Apache-2.0; read for design, not copied)
