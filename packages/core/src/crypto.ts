import { fromBase64, fromHex, toBase64, toHex, utf8Encode } from "./encoding.js";
import { InvalidArgumentError } from "./errors.js";

export type DigestEncoding = "hex" | "base64";

type HashName = "SHA-256" | "SHA-512";

function toBytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof data === "string" ? utf8Encode(data) : new Uint8Array(data);
}

function encodeDigest(digest: ArrayBuffer, encoding: DigestEncoding): string {
  const bytes = new Uint8Array(digest);

  if (encoding === "hex") {
    return toHex(bytes);
  }

  if (encoding === "base64") {
    return toBase64(bytes);
  }

  throw new InvalidArgumentError('The digest encoding must be "hex" or "base64"');
}

async function digest(hash: HashName, data: string | Uint8Array, encoding: DigestEncoding): Promise<string> {
  return encodeDigest(await globalThis.crypto.subtle.digest(hash, toBytes(data)), encoding);
}

async function hmac(hash: HashName, key: string | Uint8Array, data: string | Uint8Array, encoding: DigestEncoding): Promise<string> {
  const keyBytes = toBytes(key);

  if (keyBytes.length === 0) {
    throw new InvalidArgumentError("The HMAC key must not be empty");
  }

  const cryptoKey = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash }, false, ["sign"]);

  return encodeDigest(await globalThis.crypto.subtle.sign("HMAC", cryptoKey, toBytes(data)), encoding);
}

export function sha256(data: string | Uint8Array, encoding: DigestEncoding = "hex"): Promise<string> {
  return digest("SHA-256", data, encoding);
}

export function sha512(data: string | Uint8Array, encoding: DigestEncoding = "hex"): Promise<string> {
  return digest("SHA-512", data, encoding);
}

export function hmacSha256(key: string | Uint8Array, data: string | Uint8Array, encoding: DigestEncoding = "hex"): Promise<string> {
  return hmac("SHA-256", key, data, encoding);
}

export function hmacSha512(key: string | Uint8Array, data: string | Uint8Array, encoding: DigestEncoding = "hex"): Promise<string> {
  return hmac("SHA-512", key, data, encoding);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < a.length; index++) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }

  return difference === 0;
}

function safeEqualEncoded(a: unknown, b: unknown, decode: (text: string) => Uint8Array): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) {
    return false;
  }

  try {
    return timingSafeEqual(decode(a), decode(b));
  } catch {
    return false;
  }
}

export function safeEqualHex(a: unknown, b: unknown): boolean {
  return safeEqualEncoded(a, b, fromHex);
}

export function safeEqualBase64(a: unknown, b: unknown): boolean {
  return safeEqualEncoded(a, b, fromBase64);
}
