// Public test card numbers published by card networks and gateways.
// Shared by the secret scanner and the fixture scrubber (tools/fixtures/scrub.ts).
export const TEST_CARDS: ReadonlySet<string> = new Set([
  "4111111111111111",
  "4242424242424242",
  "4000000000000002",
  "4012888888881881",
  "5123450000000008",
  "5555555555554444",
  "5200000000000007",
  "2223000000000007",
  "378282246310005",
  "371449635398431",
  "6011111111111117",
]);

export function luhn(digits: string): boolean {
  let sum = 0;

  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);

    if (i % 2 === 1) {
      d *= 2;

      if (d > 9) d -= 9;
    }

    sum += d;
  }

  return sum % 10 === 0;
}
