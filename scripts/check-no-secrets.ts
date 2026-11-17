// Secret scanner: fails when a tracked (or new, not ignored) file looks like it contains a real credential,
// a real card number or unscrubbed personal data. See docs/specifications/TECHNICAL_SPECIFICATIONS.md §9 and §10.
// A line can opt out with the marker `bawaba-allow-secret` when the match is a documented false positive.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ALLOW_MARKER = "bawaba-allow-secret";
const SKIP = [/^pnpm-lock\.yaml$/, /^LICENSE$/, /(^|\/)node_modules\//, /(^|\/)dist\//, /\.(png|jpe?g|ico|gif|woff2?)$/i];

// Public test card numbers published by card networks and gateways.
const TEST_CARDS = new Set([
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

// Domains reserved for documentation (RFC 2606) or obviously fake.
const SAFE_EMAIL_DOMAINS = /@(example\.(com|org|net)|[a-z0-9-]+\.(example|test|invalid|localhost))$/i;

// Credential-like field names in fixtures; their values must be visibly fake.
const CREDENTIAL_KEY =
  /"(secret|secretKey|apiKey|paymentApiKey|hmacSecret|secureKey|serverKey|apiPassword|requestPhrase|responsePhrase|accessCode|password|token)"\s*:\s*"([^"]*)"/gi;
const FAKE_VALUE = /test|fake|dummy|example|do_not_use|redacted|placeholder|x{4,}/i;

interface Rule {
  name: string;
  pattern: RegExp;
  appliesTo?: (file: string) => boolean;
  isViolation?: (match: RegExpMatchArray) => boolean;
}

const isFixture = (file: string): boolean => file.startsWith("fixtures/");

function isRealEmailAddress(match: RegExpMatchArray): boolean {
  const line = match.input ?? "";
  const at = match.index ?? -1;
  if (at <= 0) return false;

  let start = at - 1;
  while (start >= 0 && isEmailLocalChar(line[start] ?? "")) start--;

  let end = at + 1;
  while (end < line.length && isEmailDomainChar(line[end] ?? "")) end++;

  while (end > at + 1 && ".-".includes(line[end - 1] ?? "")) end--;

  const local = line.slice(start + 1, at);
  const domain = line.slice(at + 1, end);
  const lastDot = domain.lastIndexOf(".");
  const topLevelDomain = domain.slice(lastDot + 1);
  if (!local || lastDot < 0 || !/^[A-Za-z]{2,}$/.test(topLevelDomain)) return false;

  return !SAFE_EMAIL_DOMAINS.test(`${local}@${domain}`);
}

function isEmailLocalChar(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || "._%+-".includes(char);
}

function isEmailDomainChar(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ".-".includes(char);
}

const RULES: Rule[] = [
  { name: "live secret key", pattern: /\b[a-z]{0,4}_?sk_live_[A-Za-z0-9]{8,}/g },
  { name: "live public key", pattern: /\b[a-z]{0,4}_?pk_live_[A-Za-z0-9]{8,}/g },
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  {
    name: "card number (Luhn-valid, not a public test card)",
    pattern: /(?<![\d*])[2-6]\d{14,18}(?![\d*])/g,
    isViolation: (m) => luhn(m[0]) && !TEST_CARDS.has(m[0]),
  },
  {
    name: "credential in a fixture that is not visibly fake",
    pattern: CREDENTIAL_KEY,
    appliesTo: isFixture,
    isViolation: (m) => (m[2] ?? "").length > 0 && !FAKE_VALUE.test(m[2] ?? ""),
  },
  {
    name: "real email address in a fixture",
    pattern: /@/g,
    appliesTo: isFixture,
    isViolation: isRealEmailAddress,
  },
];

function luhn(digits: string): boolean {
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

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }) // NOSONAR: Git is an explicit local developer-tool dependency; repository data cannot control the executable or arguments.
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f.length > 0 && !SKIP.some((re) => re.test(f)));

const problems: string[] = [];

for (const file of files) {
  if (/(^|\/)\.env(\..+)?$/.test(file) && !file.endsWith(".env.example")) {
    problems.push(`${file}: .env files must never be committed`);
    continue;
  }

  const path = join(ROOT, file);
  let text: string;

  try {
    if (statSync(path).size > 2_000_000) continue;
    text = readFileSync(path, "utf8");
  } catch {
    continue; // deleted in the working tree
  }

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;

    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo(file)) continue;

      for (const match of line.matchAll(rule.pattern)) {
        if (rule.isViolation && !rule.isViolation(match)) continue;

        problems.push(`${file}:${index + 1}: ${rule.name}`);
      }
    }
  });
}

if (problems.length > 0) {
  const formattedProblems = problems.map((p) => "  - " + p).join("\n");
  console.error(`check-no-secrets: ${problems.length} problem(s)\n${formattedProblems}`);
  console.error("Never commit real credentials or personal data. Scrub fixtures as described in fixtures/README.md.");
  process.exit(1);
}

console.log(`check-no-secrets: ${files.length} files OK`);
