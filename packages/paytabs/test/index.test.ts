import { GATEWAY, VERSION } from "@bawaba/paytabs";
import { GATEWAY as WEBHOOKS_GATEWAY } from "@bawaba/paytabs/webhooks";
import { expect, it } from "vitest";

it("exports VERSION and GATEWAY from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
  expect(GATEWAY).toBe("paytabs");
});

it("exports the webhooks entry", () => {
  expect(WEBHOOKS_GATEWAY).toBe("paytabs");
});
