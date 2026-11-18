# Bawaba: product specifications

*Last updated 17 November 2026. Status: Proposal. No code exists yet, so every API here is a design target and the examples are illustrative.*

This document describes Bawaba **as developers will use it**: packages, configuration, the facade API, the gateway-native clients, errors, webhooks and the guarantees the SDK makes. The requirements behind it are in [PRODUCT_REQUIREMENTS.md](../requirements/PRODUCT_REQUIREMENTS.md). The internals and the verified gateway facts are in [TECHNICAL_SPECIFICATIONS.md](TECHNICAL_SPECIFICATIONS.md).

---

## 1. Packages

| Package | Purpose | Entry points |
|---|---|---|
| `bawaba` | Unified facade; the package most users install | `.`, plus `./paymob`, `./kashier`, `./fawry`, `./geidea`, `./paytabs`, `./payfort`, `./tap` |
| `@bawabajs/core` | Request pipeline, errors, money, crypto, idempotency, shared types | `.`, `./conformance` |
| `@bawabajs/paymob` | Full Paymob client | `.`, `./webhooks` |
| `@bawabajs/kashier` | Full Kashier client | `.`, `./webhooks` |
| `@bawabajs/fawry` | Full Fawry client | `.`, `./webhooks` |
| `@bawabajs/geidea` | Full Geidea client | `.`, `./webhooks` |
| `@bawabajs/paytabs` | Full PayTabs (PT2) client | `.`, `./webhooks` |
| `@bawabajs/payfort` | Full client for the Amazon Payment Services (formerly PayFort) API | `.`, `./webhooks` |
| `@bawabajs/tap` | Full Tap Payments client | `.`, `./webhooks` |
| `@bawabajs/testing` | Scrubbed fixtures and test signers for all seven gateways | `.`, one subpath per gateway |
| `@bawabajs/express`, `@bawabajs/nestjs`, `@bawabajs/next` | Framework adapters that capture the raw body (after 1.0) | `.` |

- **Install** `bawaba` to use several gateways through one API, or a single `@bawabajs/<gateway>` to use one gateway with its own field names.
- **Bundle size:** `npm install bawaba` installs all seven (dependency-free) clients, but an app bundles only the gateway subpaths it imports.
- **Runtime:** Node `>=22.12`, Bun, Deno, Cloudflare Workers and Vercel Edge, with ESM and CommonJS builds. Server-side only: clients refuse to start with secret keys in a browser-like environment.

Every package README and description carries this notice: *"Unofficial. Not affiliated with Paymob, Kashier, Fawry, Geidea, PayTabs, Amazon Payment Services or Tap Payments."*

## 2. Core concepts

### 2.1 Money and currency

```typescript
type Money = { minor: number; currency: Currency }; // minor = integer minor units
```

- **`minor`, not `amount`:** the name keeps it from being confused with a gateway's own `amount` field. `{ minor: 150_000, currency: "EGP" }` is 1,500.00 EGP, and `{ minor: 1_500, currency: "KWD" }` is 1.500 KWD.
- **Currencies:**
  - 2 decimals: `EGP`, `SAR`, `AED`, `QAR`, `MAD`, `USD`, `EUR`, `GBP`;
  - 3 decimals: `KWD`, `BHD`, `OMR`, `JOD`, `IQD`.
- **Conversion:** each client converts `Money` to its gateway's format. Callers never format amounts for the facade.
- **Helpers:** `toDecimalString(money)` and `fromDecimalString(text, currency)` are exact. They reject non-integers, floats and excess precision rather than rounding.
- **Native clients:** these take amounts in the gateway's own format (for example `amount_cents` for Paymob, `cart_amount` for PayTabs), because they use wire-format fields.

### 2.2 Capability levels

Every operation and payment method of every gateway has a level:
- **`supported`:** confirmed against a real sandbox and recorded in the validation log.
- **`beta`:** implemented from the documentation but not yet confirmed. Calling it throws `CapabilityError` unless the client or facade was created with `allowBeta: true`.
- **`unsupported`:** the gateway doesn't offer it. This is a compile-time error where the types allow it, and a `CapabilityError` at runtime otherwise.

```typescript
bawaba.capabilities("tap").void;   // "unsupported": Tap only schedules voids
paymob.capabilities.refund;        // "supported" | "beta" | "unsupported"
```

Levels change only in releases. Lifting a `beta` flag is a patch release, with the validation-log entry that proves it.

