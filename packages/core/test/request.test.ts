import { BadRequestError, ConfigError, GatewayServerError, InvalidArgumentError, NotFoundError, RateLimitError } from "@bawabajs/core";
import { http, HttpResponse as MswResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AttemptResult, prepareRequest, sendOnce } from "../src/http/request.js";
import type { FetchLike, HttpClientConfig, RequestEvent, RequestSpec, ResponseEvent } from "../src/http/types.js";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

function waitForAbort(call: Call): Promise<Response> {
  return new Promise((_resolve, reject) => {
    call.init.signal?.addEventListener("abort", () => reject(call.init.signal?.reason));
  });
}

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

const base: HttpClientConfig = { gateway: "paymob", baseUrl: "https://api.example.test" };
const read: RequestSpec = { method: "GET", path: "/v1/orders", kind: "read", operation: "orders.list" };

async function attempt(config: HttpClientConfig, spec: RequestSpec = read): Promise<AttemptResult> {
  return sendOnce(config, spec, prepareRequest(config, spec), 1);
}

describe("prepareRequest: URLs", () => {
  it("joins the base URL and path, ignoring trailing slashes on the base", () => {
    expect(prepareRequest({ ...base, baseUrl: "https://api.example.test//" }, read).url).toBe("https://api.example.test/v1/orders");
  });

  it("keeps a base path", () => {
    expect(prepareRequest({ ...base, baseUrl: "https://api.example.test/api/" }, read).url).toBe("https://api.example.test/api/v1/orders");
  });

  it("adds query parameters, skipping undefined ones", () => {
    const prepared = prepareRequest(base, { ...read, query: { page: 2, live: false, ref: "a b&c", skipped: undefined } });
    expect(prepared.url).toBe("https://api.example.test/v1/orders?page=2&live=false&ref=a+b%26c");
    expect(prepared.hookUrl).toBe("https://api.example.test/v1/orders");
  });

  it("URI-encodes path parameters, so they cannot inject path segments or a query", () => {
    const prepared = prepareRequest(base, { ...read, path: "/v1/orders/{id}/items/{n}", pathParams: { id: "../admin?x=1#y", n: 7 } });
    expect(prepared.url).toBe("https://api.example.test/v1/orders/..%2Fadmin%3Fx%3D1%23y/items/7");
  });

  it.each(["", ".", ".."])("rejects the path parameter value %j", (value) => {
    expect(() => prepareRequest(base, { ...read, path: "/v1/orders/{id}", pathParams: { id: value } })).toThrow(InvalidArgumentError);
  });

  it("rejects a missing path parameter", () => {
    expect(() => prepareRequest(base, { ...read, path: "/v1/orders/{id}" })).toThrow(InvalidArgumentError);
  });

  it("does not take a path parameter from the object prototype", () => {
    expect(() => prepareRequest(base, { ...read, path: "/v1/{constructor}", pathParams: {} })).toThrow(InvalidArgumentError);
  });

  it("rejects an unused path parameter", () => {
    expect(() => prepareRequest(base, { ...read, pathParams: { id: "1" } })).toThrow(InvalidArgumentError);
  });

  it.each(["v1/orders", "/v1/orders?x=1", "/v1/orders#top"])("rejects the path %j", (path) => {
    expect(() => prepareRequest(base, { ...read, path })).toThrow(InvalidArgumentError);
  });

  it.each(["not a url", "ftp://api.example.test", ""])("rejects the base URL %j as a configuration error", (baseUrl) => {
    expect(() => prepareRequest({ ...base, baseUrl }, read)).toThrow(ConfigError);
  });
});

