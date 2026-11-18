import {
  ApiError,
  AuthenticationError,
  apiErrorForStatus,
  BadRequestError,
  BawabaError,
  CapabilityError,
  ConfigError,
  ConnectionError,
  GatewayServerError,
  IdempotencyError,
  InvalidArgumentError,
  NotFoundError,
  OutcomeUnknownError,
  PermissionError,
  RateLimitError,
  SignatureVerificationError,
} from "@bawabajs/core";
import { describe, expect, it } from "vitest";

const apiOptions = { gateway: "paymob", status: 400, headers: { "x-request-id": "req_1" }, requestId: "req_1", raw: { detail: "bad" } };

const cases: [BawabaError, string, string][] = [
  [new BadRequestError("m", apiOptions), "BadRequestError", "bad_request"],
  [new AuthenticationError("m", { ...apiOptions, status: 401 }), "AuthenticationError", "authentication_failed"],
  [new PermissionError("m", { ...apiOptions, status: 403 }), "PermissionError", "permission_denied"],
  [new NotFoundError("m", { ...apiOptions, status: 404 }), "NotFoundError", "not_found"],
  [new RateLimitError("m", { ...apiOptions, status: 429 }), "RateLimitError", "rate_limited"],
  [new GatewayServerError("m", { ...apiOptions, status: 503 }), "GatewayServerError", "gateway_unavailable"],
  [new ConnectionError("m", { gateway: "kashier" }), "ConnectionError", "connection_failed"],
  [new OutcomeUnknownError("m", { gateway: "fawry", operation: "refunds.create" }), "OutcomeUnknownError", "outcome_unknown"],
  [new SignatureVerificationError("m", { gateway: "tap" }), "SignatureVerificationError", "signature_invalid"],
  [new CapabilityError("m", "capability_unsupported", { gateway: "tap" }), "CapabilityError", "capability_unsupported"],
  [new CapabilityError("m", "capability_beta"), "CapabilityError", "capability_beta"],
  [new IdempotencyError("m", "idempotency_key_reused"), "IdempotencyError", "idempotency_key_reused"],
  [new IdempotencyError("m", "idempotency_outcome_unknown"), "IdempotencyError", "idempotency_outcome_unknown"],
  [new ConfigError("m"), "ConfigError", "config_invalid"],
  [new InvalidArgumentError("m"), "InvalidArgumentError", "invalid_argument"],
];

describe("error classes (PRODUCT_SPECIFICATIONS §4)", () => {
  it.each(cases)("%s has its name and stable code", (error, name, code) => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BawabaError);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toBe("m");
    expect(error.stack).toContain(name);
  });

  it.each(cases)("%s keeps its code through JSON serialization", (error, name, code) => {
    const parsed = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;
    expect(parsed.code).toBe(code);
    expect(parsed.name).toBe(name);
  });

  it.each(cases)("%s has no retryable property", (error) => {
    expect("retryable" in error).toBe(false);
    expect(Object.keys(error.toJSON())).not.toContain("retryable");
  });

  it("puts the HTTP errors under ApiError, and nothing else", () => {
    const http = cases.filter(([error]) => error instanceof ApiError).map(([, name]) => name);
    expect(http).toEqual(["BadRequestError", "AuthenticationError", "PermissionError", "NotFoundError", "RateLimitError", "GatewayServerError"]);
  });

  it("carries the gateway", () => {
    expect(new ConnectionError("m", { gateway: "kashier" }).gateway).toBe("kashier");
    expect(new ConfigError("m").gateway).toBeUndefined();
  });
});

describe("cause", () => {
  it("keeps the cause when one is given", () => {
    const cause = new TypeError("fetch failed");
    expect(new ConnectionError("m", { cause }).cause).toBe(cause);
  });

  it("keeps an explicitly undefined cause as given", () => {
    expect("cause" in new ConnectionError("m", { cause: undefined })).toBe(true);
  });

  it("has no cause when none is given", () => {
    expect("cause" in new ConnectionError("m")).toBe(false);
  });
});

describe("ApiError", () => {
  it("keeps status, headers, request ID and the raw body", () => {
    const error = new BadRequestError("m", apiOptions);
    expect(error.status).toBe(400);
    expect(error.headers).toEqual({ "x-request-id": "req_1" });
    expect(error.requestId).toBe("req_1");
    expect(error.raw).toEqual({ detail: "bad" });
    expect(error.gateway).toBe("paymob");
  });

  it("defaults headers to an empty object", () => {
    const error = new ApiError("m", "bad_request", { status: 400 });
    expect(error.headers).toEqual({});
    expect(error.requestId).toBeUndefined();
    expect(error.raw).toBeUndefined();
  });

  it("serializes name, code, gateway and status, but never headers or the raw body", () => {
    expect(new BadRequestError("m", apiOptions).toJSON()).toEqual({ name: "BadRequestError", code: "bad_request", gateway: "paymob", status: 400 });
  });
});

describe("OutcomeUnknownError", () => {
  it("carries the operation and merchant reference for reconciliation", () => {
    const error = new OutcomeUnknownError("m", { gateway: "fawry", operation: "refunds.create", merchantReference: "order_1" });
    expect(error.operation).toBe("refunds.create");
    expect(error.merchantReference).toBe("order_1");
    expect(error.toJSON()).toEqual({
      name: "OutcomeUnknownError",
      code: "outcome_unknown",
      gateway: "fawry",
      operation: "refunds.create",
      merchantReference: "order_1",
    });
  });

  it("allows a missing merchant reference", () => {
    expect(new OutcomeUnknownError("m", { operation: "charges.create" }).merchantReference).toBeUndefined();
  });
});

describe("apiErrorForStatus", () => {
  it.each([
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, PermissionError],
    [404, NotFoundError],
    [409, BadRequestError],
    [422, BadRequestError],
    [429, RateLimitError],
    [500, GatewayServerError],
    [503, GatewayServerError],
    [302, GatewayServerError],
  ])("maps HTTP %i to the matching class", (status, type) => {
    const error = apiErrorForStatus(status, "m", { gateway: "geidea", requestId: "r", raw: "body" });
    expect(error).toBeInstanceOf(type);
    expect(error.status).toBe(status);
    expect(error.gateway).toBe("geidea");
    expect(error.requestId).toBe("r");
    expect(error.raw).toBe("body");
  });
});
