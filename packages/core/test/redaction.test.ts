import { BadRequestError, InvalidArgumentError, isSensitiveKey, REDACTED, Redactor } from "@bawabajs/core";
import { describe, expect, it } from "vitest";
import { inspect } from "./support/inspect.js";

const SECRET = "sk_test_secret_value_1234";
const PHRASE = "my phrase/with+symbols";

describe("Redactor.redact", () => {
  it("replaces every occurrence of every registered secret", () => {
    const redactor = new Redactor([SECRET, PHRASE]);
    expect(redactor.redact(`a ${SECRET} b ${PHRASE} c ${SECRET}`)).toBe(`a ${REDACTED} b ${REDACTED} c ${REDACTED}`);
  });

  it("replaces the URL-encoded form of a secret", () => {
    const redactor = new Redactor([PHRASE]);
    expect(redactor.redact(`https://example.com/x?key=${encodeURIComponent(PHRASE)}`)).toBe(`https://example.com/x?key=${REDACTED}`);
  });

  it("treats regular-expression characters in a secret literally", () => {
    const redactor = new Redactor(["a.c", "(x|y)"]);
    expect(redactor.redact("abc a.c (x|y) x")).toBe(`abc ${REDACTED} ${REDACTED} x`);
  });

  it("replaces the longer of two overlapping secrets in full", () => {
    const redactor = new Redactor(["abc", "abcdef"]);
    expect(redactor.redact("xabcdefx abcx")).toBe(`x${REDACTED}x ${REDACTED}x`);
  });

  it("never re-matches inside a replacement", () => {
    const redactor = new Redactor(["e", "d"]);
    expect(redactor.redact("ed")).toBe(REDACTED + REDACTED);
  });

  it("ignores undefined and empty secrets, and leaves text alone with none registered", () => {
    const redactor = new Redactor([undefined, ""]);
    expect(redactor.redact("nothing to hide")).toBe("nothing to hide");
  });

  it("accepts secrets added later", () => {
    const redactor = new Redactor();
    expect(redactor.redact(SECRET)).toBe(SECRET);
    expect(redactor.add(SECRET)).toBe(redactor);
    expect(redactor.redact(SECRET)).toBe(REDACTED);
  });

  it("rejects a secret that is not a string", () => {
    expect(() => new Redactor([1234 as unknown as string])).toThrow(InvalidArgumentError);
  });
});

describe("Redactor.redactValue", () => {
  const redactor = new Redactor([SECRET]);

  it("redacts secrets inside nested strings and arrays", () => {
    expect(redactor.redactValue({ note: `key ${SECRET}`, list: [SECRET, 1, true, null] })).toEqual({
      note: `key ${REDACTED}`,
      list: [REDACTED, 1, true, null],
    });
  });

  it("masks the values of sensitive keys, whatever their type", () => {
    const value = {
      billing_data: { first_name: "Mona", city: "Cairo" },
      customer: { email: "mona@example.com", phoneNumber: 201_000_000_000, id: "cus_1" },
      amount: 150_000,
    };
    expect(redactor.redactValue(value)).toEqual({ billing_data: REDACTED, customer: { email: REDACTED, phoneNumber: REDACTED, id: "cus_1" }, amount: 150_000 });
  });

  it("keeps null and undefined values of sensitive keys as they are", () => {
    expect(redactor.redactValue({ email: null, phone: undefined })).toEqual({ email: null, phone: undefined });
  });

  it("returns primitives unchanged", () => {
    expect(redactor.redactValue(42)).toBe(42);
    expect(redactor.redactValue(undefined)).toBeUndefined();
  });

  it("marks cycles, but not values that are merely shared", () => {
    const shared = { id: "x" };
    const cyclic: Record<string, unknown> = { shared, again: shared };
    cyclic.self = cyclic;
    expect(redactor.redactValue(cyclic)).toEqual({ shared: { id: "x" }, again: { id: "x" }, self: "[circular]" });
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "secretKey",
    "hmac_secret",
    "apiPassword",
    "api_key",
    "x-api-key",
    "requestPhrase",
    "auth_token",
    "Authorization",
    "set-cookie",
    "client_secret",
    "private_key",
    "email",
    "customer_email",
    "phone_number",
    "customerMobile",
    "first_name",
    "lastName",
    "full_name",
    "card_holder_name",
    "card_number",
    "pan",
    "cvv",
    "CVC",
    "billing_data",
    "shipping",
    "address",
    "street",
    "building",
    "floor",
    "apartment",
    "postal_code",
    "zip",
    "iban",
    "national_id",
    "expiry_date",
    "exp_month",
    "name",
  ])("%s is sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["amount", "currency", "id", "order_id", "merchant_order_id", "status", "success", "created_at", "masked_pan", "country", "company"])(
    "%s is not sensitive",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("a Redactor never reveals its secrets", () => {
  const redactor = new Redactor([SECRET]);

  it("in JSON, String and inspect output", () => {
    for (const output of [JSON.stringify(redactor), String(redactor), inspect(redactor), inspect({ config: { redactor } })]) {
      expect(output).not.toContain(SECRET);
    }
  });
});

describe("ApiError keeps headers and the raw body out of logs", () => {
  const error = new BadRequestError("paymob returned HTTP 400", { gateway: "paymob", status: 400, headers: { "set-cookie": SECRET }, raw: { echoed: SECRET } });

  it("still exposes them as properties", () => {
    expect(error.headers).toEqual({ "set-cookie": SECRET });
    expect(error.raw).toEqual({ echoed: SECRET });
  });

  it("leaves them out of enumeration and inspect output", () => {
    expect(Object.keys(error)).not.toContain("headers");
    expect(Object.keys(error)).not.toContain("raw");
    expect(inspect(error)).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });
});
