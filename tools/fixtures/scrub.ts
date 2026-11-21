// Byte-preserving scrubber for captured callbacks (fixtures/README.md, "Scrubbing rules").
// It replaces values in place and never re-serializes: JSON.parse + JSON.stringify would turn 250.00 into 250
// and change the bytes a signature covers. Every byte that isn't replaced stays as captured.
import { luhn, TEST_CARDS } from "../../scripts/test-cards.ts";
import { base64ToBytes, type Capture } from "../capture/capture.ts";

export type ScrubCategory = "name" | "email" | "phone" | "address" | "card" | "credential" | "merchant" | "ip";

export interface ScrubbedRequest {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

const FAKE_EMAIL = "customer@example.com";
const FAKE_CARD = "4111111111111111";
const FAKE_MASKED_PAN = "411111******1111";
const FAKE_CREDENTIAL = "test_fake_do_not_use";
const FAKE_MERCHANT_ID = "MID-0000-0000";
const FAKE_IP = "192.0.2.1";

const NOT_ALPHANUMERIC = /[^a-z0-9]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SAFE_EMAIL = /@(example\.(com|org|net)|[a-z0-9-]+\.(example|test|invalid|localhost))$/i;
const CARD_NUMBER = /(?<![\d*])[2-6]\d{12,18}(?![\d*])/g;
const MASKED_PAN = /(?<!\d)\d{6}[*xX]{2,9}\d{4}(?!\d)/g;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const FORM_LIKE = /^[^=&\s]+=/;

const FIRST_NAMES = new Set(["firstname", "givenname", "middlename"]);
const LAST_NAMES = new Set(["lastname", "surname", "familyname"]);
const FULL_NAMES = new Set(["name", "fullname", "customername", "cardholdername", "holdername", "billingname", "shippingname", "payername"]);
const ADDRESS_KEYS = new Set([
  "street",
  "building",
  "floor",
  "apartment",
  "city",
  "state",
  "postalcode",
  "postcode",
  "zip",
  "zipcode",
  "line1",
  "line2",
  "district",
  "area",
]);
const CARD_KEYS = new Map([
  ["pan", FAKE_CARD],
  ["cardnumber", FAKE_CARD],
  ["maskedpan", FAKE_MASKED_PAN],
  ["firstsix", "411111"],
  ["firsteight", "41111111"],
  ["bin", "411111"],
  ["lastfour", "1111"],
]);
const IP_KEYS = new Set(["ip", "ipaddress", "customerip", "clientip", "remoteip", "sourceip"]);
const MERCHANT_KEYS = new Set(["merchantid", "merchantcode", "merchantidentifier", "profileid", "mid", "accountid", "terminalid"]);
const CREDENTIAL_PARTS = ["secret", "password", "passwd", "token", "apikey", "phrase", "privatekey", "accesscode", "authorization"];

export function categoryOf(key: string): ScrubCategory | undefined {
  const name = key.toLowerCase().replaceAll(NOT_ALPHANUMERIC, "");

  if (CREDENTIAL_PARTS.some((part) => name.includes(part))) return "credential";
  if (name.includes("email")) return "email";
  if (name.includes("phone") || name.includes("mobile") || name.includes("msisdn")) return "phone";
  if (IP_KEYS.has(name)) return "ip";
  if (CARD_KEYS.has(name)) return "card";
  if (MERCHANT_KEYS.has(name)) return "merchant";
  if (FIRST_NAMES.has(name) || LAST_NAMES.has(name) || FULL_NAMES.has(name)) return "name";
  if (ADDRESS_KEYS.has(name) || name.includes("address")) return "address";

  return undefined;
}

function isRealCard(digits: string): boolean {
  return luhn(digits) && !TEST_CARDS.has(digits);
}

function decodeFormPart(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

function stringEnd(text: string, start: number): number {
  let index = start + 1;

  while (index < text.length) {
    const char = text[index];

    if (char === "\\") {
      index += 2;
    } else if (char === '"') {
      return index + 1;
    } else {
      index += 1;
    }
  }

  return text.length;
}

function nextNonSpace(text: string, start: number): string | undefined {
  let index = start;

  while (index < text.length && " \t\r\n".includes(text[index] as string)) {
    index += 1;
  }

  return text[index];
}

export class Scrubber {
  readonly #counts = new Map<ScrubCategory, number>();
  readonly #phones = new Map<string, string>();

  get counts(): Readonly<Partial<Record<ScrubCategory, number>>> {
    return Object.fromEntries(this.#counts);
  }

  #count(category: ScrubCategory): void {
    this.#counts.set(category, (this.#counts.get(category) ?? 0) + 1);
  }

  // The same real number always gets the same fake one, so a payload that repeats a phone stays consistent.
  #fakePhone(real: string, withPlus: boolean): string {
    const digits = real.replaceAll(/\D/g, "");
    let fake = this.#phones.get(digits);

    if (fake === undefined) {
      fake = `20100000000${(this.#phones.size % 9) + 1}`;
      this.#phones.set(digits, fake);
    }

    return withPlus ? `+${fake}` : fake;
  }

  #fakeName(key: string): string {
    const name = key.toLowerCase().replaceAll(NOT_ALPHANUMERIC, "");

    if (FIRST_NAMES.has(name)) return "Test";
    if (LAST_NAMES.has(name)) return "Customer";

    return "Test Customer";
  }

