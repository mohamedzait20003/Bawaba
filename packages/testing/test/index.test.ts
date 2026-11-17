import { VERSION } from "@bawaba/testing";
import { expect, it } from "vitest";

it("exports VERSION", () => {
  expect(VERSION).toBe("0.0.0");
});
