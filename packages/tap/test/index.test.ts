import { GATEWAY, VERSION } from "@bawaba/tap";
import { GATEWAY as WEBHOOKS_GATEWAY } from "@bawaba/tap/webhooks";
import { expect, it } from "vitest";

it("exports VERSION and GATEWAY from the main entry", () => {
  expect(VERSION).toBe("0.0.0");
  expect(GATEWAY).toBe("tap");
});

it("exports the webhooks entry", () => {
  expect(WEBHOOKS_GATEWAY).toBe("tap");
});
