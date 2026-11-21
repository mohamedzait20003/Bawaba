import { sha256 } from "./crypto.js";
import { ApiError, CapabilityError, ConfigError, IdempotencyError, InvalidArgumentError } from "./errors.js";

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
export const COMPLETED_RECORD_TTL_MS = 86_400_000;

const SWEEP_INTERVAL_MS = 60_000;

export interface IdempotencyRecord {
  readonly state: "held" | "completed";
  readonly fingerprint: string;
  readonly result?: unknown;
}

export type ClaimResult =
  | { readonly state: "claimed" }
  | { readonly state: "completed"; readonly fingerprint: string; readonly result: unknown }
  | { readonly state: "held"; readonly fingerprint: string };

export interface IdempotencyStore {
  claim(key: string, fingerprint: string): Promise<ClaimResult>;
  get(key: string): Promise<IdempotencyRecord | undefined>;
  complete(key: string, result: unknown): Promise<void>;
  release(key: string): Promise<void>;
}

export interface MemoryIdempotencyStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

interface Entry {
  readonly state: "held" | "completed";
  readonly fingerprint: string;
  readonly result?: unknown;
  readonly expiresAt?: number;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  #nextSweep = 0;

  constructor(options: MemoryIdempotencyStoreOptions = {}) {
    const ttlMs = options.ttlMs ?? COMPLETED_RECORD_TTL_MS;

    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new InvalidArgumentError("The TTL must be a positive whole number of milliseconds");
    }

    this.#ttlMs = ttlMs;
    this.#now = options.now ?? Date.now;
  }

  claim(key: string, fingerprint: string): Promise<ClaimResult> {
    const entry = this.#live(key);

    if (entry === undefined) {
      this.#entries.set(key, { state: "held", fingerprint });

      return Promise.resolve({ state: "claimed" });
    }

    return Promise.resolve(
      entry.state === "completed"
        ? { state: "completed", fingerprint: entry.fingerprint, result: entry.result }
        : { state: "held", fingerprint: entry.fingerprint },
    );
  }

  get(key: string): Promise<IdempotencyRecord | undefined> {
    const entry = this.#live(key);

    if (entry === undefined) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(
      entry.state === "completed"
        ? { state: "completed", fingerprint: entry.fingerprint, result: entry.result }
        : { state: "held", fingerprint: entry.fingerprint },
    );
  }

  complete(key: string, result: unknown): Promise<void> {
    const entry = this.#live(key);

    if (entry === undefined) {
      return Promise.reject(new InvalidArgumentError("Only a claimed key can be completed"));
    }

    this.#entries.set(key, { state: "completed", fingerprint: entry.fingerprint, result, expiresAt: this.#now() + this.#ttlMs });

    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    this.#entries.delete(key);

    return Promise.resolve();
  }

  #live(key: string): Entry | undefined {
    const now = this.#now();

    this.#sweep(now);

    const entry = this.#entries.get(key);

    if (entry?.expiresAt !== undefined && entry.expiresAt <= now) {
      this.#entries.delete(key);

      return undefined;
    }

    return entry;
  }

  #sweep(now: number): void {
    if (now < this.#nextSweep) {
      return;
    }

    this.#nextSweep = now + SWEEP_INTERVAL_MS;

    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
  }
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

// Locale-independent, so a fingerprint never depends on where the code runs.
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : Number(a > b);
}

function hasToJSON(value: object): value is { toJSON(): unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === "function";
}

function stringifyObject(value: object, ancestors: Set<object>, applyToJSON: boolean): string {
  // As in JSON.stringify, toJSON is applied once per position, never to its own result.
  if (applyToJSON && hasToJSON(value)) {
    return stringifyValue(value.toJSON(), ancestors, false);
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new InvalidArgumentError("Idempotent parameters must be plain JSON data");
  }

  if (ancestors.has(value)) {
    throw new InvalidArgumentError("Idempotent parameters must not contain a cycle");
  }

  ancestors.add(value);

  const text = Array.isArray(value)
    ? `[${value.map((item: unknown) => (item === undefined ? "null" : stringifyValue(item, ancestors))).join(",")}]`
    : `{${Object.keys(value)
        .sort(compareCodeUnits)
        .flatMap((key) => {
          const item: unknown = (value as Record<string, unknown>)[key];

          return item === undefined ? [] : [`${JSON.stringify(key)}:${stringifyValue(item, ancestors)}`];
        })
        .join(",")}}`;

  ancestors.delete(value);

  return text;
}

function stringifyValue(value: unknown, ancestors: Set<object>, applyToJSON = true): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidArgumentError("Idempotent parameters must not contain NaN or Infinity");
    }

    return JSON.stringify(value);
  }

  if (typeof value === "object") {
    return stringifyObject(value, ancestors, applyToJSON);
  }

  throw new InvalidArgumentError(`Idempotent parameters must not contain a ${typeof value}`);
}

export function stableStringify(value: unknown): string {
  return stringifyValue(value, new Set());
}

export function fingerprint(value: unknown): Promise<string> {
  return sha256(stableStringify(value));
}

export interface IdempotentCall {
  readonly store: IdempotencyStore;
  readonly key: string | undefined;
  readonly gateway: string;
  readonly operation: string;
  readonly params: unknown;
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new InvalidArgumentError(`The idempotency key must be a string of 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
}

function isDefiniteFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 400 && error.status < 500;
  }

  return error instanceof InvalidArgumentError || error instanceof ConfigError || error instanceof CapabilityError;
}

function replay(call: IdempotentCall, claim: Exclude<ClaimResult, { state: "claimed" }>, expected: string): unknown {
  const options = { gateway: call.gateway };

  if (claim.fingerprint !== expected) {
    throw new IdempotencyError(`The idempotency key was already used for ${call.operation} with other parameters`, "idempotency_key_reused", options);
  }

  if (claim.state === "held") {
    throw new IdempotencyError(
      `The earlier ${call.operation} with this idempotency key is in flight or its outcome is unknown. Reconcile, then release the key.`,
      "idempotency_outcome_unknown",
      options,
    );
  }

  return claim.result;
}

export async function runIdempotent<T>(call: IdempotentCall, send: () => Promise<T>): Promise<T> {
  if (call.key === undefined) {
    return send();
  }

  const key = call.key;

  assertKey(key);

  const expected = await fingerprint({ gateway: call.gateway, operation: call.operation, params: call.params });
  const claim = await call.store.claim(key, expected);

  if (claim.state !== "claimed") {
    return replay(call, claim, expected) as T;
  }

  let result: T;

  try {
    result = await send();
  } catch (error) {
    if (isDefiniteFailure(error)) {
      await call.store.release(key).catch(() => undefined);
    }

    throw error;
  }

  // If the store fails here, the payment still succeeded: return it. The key stays held, which is the safe side.
  await call.store.complete(key, result).catch(() => undefined);

  return result;
}
