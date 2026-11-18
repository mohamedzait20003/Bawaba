import { GATEWAY, VERSION } from "@bawabajs/paymob";
import { GATEWAY as WEBHOOKS_GATEWAY } from "@bawabajs/paymob/webhooks";
import { expect, it } from "vitest";

it("exports VERSION and GATEWAY from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
  expect(GATEWAY).toBe("paymob");
});

it("exports the webhooks entry", () => {
  expect(WEBHOOKS_GATEWAY).toBe("paymob");
});
