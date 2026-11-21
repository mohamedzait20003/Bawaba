import type { Redactor } from "../redaction.js";

export type OperationKind = "read" | "mutation";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | undefined;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type TransportFailure = "timeout" | "network" | "aborted";

export interface RequestEvent {
  readonly gateway: string;
  readonly operation: string;
  readonly kind: OperationKind;
  readonly method: HttpMethod;
  readonly url: string;
  readonly attempt: number;
}

export interface ResponseEvent extends RequestEvent {
  readonly status: number | undefined;
  readonly failure: TransportFailure | undefined;
  readonly durationMs: number;
}

export interface RetryDependencies {
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random: () => number;
  readonly now: () => number;
}

export interface HttpClientConfig {
  readonly gateway: string;
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestIdHeaders?: readonly string[];
  readonly onRequest?: (event: RequestEvent) => void;
  readonly onResponse?: (event: ResponseEvent) => void;
  readonly retry?: Partial<RetryDependencies>;
  readonly redactor?: Redactor;
}

export interface RequestSpec {
  readonly method: HttpMethod;
  readonly path: string;
  readonly kind: OperationKind;
  readonly operation: string;
  readonly merchantReference?: string;
  readonly pathParams?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly json?: unknown;
  readonly form?: Readonly<Record<string, QueryValue>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestId: string | undefined;
  readonly data: unknown;
}
