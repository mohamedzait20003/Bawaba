import { InvalidArgumentError } from "./errors.js";

export type Currency = "EGP" | "SAR" | "AED" | "QAR" | "MAD" | "USD" | "EUR" | "GBP" | "KWD" | "BHD" | "OMR" | "JOD" | "IQD";

export type Money = { minor: number; currency: Currency };

export const CURRENCY_EXPONENTS: Readonly<Record<Currency, number>> = Object.freeze({
  EGP: 2,
  SAR: 2,
  AED: 2,
  QAR: 2,
  MAD: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  IQD: 3,
});

export const CURRENCIES: readonly Currency[] = Object.freeze(Object.keys(CURRENCY_EXPONENTS) as Currency[]);

const MAX_EXPONENT = 4;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function currencyExponent(currency: Currency): number {
  if (!isCurrency(currency)) {
    throw new InvalidArgumentError("Unknown currency");
  }
  return CURRENCY_EXPONENTS[currency];
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { minor, currency } = value as Partial<Record<keyof Money, unknown>>;
  return typeof minor === "number" && Number.isSafeInteger(minor) && minor >= 0 && isCurrency(currency);
}

export function assertMoney(value: unknown): asserts value is Money {
  if (!isMoney(value)) {
    throw new InvalidArgumentError("Money must be { minor, currency } with a non-negative safe-integer minor and a supported currency");
  }
}

function resolveExponent(currency: Currency, override: number | undefined): number {
  const exponent = override ?? currencyExponent(currency);
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new InvalidArgumentError(`The exponent must be an integer from 0 to ${MAX_EXPONENT}`);
  }
  return exponent;
}

export function toDecimalString(money: Money, exponent?: number): string {
  assertMoney(money);
  const places = resolveExponent(money.currency, exponent);
  const digits = BigInt(money.minor)
    .toString()
    .padStart(places + 1, "0");
  if (places === 0) {
    return digits;
  }
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export function fromDecimalString(text: string, currency: Currency, exponent?: number): Money {
  const places = resolveExponent(currency, exponent);
  const match = typeof text === "string" ? DECIMAL.exec(text) : null;

  if (!match) {
    throw new InvalidArgumentError("The amount must be a plain decimal string such as 250.00");
  }

  const whole = match[1] as string;
  const fraction = match[2] ?? "";

  if (fraction.length > places) {
    throw new InvalidArgumentError(`The amount has more than ${places} decimal places for ${currency}`);
  }

  const minor = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"));

  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidArgumentError("The amount is too large to represent exactly");
  }

  return { minor: Number(minor), currency };
}
