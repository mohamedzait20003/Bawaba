import { describe, expect, it } from "vitest";
import { base64ToBytes, type Capture, MAX_BODY_BYTES, parseHookPath } from "../capture/capture.ts";
import { CAPTURE_TTL_SECONDS, type Env, handle, type KvNamespace } from "../webhook-receiver/src/index.ts";

class MemoryKv implements KvNamespace {
  readonly entries = new Map<string, { value: string; ttl: number | undefined }>();

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.entries.set(key, { value, ttl: options?.expirationTtl });
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key)?.value ?? null;
  }

  async list(options: { prefix: string; limit?: number; cursor?: string }) {
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(options.prefix)).map((name) => ({ name }));
    return { keys, list_complete: true, ...(options.cursor ? { cursor: `after-${options.cursor}` } : {}) };
  }
}

const TOKEN = "read_token_test_do_not_use";
const options = { now: () => new Date("2026-11-19T10:00:00.000Z"), id: () => "id-1" };

function setup(readToken: string | undefined = TOKEN): { env: Env; kv: MemoryKv } {
  const kv = new MemoryKv();
  return { kv, env: readToken === undefined ? { CAPTURES: kv } : { CAPTURES: kv, READ_TOKEN: readToken } };
}

const read = (env: Env, path: string, token = TOKEN) =>
  handle(new Request(`https://rx.example.test${path}`, { headers: { authorization: `Bearer ${token}` } }), env, options);

describe("capturing", () => {
  it("stores a POST callback byte for byte, with its query and headers, for 30 days", async () => {
    const { env, kv } = setup();
    const body = '{"amount":"250.00","name":"Ø¨ÙˆØ§Ø¨Ø©"}';
    const response = await handle(
      new Request("https://rx.example.test/hooks/paymob?hmac=abc&hmac=def", {
        method: "POST",
        body,
        headers: { "content-type": "application/json", "x-kashier-signature": "s", cookie: "c=1", "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "x" },
      }),
      env,
      options,
    );

    expect(response.status).toBe(200);
    const entry = kv.entries.get("capture:paymob:2026-11-19T10:00:00.000Z:id-1");
    expect(entry?.ttl).toBe(CAPTURE_TTL_SECONDS);

    const capture = JSON.parse(entry?.value ?? "{}") as Capture;
    expect(capture).toMatchObject({ id: "id-1", gateway: "paymob", label: null, method: "POST", path: "/hooks/paymob", rawQuery: "hmac=abc&hmac=def" });
    expect(capture.headers).toEqual({ "content-type": "application/json", "x-kashier-signature": "s" });
    expect(new TextDecoder().decode(base64ToBytes(capture.rawBodyBase64))).toBe(body);
  });

  it("captures a GET redirect with a label", async () => {
    const { env, kv } = setup();
    const response = await handle(new Request("https://rx.example.test/hooks/kashier/redirect?paymentStatus=SUCCESS"), env, options);

    expect(response.status).toBe(200);
    const capture = JSON.parse(kv.entries.get("capture:kashier:2026-11-19T10:00:00.000Z:id-1")?.value ?? "{}") as Capture;
    expect(capture).toMatchObject({ method: "GET", label: "redirect", rawQuery: "paymentStatus=SUCCESS", rawBodyBase64: "" });
  });

  it.each(["/hooks/stripe", "/hooks", "/other", "/hooks/tap/Bad_Label", "/hooks/tap/a/b"])("refuses %s", async (path) => {
    const { env, kv } = setup();
    expect((await handle(new Request(`https://rx.example.test${path}`, { method: "POST", body: "x" }), env, options)).status).toBe(404);
    expect(kv.entries.size).toBe(0);
  });

  it("refuses a body over the limit, by header or by size", async () => {
    const { env } = setup();
    // fetch's Request computes its own content-length, so a declared one is simulated.
    const declared = {
      url: "https://rx.example.test/hooks/tap",
      method: "POST",
      headers: new Headers({ "content-length": String(MAX_BODY_BYTES + 1) }),
      arrayBuffer: () => Promise.reject(new Error("the body must not be read")),
    } as unknown as Request;
    const actual = new Request("https://rx.example.test/hooks/tap", { method: "POST", body: new Uint8Array(MAX_BODY_BYTES + 1) });

    expect((await handle(declared, env, options)).status).toBe(413);
    expect((await handle(actual, env, options)).status).toBe(413);
  });

  it("answers the root path for health checks", async () => {
    const { env } = setup();
    expect(await (await handle(new Request("https://rx.example.test/"), env)).text()).toBe("Bawaba webhook receiver");
  });
});

describe("reading captures", () => {
  it("lists and returns captures with the read token", async () => {
    const { env } = setup();
    await handle(new Request("https://rx.example.test/hooks/tap", { method: "POST", body: "{}" }), env, options);

    const list = (await (await read(env, "/captures/tap")).json()) as { keys: string[]; complete: boolean; cursor: string | null };
    expect(list).toEqual({ keys: ["capture:tap:2026-11-19T10:00:00.000Z:id-1"], complete: true, cursor: null });

    const paged = (await (await read(env, "/captures/tap?cursor=c1")).json()) as { cursor: string };
    expect(paged.cursor).toBe("after-c1");

    const one = await read(env, `/captures/tap/${encodeURIComponent("capture:tap:2026-11-19T10:00:00.000Z:id-1")}`);
    expect(one.headers.get("content-type")).toBe("application/json");
    expect(((await one.json()) as Capture).gateway).toBe("tap");
  });

  it("refuses a wrong token, a missing token and an unset READ_TOKEN", async () => {
    expect((await read(setup().env, "/captures/tap", "wrong")).status).toBe(401);
    expect((await handle(new Request("https://rx.example.test/captures/tap"), setup().env, options)).status).toBe(401);
    expect((await read(setup(undefined).env, "/captures/tap", "")).status).toBe(401);
  });

  it("returns 404 for an unknown gateway, another gateway's key or a missing key", async () => {
    const { env } = setup();
    await handle(new Request("https://rx.example.test/hooks/tap", { method: "POST", body: "{}" }), env, options);

    expect((await read(env, "/captures/stripe")).status).toBe(404);
    expect((await read(env, "/captures/tap/a/b")).status).toBe(404);
    expect((await read(env, `/captures/paymob/${encodeURIComponent("capture:tap:2026-11-19T10:00:00.000Z:id-1")}`)).status).toBe(404);
    expect((await read(env, "/captures/tap/capture%3Atap%3Amissing")).status).toBe(404);
    expect((await read(env, "/captures/")).status).toBe(404);
  });

  it("refuses anything but GET", async () => {
    const { env } = setup();
    expect((await handle(new Request("https://rx.example.test/captures/tap", { method: "DELETE" }), env, options)).status).toBe(405);
  });
});

describe("parseHookPath", () => {
  it("accepts a gateway and an optional label", () => {
    expect(parseHookPath("/hooks/geidea")).toEqual({ gateway: "geidea", label: null });
    expect(parseHookPath("/hooks/geidea/callback-1/")).toEqual({ gateway: "geidea", label: "callback-1" });
  });
});
