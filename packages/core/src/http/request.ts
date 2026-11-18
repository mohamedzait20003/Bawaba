import { type ApiError, apiErrorForStatus, ConfigError, InvalidArgumentError } from "../errors.js";
import type { FetchLike, HttpClientConfig, HttpMethod, HttpResponse, QueryValue, RequestEvent, RequestSpec, ResponseEvent, TransportFailure } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_ID_HEADERS: readonly string[] = ["x-request-id", "request-id"];

const PLACEHOLDER = /\{(\w+)\}/g;
const SLASH = 47;

export interface PreparedRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly hookUrl: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

export type AttemptResult =
  | { readonly type: "response"; readonly response: HttpResponse }
  | { readonly type: "http_error"; readonly error: ApiError }
  | { readonly type: "transport_error"; readonly failure: TransportFailure; readonly cause: unknown };

function trimTrailingSlashes(text: string): string {
  let end = text.length;

  while (end > 0 && text.codePointAt(end - 1) === SLASH) {
    end -= 1;
  }

  return text.slice(0, end);
}

function parseBaseUrl(baseUrl: string): string {
  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new ConfigError("The base URL is not a valid URL", { cause });
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("The base URL must use https or http");
  }

  return trimTrailingSlashes(baseUrl);
}

function encodePathParam(name: string, value: string | number): string {
  const text = String(value);

  if (text === "" || text === "." || text === "..") {
    throw new InvalidArgumentError(`The path parameter "${name}" must not be empty, "." or ".."`);
  }

  return encodeURIComponent(text);
}

function fillPath(path: string, params: Readonly<Record<string, string | number>> = {}): string {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new InvalidArgumentError('The path must start with "/" and must not contain "?" or "#"; pass query parameters separately');
  }

  const used = new Set<string>();
  const filled = path.replace(PLACEHOLDER, (_placeholder: string, name: string) => {
    if (!Object.hasOwn(params, name)) {
      throw new InvalidArgumentError(`The path parameter "${name}" is missing`);
    }

    used.add(name);

    return encodePathParam(name, params[name] as string | number);
  });

  for (const name of Object.keys(params)) {
    if (!used.has(name)) {
      throw new InvalidArgumentError(`The path parameter "${name}" is not used by the path`);
    }
  }

  return filled;
}

function definedEntries(record: Readonly<Record<string, QueryValue>>): [string, string][] {
  return Object.entries(record).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]]));
}

function encodeBody(spec: RequestSpec): { body: string | undefined; contentType: string | undefined } {
  if (spec.json !== undefined && spec.form !== undefined) {
    throw new InvalidArgumentError("A request can have a JSON body or a form body, not both");
  }
  if (spec.json !== undefined) {
    return { body: JSON.stringify(spec.json), contentType: "application/json" };
  }
  if (spec.form !== undefined) {
    return { body: new URLSearchParams(definedEntries(spec.form)).toString(), contentType: "application/x-www-form-urlencoded" };
  }

  return { body: undefined, contentType: undefined };
}

function buildHeaders(config: HttpClientConfig, spec: RequestSpec, contentType: string | undefined): Headers {
  try {
    const headers = new Headers(config.headers);

    if (contentType !== undefined) {
      headers.set("content-type", contentType);
    }
    for (const [name, value] of Object.entries(spec.headers ?? {})) {
      headers.set(name, value);
    }

    return headers;
  } catch (cause) {
    throw new InvalidArgumentError("A header name or value is invalid", { cause });
  }
}

export function prepareRequest(config: HttpClientConfig, spec: RequestSpec): PreparedRequest {
  const url = new URL(parseBaseUrl(config.baseUrl) + fillPath(spec.path, spec.pathParams));

  for (const [key, value] of definedEntries(spec.query ?? {})) {
    url.searchParams.append(key, value);
  }

  const { body, contentType } = encodeBody(spec);

  return { method: spec.method, url: url.href, hookUrl: url.origin + url.pathname, headers: buildHeaders(config, spec, contentType), body };
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

function notify<T>(hook: ((event: T) => void) | undefined, event: T): void {
  if (hook === undefined) {
    return;
  }

  try {
    hook(event);
  } catch {
    // Hooks only observe. A failing hook must not change the outcome of a payment call.
  }
}

function classifyFailure(callerSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): TransportFailure {
  if (callerSignal?.aborted) {
    return "aborted";
  }

  return timeoutSignal.aborted ? "timeout" : "network";
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};

  headers.forEach((value, name) => {
    record[name] = value;
  });

  return record;
}

function findRequestId(headers: Readonly<Record<string, string>>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = headers[name.toLowerCase()];

    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseBody(text: string): unknown {
  if (text === "") {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function sendOnce(config: HttpClientConfig, spec: RequestSpec, prepared: PreparedRequest, attempt: number): Promise<AttemptResult> {
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = spec.signal ? AbortSignal.any([spec.signal, timeoutSignal]) : timeoutSignal;
  const event: RequestEvent = { gateway: config.gateway, operation: spec.operation, kind: spec.kind, method: prepared.method, url: prepared.hookUrl, attempt };
  const started = performance.now();
  const finish = (status: number | undefined, failure: TransportFailure | undefined): void => {
    notify<ResponseEvent>(config.onResponse, { ...event, status, failure, durationMs: performance.now() - started });
  };

  notify(config.onRequest, event);

  let response: Response;
  let text: string;

  try {
    response = await (config.fetch ?? defaultFetch)(prepared.url, { method: prepared.method, headers: prepared.headers, body: prepared.body ?? null, signal });
    text = await response.text();
  } catch (cause) {
    const failure = classifyFailure(spec.signal, timeoutSignal);

    finish(undefined, failure);

    return { type: "transport_error", failure, cause };
  }

  finish(response.status, undefined);

  const headers = headersToRecord(response.headers);
  const requestId = findRequestId(headers, config.requestIdHeaders ?? DEFAULT_REQUEST_ID_HEADERS);
  const data = parseBody(text);

  if (response.ok) {
    return { type: "response", response: { status: response.status, headers, requestId, data } };
  }

  const error = apiErrorForStatus(response.status, `${config.gateway} returned HTTP ${response.status}`, {
    gateway: config.gateway,
    headers,
    requestId,
    raw: data,
  });

  return { type: "http_error", error };
}