### 2.3 Idempotency keys

Every money-moving call (`createPayment`, `refund`, `capture`, `void`, and their native equivalents) accepts an optional `idempotencyKey`:
- **Same key, same parameters:** returns the stored result without calling the gateway again.
- **Same key, different parameters:** throws `IdempotencyError` (`idempotency_key_reused`).
- **After an unknown outcome** (`OutcomeUnknownError`), the key stays claimed. A retry with that key throws `IdempotencyError` (`idempotency_outcome_unknown`) until the caller reconciles and releases it.
- **The default store is in memory**, which is per process. Apps running more than one instance must pass an `idempotencyStore` backed by Redis or their database (interface in TECHNICAL_SPECIFICATIONS §3.3).
- **Tap** also receives the key as `reference.idempotent`, its server-side idempotency (24 hours), so a reconciled retry is provably safe there.

### 2.4 Trust levels: `signed` vs `raw`

Webhook events and redirect results separate the fields a gateway authenticates from everything else:
- **`signed`** contains only fields covered by the gateway's signature (or re-read from its status API).
- **`raw`** is the full payload, typed as untrusted.

Act on `signed` fields only. For PayTabs, whose IPN signs the whole body, every field is signed.

## 3. The facade (`bawaba`)

The facade covers only what the gateways genuinely share. Anything else is reachable through the native client (`bawaba.gateway(name)`) or `raw`.

### 3.1 Construction

```typescript
import { Bawaba } from "bawaba";
import { paymob } from "bawaba/paymob";
import { fawry } from "bawaba/fawry";
import { geidea } from "bawaba/geidea";
import { payfort } from "bawaba/payfort";
import { tap } from "bawaba/tap";

const bawaba = new Bawaba({
  gateways: {
    paymob: paymob({
      secretKey: process.env.PAYMOB_SECRET_KEY,
      apiKey: process.env.PAYMOB_API_KEY,
      publicKey: process.env.PAYMOB_PUBLIC_KEY,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET,
      region: "EG",
      integrationIds: { card: 158 },
    }),
    fawry: fawry({ merchantCode: process.env.FAWRY_MERCHANT_CODE, secureKey: process.env.FAWRY_SECURE_KEY, mode: "staging" }),
    geidea: geidea({ publicKey: process.env.GEIDEA_PUBLIC_KEY, apiPassword: process.env.GEIDEA_API_PASSWORD, region: "EG" }),
    payfort: payfort({
      merchantIdentifier: process.env.APS_MERCHANT_IDENTIFIER,
      accessCode: process.env.APS_ACCESS_CODE,
      requestPhrase: process.env.APS_SHA_REQUEST_PHRASE,
      responsePhrase: process.env.APS_SHA_RESPONSE_PHRASE,
      shaType: "SHA-256",
      mode: "sandbox",
    }),
    tap: tap({ secretKey: process.env.TAP_SECRET_KEY }),
  },
  idempotencyStore: myRedisStore, // optional; in-memory by default
  allowBeta: false,               // features not confirmed in a sandbox stay off
});
```

Facade methods are typed by the configured gateways. For example, `bawaba.createPayment("kashier", …)` doesn't compile if Kashier isn't configured.

### 3.2 Operations

| Operation | Purpose | Money-moving (takes `idempotencyKey`) |
|---|---|---|
| `createPayment(gateway, params)` | Start a checkout; returns one of four result kinds (3.3) | Yes |
| `retrievePayment(gateway, { gatewayPaymentId \| merchantReference })` | Read the current state from the gateway | No |
| `reconcile(gateway, { gatewayPaymentId \| merchantReference })` | Read the state after an `OutcomeUnknownError` and release the idempotency claim it resolves | No |
| `refund(gateway, { gatewayPaymentId, money, reason? })` | Full or partial refund | Yes |
| `capture(gateway, { gatewayPaymentId, money })` | Capture an authorization | Yes |
| `void(gateway, { gatewayPaymentId })` | Cancel an uncaptured authorization | Yes |
| `webhooks.verify(gateway, input)` | Verify and normalize a callback (3.6) | No |
| `webhooks.inspect(gateway, input)` | Explain a verification result without throwing | No |
| `webhooks.alreadyProcessed(gateway)` | The acknowledgement response for a duplicate | No |
| `redirects.verify(gateway, input)` | Verify the thank-you-page parameters (3.7) | No |
| `capabilities(gateway)` | Capability levels (2.2) | No |
| `gateway(name)` | The full native client (section 5) | No |

