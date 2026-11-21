import {
  hmacSha256,
  InvalidArgumentError,
  normalizeWebhookRequest,
  parseFormBody,
  parseJsonObject,
  pickSigned,
  requireEventType,
  SignatureVerificationError,
  safeEqualHex,
  utf8Encode,
  verifyWebhook,
  type WebhookRequest,
} from "@bawabajs/core";
import { describe, expect, it, vi } from "vitest";

const BODY = '{"type":"payment","amount":"250.00","id":"t_1"}';

describe("normalizeWebhookRequest: the raw body", () => {
  it("keeps a string body and gives its UTF-8 bytes", () => {
    const request = normalizeWebhookRequest({ rawBody: BODY });
    expect(request.rawBody).toBe(BODY);
    expect(request.body).toBe(BODY);
    expect(request.bytes).toEqual(utf8Encode(BODY));
  });

  it("keeps a byte body as is and decodes it as UTF-8", () => {
    const bytes = utf8Encode('{"name":"بوابة"}');
    const request = normalizeWebhookRequest({ rawBody: bytes });
    expect(request.rawBody).toBe(bytes);
    expect(request.bytes).toEqual(bytes);
    expect(request.body).toBe('{"name":"بوابة"}');
  });

  it.each([
    ["a parsed object", { type: "payment" }],
    ["a number", 250],
    ["null", null],
    ["missing", undefined],
  ])("refuses %s instead of the raw body", (_label, rawBody) => {
    expect(() => normalizeWebhookRequest({ rawBody })).toThrow(InvalidArgumentError);
  });

  it.each([null, "body", 1])("refuses %j instead of a request object", (input) => {
    expect(() => normalizeWebhookRequest(input)).toThrow(InvalidArgumentError);
  });
});

describe("normalizeWebhookRequest: headers", () => {
  it("lowercases names from a record, joins repeated values and skips undefined ones", () => {
    const request = normalizeWebhookRequest({ rawBody: "", headers: { "X-Kashier-Signature": "abc", "X-Multi": ["a", "b"], "X-Missing": undefined } });
    expect(request.headers).toEqual({ "x-kashier-signature": "abc", "x-multi": "a, b" });
  });

  it("accepts a Headers object", () => {
    expect(normalizeWebhookRequest({ rawBody: "", headers: new Headers({ HashString: "h" }) }).headers).toEqual({ hashstring: "h" });
  });

  it("joins two spellings of one name, so an ambiguous signature header never verifies", () => {
    expect(normalizeWebhookRequest({ rawBody: "", headers: { Signature: "a", signature: "b" } }).headers).toEqual({ signature: "a, b" });
  });

  it("gives empty records when headers and query are absent", () => {
    const request = normalizeWebhookRequest({ rawBody: "" });
    expect(request.headers).toEqual({});
    expect(request.query).toEqual({});
  });

  it("refuses an invalid header name", () => {
    expect(() => normalizeWebhookRequest({ rawBody: "", headers: { "bad name": "x" } })).toThrow(InvalidArgumentError);
  });

  it("returns frozen records with no prototype", () => {
    const { headers, query } = normalizeWebhookRequest({ rawBody: "", query: "__proto__=x" });
    expect(Object.isFrozen(headers)).toBe(true);
    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(query, "__proto__")?.value).toBe("x");
  });
});

describe("normalizeWebhookRequest: query", () => {
  it("keeps the first value of each parameter from a string, with or without '?'", () => {
    expect(normalizeWebhookRequest({ rawBody: "", query: "?hmac=a&hmac=b&id=1" }).query).toEqual({ hmac: "a", id: "1" });
    expect(normalizeWebhookRequest({ rawBody: "", query: "hmac=a%20b+c" }).query).toEqual({ hmac: "a b c" });
  });

  it("accepts URLSearchParams", () => {
    expect(
      normalizeWebhookRequest({
        rawBody: "",
        query: new URLSearchParams([
          ["a", "1"],
          ["a", "2"],
        ]),
      }).query,
    ).toEqual({ a: "1" });
  });

  it("accepts a record, keeping first values and skipping anything that is not a string", () => {
    const query = { a: ["1", "2"], b: "x", c: undefined, d: { nested: "y" }, e: [] };
    expect(normalizeWebhookRequest({ rawBody: "", query: query as unknown as Record<string, string> }).query).toEqual({ a: "1", b: "x" });
  });
});

const SECRET = "whsec_test_do_not_use";

async function signed(body: string): Promise<{ rawBody: string; headers: Record<string, string> }> {
  return { rawBody: body, headers: { "x-signature": await hmacSha256(SECRET, body) } };
}

