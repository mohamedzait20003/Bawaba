import type { FetchLike } from "@bawabajs/core";

export interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export type FetchResponder = (call: FetchCall) => Response | Promise<Response>;

export type ScriptedResponse = Response | Error | FetchResponder;

export interface FakeFetch {
  readonly fetch: FetchLike;
  readonly calls: readonly FetchCall[];
}

function headersRecord(init: RequestInit): Record<string, string> {
  const record: Record<string, string> = {};

  new Headers(init.headers).forEach((value, name) => {
    record[name] = value;
  });

  return record;
}

export function fakeFetch(...script: ScriptedResponse[]): FakeFetch {
  const calls: FetchCall[] = [];

  const fetch: FetchLike = async (url, init) => {
    const call: FetchCall = { url, method: init.method ?? "GET", headers: headersRecord(init), body: typeof init.body === "string" ? init.body : undefined };
    const next = script[calls.length];

    calls.push(call);

    if (next === undefined) {
      throw new Error(`fakeFetch: unexpected request ${calls.length} (${call.method} ${call.url})`);
    }

    if (next instanceof Error) {
      throw next;
    }

    return next instanceof Response ? next : next(call);
  };

  return { fetch, calls };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}