`createPayment` parameters: `money`, `merchantReference`, `customer` (`email`, `phone`, name), `returnUrl`, `webhookUrl`, `idempotencyKey?`, and `method?` (a gateway-specific payment method, such as a Tap source or a Fawry reference payment).

### 3.3 Checkout results

`createPayment` returns a discriminated union. Each kind has all of its fields present.

| Kind | Shape | Gateways | What the app does |
|---|---|---|---|
| `redirect` | `{ kind, url, gatewayPaymentId, merchantReference }`. `gatewayPaymentId` is `string \| null`: it is `null` when the gateway assigns an ID only after payment (Kashier's hosted page). | Paymob, Kashier, PayTabs, Tap | Redirect the browser to `url` |
| `form_post` | `{ kind, action, fields, merchantReference }` | Amazon Payment Services | Render an auto-submitting form that POSTs `fields` to `action`. There is no gateway ID until feedback arrives. |
| `embedded` | `{ kind, sessionId, scriptUrl, expiresAt }` | Geidea (a redirect alternative is Uncertain); optionally Paymob Pixel | Load `scriptUrl` and start the gateway's checkout with `sessionId` |
| `reference` | `{ kind, referenceNumber, expiresAt, gatewayPaymentId }` | Fawry PayAtFawry; possibly Tap's `src_eg.fawry` (Uncertain) | Show the code; the customer pays later at an outlet |

```typescript
const result = await bawaba.createPayment("payfort", {
  money: { minor: 150_000, currency: "AED" },
  merchantReference: "order_8731",
  customer: { email: "mona@example.com", phone: "+971500000000" },
  returnUrl: "https://example.com/checkout/return",
  webhookUrl: "https://example.com/webhooks/payfort",
  idempotencyKey: "checkout:order_8731",
});

switch (result.kind) {
  case "redirect":  return redirectTo(result.url);
  case "form_post": return renderAutoSubmitForm(result.action, result.fields);
  case "embedded":  return renderCheckoutScript(result.scriptUrl, result.sessionId);
  case "reference": return showReferenceCode(result.referenceNumber, result.expiresAt);
}
```

### 3.4 Payment status

| Status | Meaning |
|---|---|
| `pending` | Created; the customer hasn't finished |
| `requires_action` | Waiting on the customer, for example a 3DS challenge |
| `awaiting_payment` | Waiting for an offline payment, such as an unpaid Fawry reference code |
| `authorized` | Funds held, not captured |
| `succeeded` | Paid or captured |
| `failed` | Declined or errored |
| `canceled` | Voided, or an unpaid order was cancelled |
| `expired` | The session or reference code expired unpaid |
| `refunded` | Fully refunded |
| `partially_refunded` | Partly refunded |

Each gateway's mapping to these statuses is exported as a table, with a `verified` flag per row (for example `import { statusTable } from "bawaba/fawry"`). Gateway nuances such as Paymob's boolean flags or Kashier's `ORDER_PAID_BEFORE` are kept in `raw`.

### 3.5 Normalized event

```typescript
type BawabaEvent = {
  id: string;               // dedupe key: "{gateway}:{transaction or order id}:{status}"
  gateway: GatewayName;
  type:
    | "payment.succeeded" | "payment.authorized" | "payment.failed" | "payment.pending"
    | "payment.expired" | "payment.canceled"
    | "refund.succeeded" | "refund.failed" | "card.saved";
  status: PaymentStatus;
  money: Money;
  gatewayPaymentId: string;
  merchantReference: string | undefined;
  signed: Readonly<Record<string, unknown>>; // authenticated fields only
  raw: unknown;                              // the full payload, untrusted
  receivedAt: Date;
};
```

`payment.authorized` covers authorization callbacks (Kashier `authorize`, Tap authorizations). It was added to the event list in this specification (Proposal).

### 3.6 Webhooks

```typescript
// One route per gateway. Pass the exact bytes received.
const event = await bawaba.webhooks.verify("tap", {
  rawBody,  // string | Uint8Array: never re-serialized JSON
  headers,  // Kashier: x-kashier-signature; PayTabs: signature; Tap: hashstring
  query,    // Paymob sends its hmac in the query string
});

if (await alreadyHandled(event.id)) return bawaba.webhooks.alreadyProcessed("tap");
if (event.type === "payment.succeeded") await markPaid(event.merchantReference, event.money);

// Debugging a failing signature: never throws, never reveals the secret.
const report = await bawaba.webhooks.inspect("tap", { rawBody, headers, query });
// { valid, signedString, expected, received, algorithm, reason }
```

- **`verify` throws `SignatureVerificationError`** when the signature is missing or wrong, and also for an unknown or missing event type (fail closed). It parses the body only after verifying it.
- **Status re-query:** with `confirmWithStatusQuery: true`, `verify` also reads the payment from the gateway's status API and builds `signed` from that response. It is on by default for Fawry and Tap, where few fields are signed, and for Amazon Payment Services, whose feedback signing is still Uncertain. It can be set per gateway.
- **Replay protection is the application's job.** No gateway signs a delivery timestamp. Store `event.id` under a unique constraint and update order state with compare-and-set.

The per-gateway details are in section 6.

### 3.7 Redirects (thank-you page)

`redirects.verify(gateway, { query | body })` returns `{ authenticated, status, merchantReference, gatewayPaymentId, raw }`. It is for display only. **Order state must come from the webhook or a status query**, never from the redirect.

### 3.8 Errors and reconciliation

```typescript
try {
  await bawaba.refund("fawry", {
    gatewayPaymentId,
    money: { minor: 5_000, currency: "EGP" },
    idempotencyKey: "refund:order_8731:1",
  });
} catch (err) {
  if (err instanceof OutcomeUnknownError) {
    // Timeout, network error or 5xx: the refund may or may not have happened.
    // Do NOT retry blindly. The idempotency key stays claimed until you reconcile.
    const payment = await bawaba.reconcile("fawry", { gatewayPaymentId });
  } else if (err instanceof ApiError) {   // or switch on err.code after serialization
    log.warn({ gateway: err.gateway, status: err.status, requestId: err.requestId });
  }
}
```

## 4. Errors

Every error extends `BawabaError` and carries a stable string `code`, because `instanceof` doesn't survive queues and logs. The names and codes below are implemented in `@bawabajs/core` (Day 2, 18 November 2026). The one exception: when the caller aborts a **read** through its own `AbortSignal`, the SDK rethrows the caller's abort reason unchanged.

| Class | `code` | When | Safe to retry |
|---|---|---|---|
| `BadRequestError` (`ApiError`, 400) | `bad_request` | The gateway rejected the parameters | No; fix the request |
| `AuthenticationError` (401) | `authentication_failed` | Wrong or expired credentials | No |
| `PermissionError` (403) | `permission_denied` | The account isn't enabled for this operation | No |
| `NotFoundError` (404) | `not_found` | Unknown payment or path | No |
| `RateLimitError` (429) | `rate_limited` | Too many requests | Reads are retried automatically; mutations are not |
| `GatewayServerError` (5xx on a **read**) | `gateway_unavailable` | The gateway failed on a read | Reads are retried automatically (up to twice) |
| `ConnectionError` (on a **read**) | `connection_failed` | Network failure on a read | Reads are retried automatically |
| `OutcomeUnknownError` | `outcome_unknown` | A timeout, network error or 5xx on a **mutation** | **Never.** Reconcile first. |
| `SignatureVerificationError` | `signature_invalid` | A webhook or redirect failed verification | No |
| `CapabilityError` | `capability_unsupported`, `capability_beta` | The operation is unsupported, or beta without `allowBeta` | No |
| `IdempotencyError` | `idempotency_key_reused`, `idempotency_outcome_unknown` | The key was reused with other parameters, or is held after an unknown outcome | No |
| `ConfigError` | `config_invalid` | Missing or invalid configuration, or secret keys in a browser | No |
| `InvalidArgumentError` | `invalid_argument` | An invalid value passed to the SDK (money, amount text, path parameter, header), rejected **before anything is sent** | No; fix the input |

- **Fields:** every `ApiError` carries `gateway`, `status`, `headers`, `requestId` (when the gateway sends one) and the raw response body.
- **No `retryable` property** on any error. What is safe to retry is the table above, not a flag.
- **Serialization:** `JSON.stringify(error)` gives `name`, `code` and `gateway`, plus `status` for an `ApiError`, and `operation` and `merchantReference` for an `OutcomeUnknownError`. Headers, the raw body, the cause and the message are never serialized.
- **Failures inside a 200:** some gateways report failures in a 200 response (Amazon Payment Services `response_code`, Geidea `responseCode`). Clients map these to the right error class.
- **Declines:** a **declined payment is a result, not an error.**
- **Redaction:** errors never contain secrets (FR-C9).

## 5. Gateway-native clients

### 5.1 Common surface

Every client has:
- **Gateway resources** using the gateway's own field names (5.2);
- **`request()`**, an escape hatch for endpoints the SDK doesn't wrap yet, which still goes through the safe pipeline;
- **`capabilities`** (2.2);
- **`webhooks.*` verifiers**, plus `webhooks.inspect()`. The verifiers are also exported from `@bawabajs/<gateway>/webhooks`, so they work without a client instance;
- **the same options:** `fetch`, `timeoutMs`, `headers`, `onRequest` and `onResponse` hooks (body-free), `idempotencyStore`, `allowBeta`, and a host override.

### 5.2 First-release resources

Only operations backed by the gateway's documentation are listed. Anything unconfirmed ships as `beta`.

| Client | Resources |
|---|---|
| `@bawabajs/paymob` | `intentions.create/update`; `checkout.url()`; `transactions.retrieve/retrieveByOrderId/retrieveByMerchantOrderId/refund/void/capture`; `webhooks.constructEvent/constructRedirect/constructSubscriptionEvent`. Regions EG, SA, AE and OM, with overrides. Both auth modes, with a single-flight token cache. |
| `@bawabajs/kashier` | `checkout.hostedPageUrl()` (signed hosted page) and/or `sessions.create/retrieve` (the primary path is decided during validation); `transactions.list/retrieve`; `orders.refund/void/capture` (after the paths are confirmed); `webhooks.constructEvent`; `redirects.verify`. Test and live host selection. |
| `@bawabajs/fawry` | `charges.create` (card, wallet, PayAtFawry reference); `payments.status`; `refunds.create`; `orders.cancelUnpaid`; `webhooks.constructNotification` (V2 only; V1 MD5 notifications are rejected with a clear message). Staging and production selection. |
| `@bawabajs/geidea` | `sessions.create` (`Pay`, `PreAuthorize`, `AuthorizeCapture`); `checkout.scriptUrl()` per region; `orders.retrieve`; `orders.refund/capture/void`; `webhooks.constructCallback`. Regions EG, SA and AE. |
| `@bawabajs/paytabs` | `payments.request` (`sale` or `auth`; returns `redirect_url`); `transactions.query` (by `tran_ref` or `cart_id`); `transactions.refund/capture/void`; `webhooks.constructIpn` (raw-body HMAC); `redirects.verify` (the return POST). Region selection, with an explicit host override until the official host list is confirmed. |
| `@bawabajs/payfort` | `checkout.formFields()` (signed `paymentPage` form for `PURCHASE` and `AUTHORIZATION`); `payments.checkStatus`; `payments.capture/voidAuthorization/refund`; `webhooks.constructFeedback` (direct and notification feedback). Configurable SHA type; sandbox and production selection. |
| `@bawabajs/tap` | `charges.create/retrieve`; `authorizations.create`; `authorizations.capture` (a charge from the `auth_…` source); `refunds.create`; `webhooks.constructEvent` (`hashstring`); `reference.idempotent` passthrough; helpers for local-method sources (KNET, mada, Benefit, OmanNet, NAPS, Fawry). |

### 5.3 Configuration

| Gateway | Credentials | Other options |
|---|---|---|
| Paymob | `secretKey`, `apiKey`, `publicKey`, `hmacSecret` | `region: "EG" \| "SA" \| "AE" \| "OM"`; `integrationIds` |
| Kashier | `merchantId`, `secretKey`, `apiKey`, `paymentApiKey` (the key that signs webhooks and the hosted-page URL; whether it is the same as `apiKey` is Uncertain) | `mode: "test" \| "live"` |
| Fawry | `merchantCode`, `secureKey` | `mode: "staging" \| "production"` |
| Geidea | `publicKey`, `apiPassword` | `region: "EG" \| "SA" \| "AE"` |
| PayTabs | `serverKey`, `profileId` | `region` (the key is bound to one region); `host` override |
| Amazon Payment Services | `merchantIdentifier`, `accessCode`, `requestPhrase`, `responsePhrase` | `shaType` (the docs conflict on the allowed values); `mode: "sandbox" \| "production"` |
| Tap | `secretKey` (`sk_test_…` or `sk_live_…`) | none |

### 5.4 Examples

```typescript
import { Paymob } from "@bawabajs/paymob";
import { PayTabs } from "@bawabajs/paytabs";

const paymob = new Paymob({ secretKey, apiKey, hmacSecret, region: "EG" });
const intention = await paymob.intentions.create({
  amount: 150000, currency: "EGP", payment_methods: [158],
  billing_data: { first_name: "Mona", last_name: "Adel", email: "mona@example.com", phone_number: "+201000000000" },
  special_reference: "order_8731",
});

const paytabs = new PayTabs({ serverKey, profileId: 987654, region: "SA" });
const page = await paytabs.payments.request({
  tran_type: "sale", tran_class: "ecom",
  cart_id: "order_8731", cart_description: "Order 8731",
  cart_currency: "SAR", cart_amount: 1500.0,
  callback: "https://example.com/webhooks/paytabs", return: "https://example.com/checkout/return",
});
```

## 6. Webhooks by gateway

| Gateway | Signature location | Algorithm | Acknowledgement | Dedupe key (`event.id`) |
|---|---|---|---|---|
| Paymob | `hmac` query parameter (body for subscriptions) | HMAC-SHA512, hex, over fixed fields | 200 | `paymob:{transaction id}:{state flags}` (`paymob_request_id` for subscriptions) |
| Kashier | `x-kashier-signature` header | HMAC-SHA256, hex, over `signatureKeys` | 200; **409 means already processed** | `kashier:{transactionId}:{status}` |
| Fawry | `messageSignature` in the body | SHA-256 with the key appended (Secondary) | 200 (Uncertain) | `fawry:{fawryRefNumber}:{orderStatus}` (to confirm) |
| Geidea | `signature` in the callback (Uncertain) | HMAC-SHA256, **base64**, over fixed fields | Uncertain | `geidea:{orderId}:{status}` |
| PayTabs | `Signature` header | HMAC-SHA256, hex, over the **raw body** | 200 | `paytabs:{tran_ref}:{response_status}` |
| Amazon Payment Services | `signature` in the feedback | Configured SHA, wrapped with the response phrase (Uncertain for feedback) | **2xx required** | `payfort:{fort_id}:{command}:{status}` |
| Tap | `hashstring` header | HMAC-SHA256, hex, over labelled fields | 200 | `tap:{id}:{status}` |

`webhooks.alreadyProcessed(gateway)` returns the correct response for a duplicate. The exact signed strings are in each gateway's spec file under [gateways/](gateways/).

## 7. What the SDK guarantees, and what the application must do

| Concern | Bawaba guarantees | The application must |
|---|---|---|
| Secrets | Never logs or exposes them, including Amazon Payment Services phrases and Geidea API passwords; refuses to run in a browser with secret keys | Keep all keys server-side in a secret manager; rotate them (Amazon Payment Services recommends every 90 days) |
| Signature verification | The correct recipe for each gateway and callback type; constant-time compare; fail closed; verification before anything else | Send **every** callback URL (including redirects, return POSTs and subscription hooks) through the verifier, with the raw body |
| Untrusted fields | Separates `signed` from `raw`; optional status re-query | Act only on `signed` fields, or re-query the gateway if re-query is off |
| Duplicates and replays | Dedupe keys; `alreadyProcessed()` | A unique constraint on `event.id`; compare-and-set order state |
| Money-moving calls | Never retries them; `OutcomeUnknownError` on a timeout, network error or 5xx; the idempotency claim survives an unknown outcome | Use a unique merchant reference per order; use a shared idempotency store when running more than one instance; keep a refund ledger; reconcile before retrying |
| Redirect vs webhook race | Documents it | One idempotent state transition for both paths |
| PCI scope | No method accepts card numbers or CVV; card-on-file uses gateway tokens only | Use hosted pages or gateway JavaScript for card entry; handle its own PCI DSS self-assessment (SAQ) |
| Customer data | Stores nothing | Consent and retention under local data-protection law |

## 8. `@bawabajs/testing`

- **Fixtures:** scrubbed callbacks and responses for each gateway. Each says whether it came from a real sandbox (`source: "sandbox"`) or was written from the docs (`source: "synthetic"`).
- **Test signers** for each gateway, to build valid signed callbacks in the application's own tests. They are written independently of the clients, so a misreading of the docs in one doesn't hide in the other.
- **No secrets needed:** everything works with test secrets.
