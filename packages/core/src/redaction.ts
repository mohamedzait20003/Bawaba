import { InvalidArgumentError } from "./errors.js";

export const REDACTED = "[redacted]";

const CIRCULAR = "[circular]";
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const NOT_ALPHANUMERIC = /[^a-z0-9]/g;

const SENSITIVE_PARTS = [
  "secret",
  "password",
  "passwd",
  "phrase",
  "token",
  "apikey",
  "privatekey",
  "authorization",
  "cookie",
  "email",
  "phone",
  "mobile",
  "cardnumber",
  "cvv",
  "cvc",
  "address",
  "firstname",
  "lastname",
  "fullname",
  "holdername",
  "billing",
  "shipping",
];

const SENSITIVE_KEYS = new Set([
  "pan",
  "name",
  "street",
  "building",
  "apartment",
  "floor",
  "postcode",
  "postalcode",
  "zip",
  "zipcode",
  "iban",
  "nationalid",
  "expiry",
  "expirydate",
  "expmonth",
  "expyear",
]);

export function isSensitiveKey(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(NOT_ALPHANUMERIC, "");

  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

export class Redactor {
  readonly #secrets = new Set<string>();
  #pattern: RegExp | undefined;

  static {
    Object.defineProperty(Redactor.prototype, Symbol.for("nodejs.util.inspect.custom"), { value: (): string => "Redactor [redacted]" });
  }

  constructor(secrets: Iterable<string | undefined> = []) {
    this.add(...secrets);
  }

  add(...secrets: (string | undefined)[]): this {
    for (const secret of secrets) {
      if (secret === undefined || secret === "") {
        continue;
      }

      if (typeof secret !== "string") {
        throw new InvalidArgumentError("A secret must be a string");
      }

      this.#secrets.add(secret);
      this.#secrets.add(encodeURIComponent(secret));
    }

    this.#pattern = undefined;

    return this;
  }

  redact(text: string): string {
    const pattern = this.#compile();

    return pattern === undefined ? text : text.replace(pattern, REDACTED);
  }

  redactValue(value: unknown): unknown {
    return this.#redactValue(value, new WeakSet());
  }

  toJSON(): string {
    return "Redactor [redacted]";
  }

  toString(): string {
    return "Redactor [redacted]";
  }

  #compile(): RegExp | undefined {
    if (this.#pattern === undefined && this.#secrets.size > 0) {
      const alternatives = [...this.#secrets].sort((a, b) => b.length - a.length).map((secret) => secret.replaceAll(REGEX_SPECIAL, String.raw`\$&`));

      this.#pattern = new RegExp(alternatives.join("|"), "g");
    }

    return this.#pattern;
  }

  #redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
    if (typeof value === "string") {
      return this.redact(value);
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    if (ancestors.has(value)) {
      return CIRCULAR;
    }

    ancestors.add(value);

    const result = Array.isArray(value) ? value.map((item: unknown) => this.#redactValue(item, ancestors)) : this.#redactRecord(value, ancestors);

    ancestors.delete(value);

    return result;
  }

  #redactRecord(record: object, ancestors: WeakSet<object>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(record)) {
      result[key] = isSensitiveKey(key) && item !== undefined && item !== null ? REDACTED : this.#redactValue(item, ancestors);
    }

    return result;
  }
}