describe("prepareRequest: bodies and headers", () => {
  it("sends JSON with its content type", () => {
    const prepared = prepareRequest(base, { ...read, method: "POST", json: { amount: 100, items: ["a"] } });
    expect(prepared.body).toBe('{"amount":100,"items":["a"]}');
    expect(prepared.headers.get("content-type")).toBe("application/json");
  });

  it("sends a form body with its content type, skipping undefined fields", () => {
    const prepared = prepareRequest(base, { ...read, method: "POST", form: { a: 1, b: "x y", c: true, d: undefined } });
    expect(prepared.body).toBe("a=1&b=x+y&c=true");
    expect(prepared.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("sends no body by default", () => {
    expect(prepareRequest(base, read).body).toBeUndefined();
  });

  it("rejects both a JSON and a form body", () => {
    expect(() => prepareRequest(base, { ...read, json: {}, form: {} })).toThrow(InvalidArgumentError);
  });

  it("merges headers: client defaults, then the content type, then per-request headers", () => {
    const prepared = prepareRequest(
      { ...base, headers: { authorization: "Token a", "x-client": "bawaba" } },
      { ...read, json: {}, headers: { authorization: "Token b", "content-type": "application/vnd.test+json" } },
    );
    expect(prepared.headers.get("authorization")).toBe("Token b");
    expect(prepared.headers.get("x-client")).toBe("bawaba");
    expect(prepared.headers.get("content-type")).toBe("application/vnd.test+json");
  });

  it("rejects an invalid header before anything is sent", () => {
    expect(() => prepareRequest(base, { ...read, headers: { "x-bad": "a\nb" } })).toThrow(InvalidArgumentError);
  });
});

describe("sendOnce: responses", () => {
  it("returns a parsed JSON response with headers and the request ID", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: 1 }, { status: 201, headers: { "x-request-id": "req_9" } }));
    const result = await attempt({ ...base, fetch }, { ...read, method: "POST", json: { a: 1 } });

    expect(result).toEqual({
      type: "response",
      response: { status: 201, headers: { "content-type": "application/json", "x-request-id": "req_9" }, requestId: "req_9", data: { id: 1 } },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns text that is not JSON as a string, and an empty body as undefined", async () => {
    const text = await attempt({ ...base, fetch: fakeFetch(() => new Response("OK")).fetch });
    const empty = await attempt({ ...base, fetch: fakeFetch(() => new Response(null, { status: 204 })).fetch });

    expect(text.type === "response" && text.response.data).toBe("OK");
    expect(empty.type === "response" && empty.response.data).toBeUndefined();
  });

  it("finds the request ID under a configured header name", async () => {
    const { fetch } = fakeFetch(() => json({}, { headers: { "x-trace": "t_1", "request-id": "ignored" } }));
    const result = await attempt({ ...base, fetch, requestIdHeaders: ["X-Trace"] });

    expect(result.type === "response" && result.response.requestId).toBe("t_1");
  });

  it("has no request ID when no known header is present", async () => {
    const result = await attempt({ ...base, fetch: fakeFetch(() => json({})).fetch });

    expect(result.type === "response" && result.response.requestId).toBeUndefined();
  });

  it.each([
    [400, BadRequestError],
    [404, NotFoundError],
    [429, RateLimitError],
    [503, GatewayServerError],
  ])("maps HTTP %i to an error that keeps the raw body, without putting the body in the message", async (status, type) => {
    const { fetch } = fakeFetch(() => json({ detail: "card 4111" }, { status, headers: { "request-id": "req_2" } }));
    const result = await attempt({ ...base, fetch });

    expect(result.type).toBe("http_error");
    if (result.type !== "http_error") return;
    expect(result.error).toBeInstanceOf(type);
    expect(result.error.status).toBe(status);
    expect(result.error.gateway).toBe("paymob");
    expect(result.error.requestId).toBe("req_2");
    expect(result.error.raw).toEqual({ detail: "card 4111" });
    expect(result.error.message).toBe(`paymob returned HTTP ${status}`);
  });
});

describe("sendOnce: transport failures", () => {
  it("reports a rejected fetch as a network failure", async () => {
    const cause = new TypeError("fetch failed");
    const result = await attempt({ ...base, fetch: fakeFetch(() => Promise.reject(cause)).fetch });

    expect(result).toEqual({ type: "transport_error", failure: "network", cause });
  });

  it("reports a body that fails mid-read as a network failure", async () => {
    const broken = { ok: true, status: 200, headers: new Headers(), text: () => Promise.reject(new TypeError("terminated")) } as unknown as Response;
    const result = await attempt({ ...base, fetch: fakeFetch(() => broken).fetch });

    expect(result.type === "transport_error" && result.failure).toBe("network");
  });

  it("fires the per-attempt timeout", async () => {
    const result = await attempt({ ...base, timeoutMs: 20, fetch: fakeFetch(waitForAbort).fetch });

    expect(result.type === "transport_error" && result.failure).toBe("timeout");
  });

  it("respects the caller's abort", async () => {
    const controller = new AbortController();
    const pending = attempt({ ...base, fetch: fakeFetch(waitForAbort).fetch }, { ...read, signal: controller.signal });
    controller.abort(new Error("caller gave up"));
    const result = await pending;

    expect(result.type === "transport_error" && result.failure).toBe("aborted");
  });
});

describe("sendOnce: hooks", () => {
  it("passes method, URL without the query, status and timing, but never bodies or headers", async () => {
    const requests: RequestEvent[] = [];
    const responses: ResponseEvent[] = [];
    const config: HttpClientConfig = {
      ...base,
      fetch: fakeFetch(() => json({ secret: "s" }, { status: 200 })).fetch,
      headers: { authorization: "Token secret" },
      onRequest: (event) => requests.push(event),
      onResponse: (event) => responses.push(event),
    };
    await attempt(config, { ...read, method: "POST", query: { token: "q" }, json: { card: "4111" } });

    expect(requests).toEqual([
      { gateway: "paymob", operation: "orders.list", kind: "read", method: "POST", url: "https://api.example.test/v1/orders", attempt: 1 },
    ]);
    expect(responses).toHaveLength(1);
    expect(Object.keys(responses[0] ?? {}).sort()).toEqual(["attempt", "durationMs", "failure", "gateway", "kind", "method", "operation", "status", "url"]);
    expect(responses[0]?.status).toBe(200);
    expect(responses[0]?.failure).toBeUndefined();
    expect(responses[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the failure kind to onResponse", async () => {
    const responses: ResponseEvent[] = [];
    await attempt({ ...base, fetch: fakeFetch(() => Promise.reject(new TypeError("x"))).fetch, onResponse: (event) => responses.push(event) });

    expect(responses[0]?.status).toBeUndefined();
    expect(responses[0]?.failure).toBe("network");
  });

  it("ignores a hook that throws, so it cannot change the outcome of a payment call", async () => {
    const throwing = () => {
      throw new Error("hook bug");
    };
    const result = await attempt({ ...base, fetch: fakeFetch(() => json({ ok: true })).fetch, onRequest: throwing, onResponse: throwing });

    expect(result.type).toBe("response");
  });
});

describe("sendOnce with the real fetch (MSW)", () => {
  const server = setupServer(
    http.post("https://api.example.test/v1/orders/:id", async ({ request, params }) =>
      MswResponse.json({ id: params.id, received: await request.json(), auth: request.headers.get("authorization") }, { headers: { "x-request-id": "msw_1" } }),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterAll(() => server.close());

  it("sends through the global fetch when none is injected", async () => {
    const result = await attempt(
      { ...base, headers: { authorization: "Token t" } },
      { ...read, method: "POST", path: "/v1/orders/{id}", pathParams: { id: "o 1" }, json: { amount: 5 } },
    );

    expect(result).toEqual({
      type: "response",
      response: expect.objectContaining({ status: 200, requestId: "msw_1", data: { id: "o 1", received: { amount: 5 }, auth: "Token t" } }),
    });
  });
});
