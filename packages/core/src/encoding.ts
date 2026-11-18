import { InvalidArgumentError } from "./errors.js";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(Array.from(BASE64_ALPHABET, (char, index) => [char, index]));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toHex(bytes: Uint8Array): string {
  let out = "";

  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }

  return out;
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  return -1;
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new InvalidArgumentError("Hex input must have an even length");
  }

  const out = new Uint8Array(hex.length / 2);

  for (let index = 0; index < out.length; index++) {
    const high = hexDigit(hex.codePointAt(index * 2) as number);
    const low = hexDigit(hex.codePointAt(index * 2 + 1) as number);

    if (high < 0 || low < 0) {
      throw new InvalidArgumentError("Hex input contains a character that is not a hex digit");
    }

    out[index] = high * 16 + low;
  }

  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const triple = ((bytes[index] as number) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);

    out += BASE64_ALPHABET.charAt((triple >> 18) & 63) + BASE64_ALPHABET.charAt((triple >> 12) & 63);
    out += remaining > 1 ? BASE64_ALPHABET.charAt((triple >> 6) & 63) : "=";
    out += remaining > 2 ? BASE64_ALPHABET.charAt(triple & 63) : "=";
  }

  return out;
}

function base64Padding(text: string): number {
  if (text.endsWith("==")) {
    return 2;
  }

  return text.endsWith("=") ? 1 : 0;
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 4 !== 0) {
    throw new InvalidArgumentError("Base64 input must be padded to a multiple of 4 characters");
  }

  const padding = base64Padding(text);
  const out = new Uint8Array((text.length / 4) * 3 - padding);

  let buffer = 0;
  let bits = 0;
  let index = 0;

  for (const char of text.slice(0, text.length - padding)) {
    const value = BASE64_VALUES.get(char);

    if (value === undefined) {
      throw new InvalidArgumentError("Base64 input contains a character outside the standard alphabet");
    }

    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }

  return out;
}
