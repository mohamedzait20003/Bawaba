import { ConnectionError, OutcomeUnknownError } from "../errors.js";
import { type AttemptResult, prepareRequest, sendOnce } from "./request.js";
import type { HttpClientConfig, HttpResponse, RequestSpec, RetryDependencies } from "./types.js";

export const MAX_READ_RETRIES = 2;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 5_000;
export const RETRY_AFTER_CAP_MS = 5_000;

const DELAY_SECONDS = /^\d+$/;

type Failure = Exclude<AttemptResult, { type: "response" }>;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const defaultDependencies: RetryDependencies = {
  sleep,
  random: Math.random, // NOSONAR: retry jitter, not a security use
  now: Date.now,
};

function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const text = value.trim();

  if (DELAY_SECONDS.test(text)) {
    return Number(text) * 1000;
  }

  const date = Date.parse(text);

  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function retryDelayMs(failure: Failure, attempt: number, dependencies: RetryDependencies): number {
  const retryAfter = failure.type === "http_error" ? parseRetryAfter(failure.error.headers["retry-after"], dependencies.now()) : undefined;

  if (retryAfter !== undefined) {
    return Math.min(retryAfter, RETRY_AFTER_CAP_MS);
  }

  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));

  return Math.floor(dependencies.random() * ceiling);
}

function isRetryableRead(failure: Failure): boolean {
  return failure.type === "transport_error" || failure.error.status === 429 || failure.error.status >= 500;
}

function describeFailure(failure: Failure): string {
  if (failure.type === "http_error") {
    return `HTTP ${failure.error.status}`;
  }

  const reasons = { timeout: "the request timed out", network: "a network error", aborted: "the caller aborted after sending" };

  return reasons[failure.failure];
}

function mutationFailure(config: HttpClientConfig, spec: RequestSpec, failure: Failure): Error {
  if (failure.type === "http_error" && failure.error.status >= 400 && failure.error.status < 500) {
    return failure.error;
  }

  const message = `${spec.operation} on ${config.gateway}: the outcome is unknown (${describeFailure(failure)}). It may have succeeded. Do not retry; reconcile first.`;

  return new OutcomeUnknownError(message, {
    gateway: config.gateway,
    operation: spec.operation,
    merchantReference: spec.merchantReference,
    cause: failure.type === "http_error" ? failure.error : failure.cause,
  });
}

function readFailure(config: HttpClientConfig, spec: RequestSpec, failure: Failure): Error {
  if (failure.type === "http_error") {
    return failure.error;
  }

  return new ConnectionError(`${spec.operation} on ${config.gateway} failed: ${describeFailure(failure)}`, { gateway: config.gateway, cause: failure.cause });
}

export async function request(config: HttpClientConfig, spec: RequestSpec): Promise<HttpResponse> {
  const prepared = prepareRequest(config, spec);
  const dependencies: RetryDependencies = { ...defaultDependencies, ...config.retry };

  spec.signal?.throwIfAborted();

  async function attemptRequest(attempt: number): Promise<HttpResponse> {
    const result = await sendOnce(config, spec, prepared, attempt);

    if (result.type === "response") {
      return result.response;
    }

    if (spec.kind === "mutation") {
      throw mutationFailure(config, spec, result);
    }

    if (result.type === "transport_error" && result.failure === "aborted") {
      throw result.cause;
    }

    if (attempt > MAX_READ_RETRIES || !isRetryableRead(result)) {
      throw readFailure(config, spec, result);
    }

    await dependencies.sleep(retryDelayMs(result, attempt, dependencies), spec.signal);
    return attemptRequest(attempt + 1);
  }

  return attemptRequest(1);
}
