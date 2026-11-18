import {
  BadRequestError,
  ConnectionError,
  type FetchLike,
  GatewayServerError,
  type HttpClientConfig,
  InvalidArgumentError,
  NotFoundError,
  OutcomeUnknownError,
  RateLimitError,
  type RequestSpec,
  request,
} from "@bawabajs/core";
import { describe, expect, it, vi } from "vitest";

type Step = Response | Error | "hang";

function scriptedFetch(...steps: Step[]): { fetch: FetchLike; calls: () => number } {
  let count = 0;
  const fetch: FetchLike = async (_url, init) => {
    const step = steps[Math.min(count, steps.length - 1)];
    count += 1;
    if (step === "hang") {
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    }
    if (step instanceof Error) {
      throw step;
    }
    return (step as Response).clone();
  };
  return { fetch, calls: () => count };
}

const status = (code: number, headers: Record<string, string> = {}): Response => new Response(JSON.stringify({ code }), { status: code, headers });
const ok = (): Response => new Response(JSON.stringify({ ok: true }), { status: 200 });

const sleeps: number[] = [];
const instantRetry = { sleep: async (ms: number) => void sleeps.push(ms), random: () => 0.5, now: () => Date.parse("2026-11-18T10:00:00Z") };

function client(fetch: FetchLike, extra: Partial<HttpClientConfig> = {}): HttpClientConfig {
  sleeps.length = 0;
  return { gateway: "fawry", baseUrl: "https://api.example.test", fetch, retry: instantRetry, ...extra };
}

const read: RequestSpec = { method: "GET", path: "/status", kind: "read", operation: "payments.status" };
const mutation: RequestSpec = {
  method: "POST",
  path: "/refund",
  kind: "mutation",
  operation: "refunds.create",
  merchantReference: "order_1",
  json: { amount: 1 },
};

describe("reads (TECHNICAL_SPECIFICATIONS §3.2)", () => {
  it("returns a 2xx response", async () => {
    const { fetch, calls } = scriptedFetch(ok());
    const response = await request(client(fetch), read);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(calls()).toBe(1);
  });

  it("retries a 5xx up to twice, then succeeds", async () => {
    const { fetch, calls } = scriptedFetch(status(502), status(503), ok());

    await expect(request(client(fetch), read)).resolves.toMatchObject({ status: 200 });
    expect(calls()).toBe(3);
  });

  it("retries a 5xx at most twice, then throws GatewayServerError", async () => {
    const { fetch, calls } = scriptedFetch(status(500));

    await expect(request(client(fetch), read)).rejects.toBeInstanceOf(GatewayServerError);
    expect(calls()).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it("retries a 429, then throws RateLimitError", async () => {
    const { fetch, calls } = scriptedFetch(status(429));

    await expect(request(client(fetch), read)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls()).toBe(3);
  });

  it("retries a network error, then throws ConnectionError with the cause", async () => {
    const cause = new TypeError("fetch failed");
    const { fetch, calls } = scriptedFetch(cause);
    const error = await request(client(fetch), read).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).cause).toBe(cause);
    expect((error as ConnectionError).gateway).toBe("fawry");
    expect(calls()).toBe(3);
  });

  it("retries a timeout, then throws ConnectionError", async () => {
    const { fetch, calls } = scriptedFetch("hang");

    await expect(request(client(fetch, { timeoutMs: 10 }), read)).rejects.toBeInstanceOf(ConnectionError);
    expect(calls()).toBe(3);
  });

  it.each([
    [400, BadRequestError],
    [404, NotFoundError],
    [302, GatewayServerError],
  ])("does not retry HTTP %i", async (code, type) => {
    const { fetch, calls } = scriptedFetch(status(code));

    await expect(request(client(fetch), read)).rejects.toBeInstanceOf(type);
    expect(calls()).toBe(1);
  });

  it("stops at once when the caller aborts, rethrowing the caller's reason", async () => {
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const { fetch, calls } = scriptedFetch("hang");
    const pending = request(client(fetch), { ...read, signal: controller.signal });

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(calls()).toBe(1);
  });
});

describe("read backoff", () => {
  it("uses exponential backoff with full jitter", async () => {
    const { fetch } = scriptedFetch(status(503));

    await request(client(fetch), read).catch(() => undefined);

    expect(sleeps).toEqual([250, 500]);
  });

  it.each([0, 0.999_999])("keeps the jitter within [0, ceiling) for random() = %s", async (value) => {
    const { fetch } = scriptedFetch(status(503));

    await request(client(fetch, { retry: { ...instantRetry, random: () => value } }), read).catch(() => undefined);

    for (const [index, delay] of sleeps.entries()) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(500 * 2 ** index);
    }
  });

  it("honours Retry-After in seconds", async () => {
    const { fetch } = scriptedFetch(status(429, { "retry-after": "2" }), ok());

    await request(client(fetch), read);

    expect(sleeps).toEqual([2000]);
  });

  it("caps Retry-After at 5 seconds", async () => {
    const { fetch } = scriptedFetch(status(503, { "retry-after": "120" }), ok());

    await request(client(fetch), read);

    expect(sleeps).toEqual([5000]);
  });

  it("honours Retry-After as an HTTP date", async () => {
    const { fetch } = scriptedFetch(status(503, { "retry-after": "Wed, 18 Nov 2026 10:00:03 GMT" }), ok());

    await request(client(fetch), read);

    expect(sleeps).toEqual([3000]);
  });

  it("treats a Retry-After date in the past as no wait", async () => {
    const { fetch } = scriptedFetch(status(503, { "retry-after": "Wed, 18 Nov 2026 09:00:00 GMT" }), ok());

    await request(client(fetch), read);

    expect(sleeps).toEqual([0]);
  });

  it("falls back to backoff when Retry-After is not valid", async () => {
    const { fetch } = scriptedFetch(status(503, { "retry-after": "soon" }), ok());

    await request(client(fetch), read);

    expect(sleeps).toEqual([250]);
  });

  it("works with the default sleep, random and clock", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, calls } = scriptedFetch(status(503), ok());

    await request({ gateway: "fawry", baseUrl: "https://api.example.test", fetch }, read);

    expect(calls()).toBe(2);
    vi.restoreAllMocks();
  });

  it("stops waiting when the caller aborts during the backoff sleep", async () => {
    const controller = new AbortController();
    const reason = new Error("caller gave up");
    const { fetch, calls } = scriptedFetch(status(503, { "retry-after": "1" }));
    const pending = request({ gateway: "fawry", baseUrl: "https://api.example.test", fetch }, { ...read, signal: controller.signal });

    setTimeout(() => controller.abort(reason), 20);

    await expect(pending).rejects.toBe(reason);
    expect(calls()).toBe(1);
  });
});

