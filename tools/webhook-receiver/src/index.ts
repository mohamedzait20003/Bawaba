// Bawaba webhook receiver: a Cloudflare Worker that stores raw gateway callbacks in KV for the validation work.
// See ../README.md. Never point a live (production) gateway account at it.
import { CAPTURE_GATEWAYS, captureKey, captureRequest } from "../../capture/capture.ts";

export const CAPTURE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LIST_LIMIT = 100;

export interface KvNamespace {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  readonly CAPTURES: KvNamespace;
  readonly READ_TOKEN?: string;
}

export interface HandlerOptions {
  readonly now: () => Date;
  readonly id: () => string;
}

const defaults: HandlerOptions = { now: () => new Date(), id: () => crypto.randomUUID() };

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// Compares SHA-256 digests, so the comparison takes the same time whatever the token length.
async function sameToken(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;

  for (let index = 0; index < a.length; index++) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }

  return difference === 0;
}

async function readCaptures(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return text(405, "Method not allowed");
  }

  const expected = env.READ_TOKEN ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");

  if (expected === "" || !(await sameToken(given, expected))) {
    return text(401, "Unauthorized");
  }

  const [, gateway, key, ...rest] = url.pathname.split("/").filter((part) => part !== "");

  if (gateway === undefined || !CAPTURE_GATEWAYS.includes(gateway) || rest.length > 0) {
    return text(404, "Not found");
  }

  const prefix = `capture:${gateway}:`;

  if (key === undefined) {
    const cursor = url.searchParams.get("cursor");
    const listing = await env.CAPTURES.list({ prefix, limit: LIST_LIMIT, ...(cursor === null ? {} : { cursor }) });

    return Response.json({ keys: listing.keys.map((entry) => entry.name), complete: listing.list_complete, cursor: listing.cursor ?? null });
  }

  const name = decodeURIComponent(key);
  const stored = name.startsWith(prefix) ? await env.CAPTURES.get(name) : null;

  return stored === null ? text(404, "Not found") : new Response(stored, { headers: { "content-type": "application/json" } });
}

export async function handle(request: Request, env: Env, options: HandlerOptions = defaults): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return text(200, "Bawaba webhook receiver");
  }

  if (url.pathname.startsWith("/captures/")) {
    return readCaptures(request, env, url);
  }

  const result = await captureRequest(request, { now: options.now(), id: options.id() });

  if ("status" in result) {
    return text(result.status, result.message);
  }

  await env.CAPTURES.put(captureKey(result.capture), JSON.stringify(result.capture), { expirationTtl: CAPTURE_TTL_SECONDS });

  return text(200, "OK");
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
