import { InvalidArgumentError, request } from "@bawabajs/core";
import { FIXTURE_GATEWAYS, fakeFetch, fixtureRequest, jsonResponse, parseFixture, VERSION, webhookRequest } from "@bawabajs/testing";
import { describe, expect, it } from "vitest";

it("exports VERSION", () => {
  expect(VERSION).toBe("0.0.0");
});

describe("fakeFetch", () => {
  it("answers each call with the next scripted response and records it", async () => {
    const { fetch, calls } = fakeFetch(jsonResponse({ id: "pay_1" }, { status: 201 }), (call) => new Response(`second ${call.method}`));

    const first = await request(
      { gateway: "example", baseUrl: "https://api.example.test", fetch, headers: { authorization: "Bearer test" } },
      { method: "POST", path: "/payments", kind: "mutation", operation: "payments.create", json: { amount: 100 } },
    );
    const second = await fetch("https://api.example.test/payments/pay_1", { method: "GET" });

    expect(first.status).toBe(201);
    expect(first.data).toEqual({ id: "pay_1" });
    expect(await second.text()).toBe("second GET");
    expect(calls).toEqual([
      {
        url: "https://api.example.test/payments",
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: '{"amount":100}',
      },
      { url: "https://api.example.test/payments/pay_1", method: "GET", headers: {}, body: undefined },
    ]);
  });

  it("rejects with a scripted error, as a network failure would", async () => {
    const failure = new TypeError("fetch failed");
    const { fetch } = fakeFetch(failure);
    await expect(fetch("https://api.example.test", {})).rejects.toBe(failure);
  });

  it("rejects a call that was not scripted, so a retry cannot go unnoticed", async () => {
    const { fetch, calls } = fakeFetch(new Response("only one"));
    await fetch("https://api.example.test/a", {});
    await expect(fetch("https://api.example.test/b", {})).rejects.toThrow("fakeFetch: unexpected request 2 (GET https://api.example.test/b)");
    expect(calls).toHaveLength(2);
  });

  it("records a non-string body as undefined", async () => {
    const { fetch, calls } = fakeFetch(new Response(""));
    await fetch("https://api.example.test", { method: "POST", body: new Uint8Array(1) });
    expect(calls[0]?.body).toBeUndefined();
  });
});

describe("webhookRequest", () => {
  it("serializes an object body once and keeps a string body as is", () => {
    expect(webhookRequest({ body: { amount: "250.00" }, headers: { signature: "s" } })).toEqual({
      rawBody: '{"amount":"250.00"}',
      headers: { signature: "s" },
      query: {},
    });
    expect(webhookRequest({ body: "a=1", query: { hmac: "h" } })).toEqual({ rawBody: "a=1", headers: {}, query: { hmac: "h" } });
  });
});

const fixture = {
  gateway: "paytabs",
  scenario: "webhook-paid",
  description: "IPN for a paid sale, written from the docs.",
  source: "synthetic",
  recordedAt: "2026-11-20T10:00:00.000Z",
  secret: "test_server_key_do_not_use",
  signedString: '{"tran_ref":"TST0000000000001"}',
  expectedSignature: "abc123",
  request: { rawBody: '{"tran_ref":"TST0000000000001"}', headers: { signature: "abc123" }, query: {} },
};

describe("parseFixture", () => {
  it("accepts a fixture in the fixtures/README.md format", () => {
    expect(parseFixture(fixture)).toEqual(fixture);
    expect(parseFixture(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("accepts a sandbox fixture with an account alias", () => {
    const sandbox = { ...fixture, source: "sandbox", sandboxAccount: "paytabs-ksa-test-1" };
    expect(parseFixture(sandbox).sandboxAccount).toBe("paytabs-ksa-test-1");
  });

  it("gives the request to pass to a verifier", () => {
    expect(fixtureRequest(parseFixture(fixture))).toEqual(fixture.request);
  });

  it("covers the seven gateways", () => {
    expect(FIXTURE_GATEWAYS).toEqual(["paymob", "kashier", "fawry", "geidea", "paytabs", "payfort", "tap"]);
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["an unknown gateway", { ...fixture, gateway: "stripe" }],
    ["a scenario that is not kebab-case", { ...fixture, scenario: "Webhook Paid" }],
    ["an empty description", { ...fixture, description: "" }],
    ["an unknown source", { ...fixture, source: "production" }],
    ["a sandbox fixture without an account alias", { ...fixture, source: "sandbox" }],
    ["an invalid date", { ...fixture, recordedAt: "yesterday" }],
    ["a date without a time", { ...fixture, recordedAt: "2026-11-20" }],
    ["a secret that does not look fake", { ...fixture, secret: "SK9F3K2L1M0N" }],
    ["a signed string that contains the secret", { ...fixture, signedString: `abc${fixture.secret}` }],
    ["an empty signature", { ...fixture, expectedSignature: "" }],
    ["a missing request", { ...fixture, request: undefined }],
    ["a parsed body", { ...fixture, request: { ...fixture.request, rawBody: { tran_ref: "x" } } }],
    ["a header that is not a string", { ...fixture, request: { ...fixture.request, headers: { signature: 1 } } }],
    ["a missing query", { ...fixture, request: { rawBody: "", headers: {} } }],
    ["a non-string alias", { ...fixture, sandboxAccount: 1 }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseFixture(input)).toThrow(InvalidArgumentError);
  });
});
