import {
  assertMoney,
  CURRENCIES,
  CURRENCY_EXPONENTS,
  type Currency,
  currencyExponent,
  fromDecimalString,
  InvalidArgumentError,
  isCurrency,
  isMoney,
  type Money,
  toDecimalString,
} from "@bawabajs/core";
import { describe, expect, it } from "vitest";

const twoDecimals: Currency[] = ["EGP", "SAR", "AED", "QAR", "MAD", "USD", "EUR", "GBP"];
const threeDecimals: Currency[] = ["KWD", "BHD", "OMR", "JOD", "IQD"];

describe("currencies (TECHNICAL_SPECIFICATIONS §3.5)", () => {
  it("lists exactly the specified currencies", () => {
    expect([...CURRENCIES].sort()).toEqual([...twoDecimals, ...threeDecimals].sort());
  });

  it.each(twoDecimals)("%s has 2 decimals", (currency) => {
    expect(CURRENCY_EXPONENTS[currency]).toBe(2);
    expect(currencyExponent(currency)).toBe(2);
  });

  it.each(threeDecimals)("%s has 3 decimals", (currency) => {
    expect(currencyExponent(currency)).toBe(3);
  });

  it("recognizes currencies, case-sensitively", () => {
    expect(isCurrency("EGP")).toBe(true);
    expect(isCurrency("egp")).toBe(false);
    expect(isCurrency("XYZ")).toBe(false);
    expect(isCurrency("toString")).toBe(false);
    expect(isCurrency(1)).toBe(false);
  });

  it("rejects an unknown currency when asked for its exponent", () => {
    expect(() => currencyExponent("XYZ" as Currency)).toThrow(InvalidArgumentError);
  });
});

describe("isMoney and assertMoney", () => {
  it.each([
    { minor: 0, currency: "EGP" },
    { minor: 150_000, currency: "EGP" },
    { minor: Number.MAX_SAFE_INTEGER, currency: "KWD" },
  ])("accepts %j", (value) => {
    expect(isMoney(value)).toBe(true);
    expect(() => assertMoney(value)).not.toThrow();
  });

  it.each([
    null,
    "1.00 EGP",
    { minor: -1, currency: "EGP" },
    { minor: 1.5, currency: "EGP" },
    { minor: Number.MAX_SAFE_INTEGER + 1, currency: "EGP" },
    { minor: Number.NaN, currency: "EGP" },
    { minor: "100", currency: "EGP" },
    { minor: 100, currency: "XYZ" },
    { minor: 100 },
  ])("rejects %j", (value) => {
    expect(isMoney(value)).toBe(false);
    expect(() => assertMoney(value)).toThrow(InvalidArgumentError);
  });
});

describe("toDecimalString", () => {
  it.each<[Money, string]>([
    [{ minor: 25_000, currency: "EGP" }, "250.00"],
    [{ minor: 150_000, currency: "EGP" }, "1500.00"],
    [{ minor: 1999, currency: "AED" }, "19.99"],
    [{ minor: 5, currency: "SAR" }, "0.05"],
    [{ minor: 0, currency: "USD" }, "0.00"],
    [{ minor: 1_500, currency: "KWD" }, "1.500"],
    [{ minor: 1, currency: "BHD" }, "0.001"],
    [{ minor: 1_000, currency: "OMR" }, "1.000"],
  ])("formats %j as %s, keeping trailing zeros", (money, text) => {
    expect(toDecimalString(money)).toBe(text);
  });

  it("formats with an exponent override", () => {
    expect(toDecimalString({ minor: 1_500, currency: "IQD" }, 0)).toBe("1500");
    expect(toDecimalString({ minor: 1_500, currency: "IQD" }, 2)).toBe("15.00");
  });

  it("formats the largest safe amount exactly", () => {
    expect(toDecimalString({ minor: Number.MAX_SAFE_INTEGER, currency: "EGP" })).toBe("90071992547409.91");
  });

  it.each([-1, 1.5, 5, Number.NaN])("rejects the exponent override %s", (exponent) => {
    expect(() => toDecimalString({ minor: 1, currency: "EGP" }, exponent)).toThrow(InvalidArgumentError);
  });

  it("rejects invalid money", () => {
    expect(() => toDecimalString({ minor: 1.5, currency: "EGP" })).toThrow(InvalidArgumentError);
    expect(() => toDecimalString({ minor: -100, currency: "EGP" })).toThrow(InvalidArgumentError);
  });
});

describe("fromDecimalString", () => {
  it.each<[string, Currency, number]>([
    ["250.00", "EGP", 25_000],
    ["250", "EGP", 25_000],
    ["250.5", "EGP", 25_050],
    ["0.05", "SAR", 5],
    ["0", "USD", 0],
    ["007.50", "EGP", 750],
    ["1.500", "KWD", 1_500],
    ["1.5", "KWD", 1_500],
    ["0.001", "BHD", 1],
  ])("parses %s %s as %i minor units", (text, currency, minor) => {
    expect(fromDecimalString(text, currency)).toEqual({ minor, currency });
  });

  it("parses with an exponent override", () => {
    expect(fromDecimalString("1500", "IQD", 0)).toEqual({ minor: 1_500, currency: "IQD" });
  });

  it("round-trips the largest safe amount", () => {
    const money: Money = { minor: Number.MAX_SAFE_INTEGER, currency: "EGP" };
    expect(fromDecimalString(toDecimalString(money), "EGP")).toEqual(money);
  });

  it.each(["1.005", "1.000", "0.001"])("rejects %s for EGP: excess precision is never rounded", (text) => {
    expect(() => fromDecimalString(text, "EGP")).toThrow(InvalidArgumentError);
  });

  it("rejects excess precision for KWD", () => {
    expect(() => fromDecimalString("1.0005", "KWD")).toThrow(InvalidArgumentError);
  });

  it("rejects any decimals with a zero exponent", () => {
    expect(() => fromDecimalString("1.5", "IQD", 0)).toThrow(InvalidArgumentError);
  });

  it.each(["", "1e3", "+1", "-1", "1.", ".5", " 1", "1 ", "1,000.00", "1.2.3", "0x10", "١٠", "Infinity", "NaN"])("rejects the text %j", (text) => {
    expect(() => fromDecimalString(text, "EGP")).toThrow(InvalidArgumentError);
  });

  it("rejects a number instead of a string", () => {
    expect(() => fromDecimalString(1.5 as unknown as string, "EGP")).toThrow(InvalidArgumentError);
  });

  it("rejects an amount above the safe-integer range", () => {
    expect(() => fromDecimalString("90071992547409.92", "EGP")).toThrow(InvalidArgumentError);
  });

  it("rejects an unknown currency", () => {
    expect(() => fromDecimalString("1.00", "XYZ" as Currency)).toThrow(InvalidArgumentError);
  });
});