  #fakeAddress(key: string): string {
    const name = key.toLowerCase().replaceAll(NOT_ALPHANUMERIC, "");

    if (name === "city") return "Test City";
    if (name.includes("zip") || name.includes("post")) return "00000";

    return "Test Address";
  }

  #fakeFor(category: ScrubCategory, key: string, value: string): string {
    switch (category) {
      case "name":
        return this.#fakeName(key);
      case "email":
        return FAKE_EMAIL;
      case "phone":
        return this.#fakePhone(value, true);
      case "address":
        return this.#fakeAddress(key);
      case "card":
        return CARD_KEYS.get(key.toLowerCase().replaceAll(NOT_ALPHANUMERIC, "")) as string;
      case "credential":
        return FAKE_CREDENTIAL;
      case "merchant":
        return FAKE_MERCHANT_ID;
      case "ip":
        return FAKE_IP;
    }
  }

  // Patterns that are scrubbed wherever they appear, whatever the key.
  scrubContent(value: string): string {
    return value
      .replaceAll(EMAIL, (email) => {
        if (SAFE_EMAIL.test(email)) return email;

        this.#count("email");

        return FAKE_EMAIL;
      })
      .replaceAll(CARD_NUMBER, (digits) => {
        if (!isRealCard(digits)) return digits;

        this.#count("card");

        return FAKE_CARD;
      })
      .replaceAll(MASKED_PAN, (masked) => {
        if (masked === FAKE_MASKED_PAN) return masked;

        this.#count("card");

        return FAKE_MASKED_PAN;
      });
  }

  scrubValue(key: string | undefined, value: string): string {
    const category = key === undefined ? undefined : categoryOf(key);

    if (category === undefined || value === "") {
      return this.scrubContent(value);
    }

    const fake = this.#fakeFor(category, key as string, value);

    if (fake !== value) {
      this.#count(category);
    }

    return fake;
  }

  #scrubNumber(key: string | undefined, token: string): string {
    const category = key === undefined ? undefined : categoryOf(key);

    if (category === "phone") {
      this.#count("phone");

      return this.#fakePhone(token, false);
    }

    if (category === "merchant") {
      this.#count("merchant");

      return `1${"0".repeat(Math.max(0, token.length - 1))}`;
    }

    if (/^\d{13,19}$/.test(token) && isRealCard(token)) {
      this.#count("card");

      return FAKE_CARD;
    }

    return token;
  }

  scrubJson(text: string): string {
    const keys: (string | undefined)[] = [undefined];
    let output = "";
    let index = 0;

    while (index < text.length) {
      const char = text[index] as string;

      if (char === '"') {
        const end = stringEnd(text, index);
        const literal = text.slice(index, end);

        if (nextNonSpace(text, end) === ":") {
          keys[keys.length - 1] = JSON.parse(literal) as string;
          output += literal;
        } else {
          const value = JSON.parse(literal) as string;
          const scrubbed = this.scrubValue(keys.at(-1), value);

          output += scrubbed === value ? literal : JSON.stringify(scrubbed);
        }

        index = end;
        continue;
      }

      NUMBER.lastIndex = index;
      const number = char === "-" || (char >= "0" && char <= "9") ? NUMBER.exec(text) : null;

      if (number !== null) {
        output += this.#scrubNumber(keys.at(-1), number[0]);
        index += number[0].length;
        continue;
      }

      if (char === "{") {
        keys.push(undefined);
      } else if (char === "[") {
        keys.push(keys.at(-1));
      } else if (char === "}" || char === "]") {
        keys.pop();
      }

      output += char;
      index += 1;
    }

    return output;
  }

  scrubForm(text: string): string {
    return text
      .split("&")
      .map((part) => {
        const equals = part.indexOf("=");
        const key = equals < 0 ? undefined : decodeFormPart(part.slice(0, equals));
        const value = equals < 0 ? undefined : decodeFormPart(part.slice(equals + 1));

        if (key === undefined || value === undefined) {
          return part;
        }

        const scrubbed = this.scrubValue(key, value);

        return scrubbed === value ? part : `${part.slice(0, equals)}=${encodeURIComponent(scrubbed)}`;
      })
      .join("&");
  }

  scrubBody(text: string): string {
    const trimmed = text.trimStart();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(text);

        return this.scrubJson(text);
      } catch {
        return this.scrubContent(text);
      }
    }

    return FORM_LIKE.test(text) ? this.scrubForm(text) : this.scrubContent(text);
  }

  scrubCapture(capture: Capture): ScrubbedRequest {
    const body = new TextDecoder().decode(base64ToBytes(capture.rawBodyBase64));
    // content-length no longer matches once values are replaced, and host names the receiver, not the gateway.
    const headers = Object.fromEntries(
      Object.entries(capture.headers)
        .filter(([name]) => name !== "content-length" && name !== "host")
        .map(([name, value]) => [name, this.scrubContent(value)]),
    );
    const query: Record<string, string> = {};

    for (const [name, value] of new URLSearchParams(this.scrubForm(capture.rawQuery))) {
      if (!Object.hasOwn(query, name)) query[name] = value;
    }

    return { rawBody: this.scrubBody(body), headers, query };
  }
}
