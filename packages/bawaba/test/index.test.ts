import { VERSION } from "bawaba";
import { GATEWAY as fawry } from "bawaba/fawry";
import { GATEWAY as geidea } from "bawaba/geidea";
import { GATEWAY as kashier } from "bawaba/kashier";
import { GATEWAY as payfort } from "bawaba/payfort";
import { GATEWAY as paymob } from "bawaba/paymob";
import { GATEWAY as paytabs } from "bawaba/paytabs";
import { GATEWAY as tap } from "bawaba/tap";
import { expect, it } from "vitest";

it("exports VERSION", () => {
  expect(VERSION).toBe("0.0.0");
});

it("exposes one subpath per gateway, backed by its client package", () => {
  expect([paymob, kashier, fawry, geidea, paytabs, payfort, tap]).toEqual([
    "paymob",
    "kashier",
    "fawry",
    "geidea",
    "paytabs",
    "payfort",
    "tap",
  ]);
});
