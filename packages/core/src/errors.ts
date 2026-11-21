export type ErrorCode =
  | "bad_request"
  | "authentication_failed"
  | "permission_denied"
  | "not_found"
  | "rate_limited"
  | "gateway_unavailable"
  | "connection_failed"
  | "outcome_unknown"
  | "signature_invalid"
  | "capability_unsupported"
  | "capability_beta"
  | "idempotency_key_reused"
  | "idempotency_outcome_unknown"
  | "config_invalid"
  | "invalid_argument";

export type CapabilityErrorCode = "capability_unsupported" | "capability_beta";
export type IdempotencyErrorCode = "idempotency_key_reused" | "idempotency_outcome_unknown";

export interface BawabaErrorOptions {
  readonly gateway?: string | undefined;
  readonly cause?: unknown;
}

export interface BawabaErrorJSON {
  name: string;
  code: ErrorCode;
  gateway: string | undefined;
}

export class BawabaError extends Error {
  override readonly name: string = "BawabaError";
  readonly code: ErrorCode;
  readonly gateway: string | undefined;

  constructor(message: string, code: ErrorCode, options: BawabaErrorOptions = {}) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.code = code;
    this.gateway = options.gateway;
  }

  toJSON(): BawabaErrorJSON {
    return { name: this.name, code: this.code, gateway: this.gateway };
  }
}

export interface ApiErrorOptions extends BawabaErrorOptions {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly requestId?: string | undefined;
  readonly raw?: unknown;
}

export interface ApiErrorJSON extends BawabaErrorJSON {
  status: number;
}

export class ApiError extends BawabaError {
  override readonly name: string = "ApiError";
  readonly status: number;
  declare readonly headers: Readonly<Record<string, string>>;
  readonly requestId: string | undefined;
  declare readonly raw: unknown;

  constructor(message: string, code: ErrorCode, options: ApiErrorOptions) {
    super(message, code, options);
    this.status = options.status;
    this.requestId = options.requestId;

    // Not enumerable, so logging the error shows neither the headers nor the gateway's body.
    Object.defineProperties(this, { headers: { value: options.headers ?? {} }, raw: { value: options.raw } });
  }

  override toJSON(): ApiErrorJSON {
    return { ...super.toJSON(), status: this.status };
  }
}

export class BadRequestError extends ApiError {
  override readonly name: string = "BadRequestError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "bad_request", options);
  }
}

export class AuthenticationError extends ApiError {
  override readonly name: string = "AuthenticationError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "authentication_failed", options);
  }
}

export class PermissionError extends ApiError {
  override readonly name: string = "PermissionError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "permission_denied", options);
  }
}

export class NotFoundError extends ApiError {
  override readonly name: string = "NotFoundError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "not_found", options);
  }
}

export class RateLimitError extends ApiError {
  override readonly name: string = "RateLimitError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "rate_limited", options);
  }
}

export class GatewayServerError extends ApiError {
  override readonly name: string = "GatewayServerError";

  constructor(message: string, options: ApiErrorOptions) {
    super(message, "gateway_unavailable", options);
  }
}

export class ConnectionError extends BawabaError {
  override readonly name: string = "ConnectionError";

  constructor(message: string, options: BawabaErrorOptions = {}) {
    super(message, "connection_failed", options);
  }
}

export interface OutcomeUnknownErrorOptions extends BawabaErrorOptions {
  readonly operation: string;
  readonly merchantReference?: string | undefined;
}

export interface OutcomeUnknownErrorJSON extends BawabaErrorJSON {
  operation: string;
  merchantReference: string | undefined;
}

export class OutcomeUnknownError extends BawabaError {
  override readonly name: string = "OutcomeUnknownError";
  readonly operation: string;
  readonly merchantReference: string | undefined;

  constructor(message: string, options: OutcomeUnknownErrorOptions) {
    super(message, "outcome_unknown", options);
    this.operation = options.operation;
    this.merchantReference = options.merchantReference;
  }

  override toJSON(): OutcomeUnknownErrorJSON {
    return { ...super.toJSON(), operation: this.operation, merchantReference: this.merchantReference };
  }
}

export class SignatureVerificationError extends BawabaError {
  override readonly name: string = "SignatureVerificationError";

  constructor(message: string, options: BawabaErrorOptions = {}) {
    super(message, "signature_invalid", options);
  }
}

export class CapabilityError extends BawabaError {
  override readonly name: string = "CapabilityError";

  constructor(message: string, code: CapabilityErrorCode, options: BawabaErrorOptions = {}) {
    super(message, code, options);
  }
}

export class IdempotencyError extends BawabaError {
  override readonly name: string = "IdempotencyError";

  constructor(message: string, code: IdempotencyErrorCode, options: BawabaErrorOptions = {}) {
    super(message, code, options);
  }
}

export class ConfigError extends BawabaError {
  override readonly name: string = "ConfigError";

  constructor(message: string, options: BawabaErrorOptions = {}) {
    super(message, "config_invalid", options);
  }
}

export class InvalidArgumentError extends BawabaError {
  override readonly name: string = "InvalidArgumentError";

  constructor(message: string, options: BawabaErrorOptions = {}) {
    super(message, "invalid_argument", options);
  }
}

export function apiErrorForStatus(status: number, message: string, options: Omit<ApiErrorOptions, "status">): ApiError {
  const full = { ...options, status };
  switch (status) {
    case 401:
      return new AuthenticationError(message, full);
    case 403:
      return new PermissionError(message, full);
    case 404:
      return new NotFoundError(message, full);
    case 429:
      return new RateLimitError(message, full);
    default:
      return status >= 400 && status < 500 ? new BadRequestError(message, full) : new GatewayServerError(message, full);
  }
}
