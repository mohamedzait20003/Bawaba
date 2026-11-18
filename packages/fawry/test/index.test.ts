import { GATEWAY, VERSION } from "@bawabajs/fawry";
import { GATEWAY as WEBHOOKS_GATEWAY } from "@bawabajs/fawry/webhooks";
import { expect, it } from "vitest";

it("exports VERSION and GATEWAY from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
  expect(GATEWAY).toBe("fawry");
});

it("exports the webhooks entry", () => {
  expect(WEBHOOKS_GATEWAY).toBe("fawry");
});
