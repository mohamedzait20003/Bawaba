import { fromBase64, fromHex, InvalidArgumentError, toBase64, toHex, utf8Decode, utf8Encode } from "@bawabajs/core";
import { describe, expect, it } from "vitest";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("base64 (RFC 4648 §10 test vectors)", () => {
  it.each([
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ])("BASE64(%j) = %j", (input, encoded) => {
    expect(toBase64(ascii(input))).toBe(encoded);
    expect(fromBase64(encoded)).toEqual(ascii(input));
  });

  it("uses the standard alphabet, including + and /", () => {
    expect(toBase64(Uint8Array.of(0xfb, 0xff))).toBe("+/8=");
    expect(fromBase64("+/8=")).toEqual(Uint8Array.of(0xfb, 0xff));
  });

  it.each(["Zg", "Zg=", "Zm9vY", "Zg=a", "Z===", "=Zg=", "Zm9v\n", "Zm9 ", "Zm-_", "Zm9vYé=="])("rejects the malformed input %j", (input) => {
    expect(() => fromBase64(input)).toThrow(InvalidArgumentError);
  });
});

describe("hex (RFC 4648 §10 BASE16 test vectors, lowercase output)", () => {
  it.each([
    ["", ""],
    ["f", "66"],
    ["fo", "666F"],
    ["foo", "666F6F"],
    ["foob", "666F6F62"],
    ["fooba", "666F6F6261"],
    ["foobar", "666F6F626172"],
  ])("BASE16(%j) = %j", (input, encoded) => {
    expect(toHex(ascii(input))).toBe(encoded.toLowerCase());
    expect(fromHex(encoded)).toEqual(ascii(input));
    expect(fromHex(encoded.toLowerCase())).toEqual(ascii(input));
  });

  it("encodes and decodes all 256 byte values", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const hex = toHex(bytes);
    expect(hex).toBe(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    expect(fromHex(hex)).toEqual(bytes);
    expect(fromHex(hex.toUpperCase())).toEqual(bytes);
  });

  it.each(["0", "abc", "zz", "0g", "g0", "0x00", " 00", "00 "])("rejects the malformed input %j", (input) => {
    expect(() => fromHex(input)).toThrow(InvalidArgumentError);
  });
});

describe("UTF-8", () => {
  it("encodes Arabic text to its RFC 3629 bytes", () => {
    expect(toHex(utf8Encode("بوابة"))).toBe("d8a8d988d8a7d8a8d8a9");
  });

  it("round-trips Arabic and ASCII text", () => {
    const text = "Bawaba بوابة 2026";
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it("encodes the empty string to no bytes", () => {
    expect(utf8Encode("")).toEqual(new Uint8Array());
  });
});
