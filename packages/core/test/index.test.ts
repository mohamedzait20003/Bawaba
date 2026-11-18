import { VERSION } from "@bawabajs/core";
import { VERSION as CONFORMANCE_VERSION } from "@bawabajs/core/conformance";
import { expect, it } from "vitest";

it("exports VERSION from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
});

it("exports the conformance entry", () => {
  expect(CONFORMANCE_VERSION).toBe(VERSION);
});
