import {
  BadRequestError,
  CapabilityError,
  ConfigError,
  fingerprint,
  GatewayServerError,
  IdempotencyError,
  type IdempotencyStore,
  InvalidArgumentError,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MemoryIdempotencyStore,
  OutcomeUnknownError,
  request,
  runIdempotent,
  sha256,
  stableStringify,
} from "@bawabajs/core";
import { describe, expect, it, vi } from "vitest";

describe("stableStringify", () => {
  it("sorts object keys at every depth and drops undefined properties", () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("gives the same text whatever the key order", () => {
    expect(stableStringify({ amount: 100, currency: "EGP" })).toBe(stableStringify({ currency: "EGP", amount: 100 }));
  });

  it("follows JSON for primitives, null, undefined array items and toJSON", () => {
    expect(stableStringify([null, true, 'a"b', 1.5, undefined])).toBe('[null,true,"a\\"b",1.5,null]');
    expect(stableStringify({ at: new Date("2026-11-19T00:00:00.000Z") })).toBe('{"at":"2026-11-19T00:00:00.000Z"}');
    expect(stableStringify(Object.assign(Object.create(null) as object, { b: 2, a: 1 }))).toBe('{"a":1,"b":2}');
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["undefined", undefined],
    ["bytes", new Uint8Array(1)],
    ["a Map", new Map()],
  ])("rejects %s, at the top and nested", (_label, value) => {
    expect(() => stableStringify(value)).toThrow(InvalidArgumentError);

    if (value !== undefined) {
      expect(() => stableStringify({ nested: [value] })).toThrow(InvalidArgumentError);
    }
  });

  it("applies toJSON once, never to its own result", () => {
    const selfReturning = {
      toJSON() {
        return this;
      },
    };
    expect(() => stableStringify(selfReturning)).toThrow(InvalidArgumentError);
    expect(stableStringify({ toJSON: () => ({ toJSON: "kept as data" }) })).toBe('{"toJSON":"kept as data"}');
  });

  it("rejects cycles but accepts shared values", () => {
    const shared = { id: 1 };
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"id":1},"b":{"id":1}}');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(InvalidArgumentError);
  });
});

describe("fingerprint", () => {
  it("is the SHA-256 hex of the stable JSON", async () => {
    expect(await fingerprint({ b: 2, a: 1 })).toBe(await sha256('{"a":1,"b":2}'));
  });
});

describe("MemoryIdempotencyStore", () => {
  it("claims a new key, then reports it as held", async () => {
    const store = new MemoryIdempotencyStore();
    expect(await store.claim("k", "fp1")).toEqual({ state: "claimed" });
    expect(await store.claim("k", "fp2")).toEqual({ state: "held", fingerprint: "fp1" });
    expect(await store.get("k")).toEqual({ state: "held", fingerprint: "fp1" });
  });

  it("stores a completed result for replay", async () => {
    const store = new MemoryIdempotencyStore();
    await store.claim("k", "fp1");
    await store.complete("k", { id: "pay_1" });
    expect(await store.claim("k", "fp1")).toEqual({ state: "completed", fingerprint: "fp1", result: { id: "pay_1" } });
    expect(await store.get("k")).toEqual({ state: "completed", fingerprint: "fp1", result: { id: "pay_1" } });
  });

  it("forgets a released key", async () => {
    const store = new MemoryIdempotencyStore();
    await store.claim("k", "fp1");
    await store.release("k");
    expect(await store.get("k")).toBeUndefined();
    expect(await store.claim("k", "fp2")).toEqual({ state: "claimed" });
  });

  it("refuses to complete a key that was never claimed", async () => {
    await expect(new MemoryIdempotencyStore().complete("k", 1)).rejects.toThrow(InvalidArgumentError);
  });

  it("expires completed records after the TTL, but never held ones", async () => {
    let now = 1_000;
    const store = new MemoryIdempotencyStore({ ttlMs: 100, now: () => now });
    await store.claim("done", "fp");
    await store.complete("done", "result");
    await store.claim("held", "fp");

    now += 99;
    expect(await store.get("done")).toBeDefined();

    now += 1;
    expect(await store.get("done")).toBeUndefined();
    expect(await store.claim("done", "fp")).toEqual({ state: "claimed" });

    now += 10_000_000;
    expect(await store.get("held")).toEqual({ state: "held", fingerprint: "fp" });
  });

  it("sweeps expired records from memory at most once a minute", async () => {
    let now = 0;
    const store = new MemoryIdempotencyStore({ ttlMs: 10, now: () => now });
    await store.claim("a", "fp");
    await store.complete("a", 1);

    now = 60_000;
    await store.claim("b", "fp");
    now = 60_001;
    await store.claim("c", "fp");
    expect(await store.get("a")).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects the TTL %s", (ttlMs) => {
    expect(() => new MemoryIdempotencyStore({ ttlMs })).toThrow(InvalidArgumentError);
  });
});

const call = (store: IdempotencyStore, key = "refund:order_1", params: unknown = { amount: 5_000 }) => ({
  store,
  key,
  gateway: "fawry",
  operation: "refunds.create",
  params,
});