const verification = {
  gateway: "example",
  verify: async (request: WebhookRequest) => safeEqualHex(await hmacSha256(SECRET, request.bytes), request.headers["x-signature"]),
  parse: (request: WebhookRequest) => parseJsonObject(request.body),
};

describe("verifyWebhook", () => {
  it("verifies, then parses", async () => {
    expect(await verifyWebhook(await signed(BODY), verification)).toEqual({ type: "payment", amount: "250.00", id: "t_1" });
  });

  it("verifies the same bytes passed as a Uint8Array", async () => {
    const request = await signed(BODY);
    expect(await verifyWebhook({ ...request, rawBody: utf8Encode(BODY) }, verification)).toMatchObject({ amount: "250.00" });
  });

  it("refuses a wrong signature without parsing", async () => {
    const parse = vi.fn();
    const request = { ...(await signed(BODY)), rawBody: BODY.replace("250.00", "1.00") };

    await expect(verifyWebhook(request, { ...verification, parse })).rejects.toMatchObject({ code: "signature_invalid", gateway: "example" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses a missing signature", async () => {
    await expect(verifyWebhook({ rawBody: BODY }, verification)).rejects.toBeInstanceOf(SignatureVerificationError);
  });

  it("treats anything but true from the verifier as a failure", async () => {
    const truthy = { ...verification, verify: () => 1 as unknown as boolean };
    await expect(verifyWebhook({ rawBody: BODY }, truthy)).rejects.toBeInstanceOf(SignatureVerificationError);
  });

  it("turns a throwing verifier into a SignatureVerificationError with the cause", async () => {
    const cause = new TypeError("bug");
    const error = await verifyWebhook({ rawBody: BODY }, { ...verification, verify: () => Promise.reject(cause) }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(SignatureVerificationError);
    expect((error as Error).cause).toBe(cause);
  });

  it("passes a SignatureVerificationError from the verifier through unchanged", async () => {
    const own = new SignatureVerificationError("own reason", { gateway: "example" });
    await expect(verifyWebhook({ rawBody: BODY }, { ...verification, verify: () => Promise.reject(own) })).rejects.toBe(own);
  });

  it("fails closed when parsing fails after verification", async () => {
    const request = await signed("not json");
    await expect(verifyWebhook(request, verification)).rejects.toBeInstanceOf(SignatureVerificationError);
  });

  it("passes a SignatureVerificationError from the parser through unchanged, such as an unknown event type", async () => {
    const parse = (request: WebhookRequest) => requireEventType(parseJsonObject(request.body).type, ["refund"], "example");
    await expect(verifyWebhook(await signed(BODY), { ...verification, parse })).rejects.toMatchObject({
      message: "The example callback has a missing or unknown event type",
    });
  });

  it("refuses a parsed body before calling the verifier", async () => {
    const verify = vi.fn(() => true);
    await expect(verifyWebhook({ rawBody: JSON.parse(BODY) }, { ...verification, verify })).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("parseJsonObject", () => {
  it("parses a JSON object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it.each(["", "not json", "[1]", "null", '"text"', "1"])("rejects %j", (text) => {
    expect(() => parseJsonObject(text)).toThrow(InvalidArgumentError);
  });
});

describe("parseFormBody", () => {
  it("decodes a form body, keeping first values, in a record with no prototype", () => {
    const form = parseFormBody("amount=250.00&name=Test+Customer&name=second&sig=a%2Bb");
    expect(form).toEqual({ amount: "250.00", name: "Test Customer", sig: "a+b" });
    expect(Object.getPrototypeOf(form)).toBeNull();
  });
});

describe("requireEventType", () => {
  const known = ["pay", "refund"] as const;

  it("returns a known event type", () => {
    expect(requireEventType("refund", known, "kashier")).toBe("refund");
  });

  it.each([undefined, "", "PAY", "authorize", 1, null])("fails closed on %j", (value) => {
    expect(() => requireEventType(value, known, "kashier")).toThrow(SignatureVerificationError);
  });
});

describe("pickSigned", () => {
  it("keeps only the listed fields that are present, frozen", () => {
    const signedFields = pickSigned({ amount: "250.00", id: "t_1", note: "untrusted" }, ["amount", "id", "missing"]);
    expect(signedFields).toEqual({ amount: "250.00", id: "t_1" });
    expect(Object.isFrozen(signedFields)).toBe(true);
  });

  it("ignores inherited properties", () => {
    expect(pickSigned(Object.create({ inherited: 1 }) as Record<string, unknown>, ["inherited", "toString"])).toEqual({});
  });
});
