import { VERSION } from "@bawaba/core";
import { VERSION as CONFORMANCE_VERSION } from "@bawaba/core/conformance";
import { expect, it } from "vitest";

it("exports VERSION from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
});

it("exports the conformance entry", () => {
  expect(CONFORMANCE_VERSION).toBe(VERSION);
});
