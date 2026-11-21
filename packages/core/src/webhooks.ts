import { utf8Decode, utf8Encode } from "./encoding.js";
import { InvalidArgumentError, SignatureVerificationError } from "./errors.js";

type ValuesRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

export type HeaderInput = Headers | ValuesRecord;

export type QueryInput = URLSearchParams | string | ValuesRecord;

export interface RawWebhookRequest {
  readonly rawBody: string | Uint8Array;
  readonly headers?: HeaderInput;
  readonly query?: QueryInput;
}

export interface WebhookRequest {
  readonly rawBody: string | Uint8Array;
  readonly body: string;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface WebhookVerification<T> {
  readonly gateway: string;
  readonly verify: (request: WebhookRequest) => boolean | Promise<boolean>;
  readonly parse: (request: WebhookRequest) => T | Promise<T>;
}

function emptyRecord(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function firstValues(entries: Iterable<[string, unknown]>): Readonly<Record<string, string>> {
  const record = emptyRecord();

  for (const [name, value] of entries) {
    const first: unknown = Array.isArray(value) ? value[0] : value;

    if (typeof first === "string" && !Object.hasOwn(record, name)) {
      record[name] = first;
    }
  }

  return Object.freeze(record);
}

function normalizeHeaders(input: HeaderInput | undefined): Readonly<Record<string, string>> {
  const headers = new Headers();

  try {
    const entries: Iterable<[string, unknown]> = input instanceof Headers ? input : Object.entries(input ?? {});

    for (const [name, value] of entries) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "string") {
          headers.append(name, item);
        }
      }
    }
  } catch (cause) {
    throw new InvalidArgumentError("A webhook header name or value is invalid", { cause });
  }

  return firstValues(headers);
}

function normalizeQuery(input: QueryInput | undefined): Readonly<Record<string, string>> {
  if (typeof input === "string" || input instanceof URLSearchParams) {
    return firstValues(new URLSearchParams(input));
  }

  return firstValues(Object.entries(input ?? {}));
}

function isRequestLike(input: unknown): input is { rawBody?: unknown; headers?: HeaderInput; query?: QueryInput } {
  return typeof input === "object" && input !== null;
}

export function normalizeWebhookRequest(input: unknown): WebhookRequest {
  if (!isRequestLike(input)) {
    throw new InvalidArgumentError("A webhook request must be an object with rawBody, headers and query");
  }

  const { rawBody } = input;

  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) {
    throw new InvalidArgumentError("Pass the raw request body as a string or Uint8Array, exactly as received. A parsed body changes the signed values.");
  }

  return {
    rawBody,
    body: typeof rawBody === "string" ? rawBody : utf8Decode(rawBody),
    bytes: typeof rawBody === "string" ? utf8Encode(rawBody) : rawBody,
    headers: normalizeHeaders(input.headers),
    query: normalizeQuery(input.query),
  };
}

function failClosed(gateway: string, message: string, cause: unknown): SignatureVerificationError {
  return cause instanceof SignatureVerificationError ? cause : new SignatureVerificationError(message, { gateway, cause });
}

export async function verifyWebhook<T>(input: unknown, verification: WebhookVerification<T>): Promise<T> {
  const { gateway } = verification;
  const request = normalizeWebhookRequest(input);
  let valid: boolean;

  try {
    valid = await verification.verify(request);
  } catch (cause) {
    throw failClosed(gateway, `The ${gateway} callback could not be verified`, cause);
  }

  if (valid !== true) {
    throw new SignatureVerificationError(`The ${gateway} callback signature is missing or wrong`, { gateway });
  }

  try {
    return await verification.parse(request);
  } catch (cause) {
    throw failClosed(gateway, `The verified ${gateway} callback could not be parsed`, cause);
  }
}

export function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new InvalidArgumentError("The body is not valid JSON", { cause });
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidArgumentError("The body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

export function parseFormBody(text: string): Readonly<Record<string, string>> {
  return firstValues(new URLSearchParams(text));
}

export function requireEventType<const Known extends string>(value: unknown, known: readonly Known[], gateway: string): Known {
  if (typeof value === "string" && (known as readonly string[]).includes(value)) {
    return value as Known;
  }

  throw new SignatureVerificationError(`The ${gateway} callback has a missing or unknown event type`, { gateway });
}

export function pickSigned(source: Readonly<Record<string, unknown>>, fields: readonly string[]): Readonly<Record<string, unknown>> {
  const signed: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      signed[field] = source[field];
    }
  }

  return Object.freeze(signed);
}