describe("mutations never retry (CLAUDE.md rule 6)", () => {
  it("returns a 2xx response", async () => {
    const { fetch, calls } = scriptedFetch(ok());

    await expect(request(client(fetch), mutation)).resolves.toMatchObject({ status: 200 });
    expect(calls()).toBe(1);
  });

  it("makes exactly one fetch call on a 5xx and throws OutcomeUnknownError", async () => {
    const { fetch, calls } = scriptedFetch(status(503), ok());
    const error = await request(client(fetch), mutation).catch((caught: unknown) => caught);

    expect(calls()).toBe(1);
    expect(sleeps).toHaveLength(0);
    expect(error).toBeInstanceOf(OutcomeUnknownError);
    expect(error).toMatchObject({ code: "outcome_unknown", gateway: "fawry", operation: "refunds.create", merchantReference: "order_1" });
    expect((error as OutcomeUnknownError).cause).toBeInstanceOf(GatewayServerError);
    expect((error as OutcomeUnknownError).message).toContain("HTTP 503");
  });

  it("makes exactly one fetch call on a timeout and throws OutcomeUnknownError", async () => {
    const { fetch, calls } = scriptedFetch("hang", ok());
    const error = await request(client(fetch, { timeoutMs: 10 }), mutation).catch((caught: unknown) => caught);

    expect(calls()).toBe(1);
    expect(error).toBeInstanceOf(OutcomeUnknownError);
    expect((error as OutcomeUnknownError).message).toContain("timed out");
  });

  it("makes exactly one fetch call on a network error and throws OutcomeUnknownError", async () => {
    const cause = new TypeError("fetch failed");
    const { fetch, calls } = scriptedFetch(cause, ok());
    const error = await request(client(fetch), mutation).catch((caught: unknown) => caught);

    expect(calls()).toBe(1);
    expect(error).toBeInstanceOf(OutcomeUnknownError);
    expect((error as OutcomeUnknownError).cause).toBe(cause);
    expect((error as OutcomeUnknownError).message).toContain("network error");
  });

  it("treats a caller abort after sending as an unknown outcome", async () => {
    const controller = new AbortController();
    const { fetch, calls } = scriptedFetch("hang");
    const pending = request(client(fetch), { ...mutation, signal: controller.signal });

    controller.abort(new Error("caller gave up"));

    await expect(pending).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(pending).rejects.toThrow("aborted");
    expect(calls()).toBe(1);
  });

  it("does not retry a 429: it throws RateLimitError", async () => {
    const { fetch, calls } = scriptedFetch(status(429), ok());

    await expect(request(client(fetch), mutation)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls()).toBe(1);
  });

  it("treats a 4xx as a definite failure", async () => {
    const { fetch, calls } = scriptedFetch(status(400), ok());

    await expect(request(client(fetch), mutation)).rejects.toBeInstanceOf(BadRequestError);
    expect(calls()).toBe(1);
  });

  it("treats an unexpected 3xx as an unknown outcome", async () => {
    const { fetch } = scriptedFetch(status(302));

    await expect(request(client(fetch), mutation)).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it("serializes OutcomeUnknownError without the cause or any response data", async () => {
    const { fetch } = scriptedFetch(status(503));
    const error = (await request(client(fetch), mutation).catch((caught: unknown) => caught)) as OutcomeUnknownError;

    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "OutcomeUnknownError",
      code: "outcome_unknown",
      gateway: "fawry",
      operation: "refunds.create",
      merchantReference: "order_1",
    });
  });
});

describe("never sent (GEN-01)", () => {
  it("throws InvalidArgumentError before calling fetch when the input is invalid", async () => {
    const { fetch, calls } = scriptedFetch(ok());

    await expect(request(client(fetch), { ...mutation, path: "/refund/{id}" })).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(calls()).toBe(0);
  });

  it("throws the caller's reason before calling fetch when the signal is already aborted", async () => {
    const reason = new Error("already aborted");
    const { fetch, calls } = scriptedFetch(ok());

    await expect(request(client(fetch), { ...mutation, signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(calls()).toBe(0);
  });
});
