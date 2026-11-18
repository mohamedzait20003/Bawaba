import {
  type DigestEncoding,
  hmacSha256,
  hmacSha512,
  InvalidArgumentError,
  safeEqualBase64,
  safeEqualHex,
  sha256,
  sha512,
  timingSafeEqual,
} from "@bawabajs/core";
import { describe, expect, it } from "vitest";

const bytesOf = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const base64Of = (hex: string): string => btoa(String.fromCharCode(...bytesOf(hex)));

const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const SHA512_ABC = "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f";

describe("SHA-256 and SHA-512 (FIPS 180-4 examples, as reproduced in RFC 6234 §8.5)", () => {
  it("SHA-256 of TEST1 'abc'", async () => {
    expect(await sha256("abc")).toBe(SHA256_ABC);
  });

  it("SHA-256 of TEST2_1", async () => {
    expect(await sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("SHA-512 of TEST1 'abc'", async () => {
    expect(await sha512("abc")).toBe(SHA512_ABC);
  });

  it("SHA-512 of TEST2_2", async () => {
    const test2 = "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
    expect(await sha512(test2)).toBe(
      "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909",
    );
  });

  it("outputs base64 on request", async () => {
    expect(await sha256("abc", "base64")).toBe(base64Of(SHA256_ABC));
    expect(await sha512("abc", "base64")).toBe(base64Of(SHA512_ABC));
  });

  it("hashes raw bytes as is, including a view into a larger buffer", async () => {
    const view = new TextEncoder().encode("xabcx").subarray(1, 4);
    expect(await sha256(view)).toBe(SHA256_ABC);
    expect(await sha512(Uint8Array.of(0x61, 0x62, 0x63))).toBe(SHA512_ABC);
  });

  it("hashes the empty string and empty bytes the same way", async () => {
    expect(await sha256("")).toBe(await sha256(new Uint8Array()));
  });

  it("rejects an unknown output encoding", async () => {
    await expect(sha256("abc", "binary" as DigestEncoding)).rejects.toThrow(InvalidArgumentError);
  });
});

const rfc4231 = [
  {
    case: 1,
    key: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
    data: "4869205468657265",
    sha256: "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    sha512: "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
  },
  {
    case: 2,
    key: "4a656665",
    data: "7768617420646f2079612077616e7420666f72206e6f7468696e673f",
    sha256: "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    sha512: "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
  },
  {
    case: 3,
    key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    data: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    sha256: "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    sha512: "fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb",
  },
  {
    case: 4,
    key: "0102030405060708090a0b0c0d0e0f10111213141516171819",
    data: "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
    sha256: "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b",
    sha512: "b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd",
  },
  {
    case: 5,
    key: "0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c",
    data: "546573742057697468205472756e636174696f6e",
    sha256: "a3b6167473100ee06e0c796c2955552b",
    sha512: "415fad6271580a531d4179bc891d87a6",
  },
  {
    case: 6,
    key: "aa".repeat(131),
    data: "54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374", // bawaba-allow-secret: RFC 4231 vector
    sha256: "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    sha512: "80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598",
  },
  {
    case: 7,
    key: "aa".repeat(131),
    data: "5468697320697320612074657374207573696e672061206c6172676572207468616e20626c6f636b2d73697a65206b657920616e642061206c6172676572207468616e20626c6f636b2d73697a6520646174612e20546865206b6579206e6565647320746f20626520686173686564206265666f7265206265696e6720757365642062792074686520484d414320616c676f726974686d2e",
    sha256: "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
    sha512: "e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58",
  },
];

describe("HMAC (RFC 4231 §4 test cases 1–7)", () => {
  it.each(rfc4231)("HMAC-SHA-256 test case $case", async (vector) => {
    const mac = await hmacSha256(bytesOf(vector.key), bytesOf(vector.data));
    expect(mac.slice(0, vector.sha256.length)).toBe(vector.sha256);
  });

  it.each(rfc4231)("HMAC-SHA-512 test case $case", async (vector) => {
    const mac = await hmacSha512(bytesOf(vector.key), bytesOf(vector.data));
    expect(mac.slice(0, vector.sha512.length)).toBe(vector.sha512);
  });

  it("accepts a string key and string data (test case 2: 'Jefe')", async () => {
    expect(await hmacSha256("Jefe", "what do ya want for nothing?")).toBe(rfc4231[1]?.sha256);
  });

  it("outputs base64 on request (test case 2)", async () => {
    expect(await hmacSha256("Jefe", "what do ya want for nothing?", "base64")).toBe(base64Of(rfc4231[1]?.sha256 ?? ""));
    expect(await hmacSha512("Jefe", "what do ya want for nothing?", "base64")).toBe(base64Of(rfc4231[1]?.sha512 ?? ""));
  });

  it("rejects an empty key", async () => {
    await expect(hmacSha256("", "data")).rejects.toThrow(InvalidArgumentError);
    await expect(hmacSha512(new Uint8Array(), "data")).rejects.toThrow(InvalidArgumentError);
  });
});

describe("timingSafeEqual", () => {
  it("is true for equal bytes", () => {
    expect(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(timingSafeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("is false when any byte differs", () => {
    expect(timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(timingSafeEqual(Uint8Array.of(0, 2, 3), Uint8Array.of(1, 2, 3))).toBe(false);
  });

  it("is false when the lengths differ", () => {
    expect(timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
  });
});

describe("safeEqualHex", () => {
  it("compares by decoded bytes, so case does not matter", () => {
    expect(safeEqualHex(SHA256_ABC, SHA256_ABC.toUpperCase())).toBe(true);
  });

  it("is false for a different or truncated value", () => {
    expect(safeEqualHex(SHA256_ABC, SHA512_ABC)).toBe(false);
    expect(safeEqualHex(SHA256_ABC, SHA256_ABC.slice(0, -2))).toBe(false);
  });

  it.each([
    ["odd length", "abc"],
    ["not hex", "zz"],
    ["empty", ""],
    ["a number", 1234],
    ["undefined", undefined],
    ["null", null],
  ])("is false, without throwing, for malformed input (%s)", (_label, value) => {
    expect(safeEqualHex(SHA256_ABC, value)).toBe(false);
    expect(safeEqualHex(value, SHA256_ABC)).toBe(false);
  });
});

describe("safeEqualBase64", () => {
  it("is true for the same value", () => {
    expect(safeEqualBase64(base64Of(SHA256_ABC), base64Of(SHA256_ABC))).toBe(true);
  });

  it("is false for a different value", () => {
    expect(safeEqualBase64(base64Of(SHA256_ABC), base64Of(SHA512_ABC))).toBe(false);
  });

  it.each([
    ["bad length", "Zg"],
    ["bad character", "Zm9v!A=="],
    ["empty", ""],
    ["a number", 42],
    ["undefined", undefined],
  ])("is false, without throwing, for malformed input (%s)", (_label, value) => {
    expect(safeEqualBase64(base64Of(SHA256_ABC), value)).toBe(false);
    expect(safeEqualBase64(value, base64Of(SHA256_ABC))).toBe(false);
  });
});