describe("runIdempotent", () => {
  it("sends once and replays the stored result for the same key and parameters", async () => {
    const store = new MemoryIdempotencyStore();
    const send = vi.fn(async () => ({ id: "refund_1" }));

    expect(await runIdempotent(call(store), send)).toEqual({ id: "refund_1" });
    expect(await runIdempotent(call(store, "refund:order_1", { amount: 5_000 }), send)).toEqual({ id: "refund_1" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends without a store lookup when there is no key", async () => {
    const store = new MemoryIdempotencyStore();
    const claim = vi.spyOn(store, "claim");

    expect(await runIdempotent({ ...call(store), key: undefined }, async () => "sent")).toBe("sent");
    expect(claim).not.toHaveBeenCalled();
  });

  it("refuses the same key with other parameters, before sending", async () => {
    const store = new MemoryIdempotencyStore();
    await runIdempotent(call(store), async () => "first");
    const send = vi.fn(async () => "second");

    await expect(runIdempotent(call(store, "refund:order_1", { amount: 6_000 }), send)).rejects.toMatchObject({
      code: "idempotency_key_reused",
      gateway: "fawry",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses the same key for another operation", async () => {
    const store = new MemoryIdempotencyStore();
    await runIdempotent(call(store), async () => "refund");

    await expect(runIdempotent({ ...call(store), operation: "payments.capture" }, async () => "capture")).rejects.toMatchObject({
      code: "idempotency_key_reused",
    });
  });

  it("keeps the claim after an unknown outcome, so a blind retry is refused", async () => {
    const store = new MemoryIdempotencyStore();
    const unknown = new OutcomeUnknownError("m", { gateway: "fawry", operation: "refunds.create" });

    await expect(runIdempotent(call(store), () => Promise.reject(unknown))).rejects.toBe(unknown);
    expect((await store.get("refund:order_1"))?.state).toBe("held");

    const retry = vi.fn(async () => "retried");
    await expect(runIdempotent(call(store), retry)).rejects.toMatchObject({ code: "idempotency_outcome_unknown" });
    expect(retry).not.toHaveBeenCalled();
  });

  it("reports reuse rather than an unknown outcome when a held key gets other parameters", async () => {
    const store = new MemoryIdempotencyStore();
    await store.claim("refund:order_1", "another fingerprint");

    await expect(runIdempotent(call(store), async () => "x")).rejects.toMatchObject({ code: "idempotency_key_reused" });
  });

  it.each([
    ["a 4xx ApiError", new BadRequestError("m", { status: 400 })],
    ["an InvalidArgumentError", new InvalidArgumentError("m")],
    ["a ConfigError", new ConfigError("m")],
    ["a CapabilityError", new CapabilityError("m", "capability_beta")],
  ])("releases the claim after %s, a definite failure", async (_label, error) => {
    const store = new MemoryIdempotencyStore();

    await expect(runIdempotent(call(store), () => Promise.reject(error))).rejects.toBe(error);
    expect(await store.get("refund:order_1")).toBeUndefined();
  });

  it.each([
    ["a 5xx ApiError", new GatewayServerError("m", { status: 503 })],
    ["an unexpected error", new TypeError("bug")],
    ["a caller abort", new DOMException("aborted", "AbortError")],
  ])("keeps the claim after %s, because the outcome may be unknown", async (_label, error) => {
    const store = new MemoryIdempotencyStore();

    await expect(runIdempotent(call(store), () => Promise.reject(error))).rejects.toBe(error);
    expect((await store.get("refund:order_1"))?.state).toBe("held");
  });

  it("returns a successful result even if the store fails to record it, and the key stays held", async () => {
    const store = new MemoryIdempotencyStore();
    vi.spyOn(store, "complete").mockRejectedValue(new Error("store down"));

    expect(await runIdempotent(call(store), async () => "paid")).toBe("paid");
    expect((await store.get("refund:order_1"))?.state).toBe("held");
  });

  it("throws the gateway's error even if the store fails to release the claim", async () => {
    const store = new MemoryIdempotencyStore();
    vi.spyOn(store, "release").mockRejectedValue(new Error("store down"));
    const error = new BadRequestError("m", { status: 422 });

    await expect(runIdempotent(call(store), () => Promise.reject(error))).rejects.toBe(error);
  });

  it.each(["", "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1), 42 as unknown as string])("rejects the key %j before claiming", async (key) => {
    const store = new MemoryIdempotencyStore();
    const send = vi.fn(async () => "x");

    await expect(runIdempotent(call(store, key), send)).rejects.toThrow(InvalidArgumentError);
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a key of the maximum length", async () => {
    expect(await runIdempotent(call(new MemoryIdempotencyStore(), "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH)), async () => "ok")).toBe("ok");
  });

  it("refuses parameters that cannot be fingerprinted, before sending", async () => {
    const send = vi.fn(async () => "x");

    await expect(runIdempotent(call(new MemoryIdempotencyStore(), "k", { amount: 1n }), send)).rejects.toThrow(InvalidArgumentError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("a 5xx on a mutation through the pipeline (Milestone 1 acceptance)", () => {
  it("makes exactly one call, throws OutcomeUnknownError and keeps the idempotency claim", async () => {
    const store = new MemoryIdempotencyStore();
    const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const refund = () =>
      runIdempotent(call(store), () =>
        request(
          { gateway: "fawry", baseUrl: "https://api.example.test", fetch },
          { method: "POST", path: "/refunds", kind: "mutation", operation: "refunds.create" },
        ),
      );

    await expect(refund()).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await store.get("refund:order_1"))?.state).toBe("held");

    await expect(refund()).rejects.toBeInstanceOf(IdempotencyError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
