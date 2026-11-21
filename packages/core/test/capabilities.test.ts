import { assertCapability, CapabilityError, defineCapabilities, InvalidArgumentError, isCapabilityLevel } from "@bawabajs/core";
import { describe, expect, it } from "vitest";

const capabilities = defineCapabilities({ "payments.create": "supported", "refunds.create": "beta", "payments.void": "unsupported" });

describe("defineCapabilities", () => {
  it("keeps the declared levels and freezes them", () => {
    expect(capabilities["refunds.create"]).toBe("beta");
    expect(Object.isFrozen(capabilities)).toBe(true);
  });

  it("rejects an unknown level", () => {
    expect(() => defineCapabilities({ "payments.create": "maybe" as "beta" })).toThrow(InvalidArgumentError);
  });
});

describe("isCapabilityLevel", () => {
  it.each(["supported", "beta", "unsupported"])("accepts %s", (level) => {
    expect(isCapabilityLevel(level)).toBe(true);
  });

  it.each(["Supported", "", "experimental", 1, undefined])("rejects %j", (level) => {
    expect(isCapabilityLevel(level)).toBe(false);
  });
});

describe("assertCapability", () => {
  it("allows a supported operation", () => {
    expect(() => assertCapability(capabilities, "payments.create")).not.toThrow();
    expect(() => assertCapability(capabilities, "payments.create", { allowBeta: false })).not.toThrow();
  });

  it("refuses a beta operation without allowBeta", () => {
    const error = catchError(() => assertCapability(capabilities, "refunds.create", { gateway: "fawry" }));
    expect(error).toBeInstanceOf(CapabilityError);
    expect(error).toMatchObject({ code: "capability_beta", gateway: "fawry" });
    expect((error as Error).message).toContain("allowBeta: true");
  });

  it("allows a beta operation with allowBeta: true", () => {
    expect(() => assertCapability(capabilities, "refunds.create", { allowBeta: true })).not.toThrow();
  });

  it("refuses an unsupported operation, even with allowBeta: true", () => {
    expect(catchError(() => assertCapability(capabilities, "payments.void", { allowBeta: true }))).toMatchObject({ code: "capability_unsupported" });
  });

  it("fails closed on an undeclared operation", () => {
    expect(catchError(() => assertCapability(capabilities, "payments.teleport" as "payments.void", { allowBeta: true }))).toMatchObject({
      code: "capability_unsupported",
    });
    expect(catchError(() => assertCapability(capabilities, "toString" as "payments.void"))).toMatchObject({ code: "capability_unsupported" });
  });
});

function catchError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected an error");
}
