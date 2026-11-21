import { InvalidArgumentError, type RawWebhookRequest } from "@bawabajs/core";

export const FIXTURE_GATEWAYS: readonly ["paymob", "kashier", "fawry", "geidea", "paytabs", "payfort", "tap"] = [
  "paymob",
  "kashier",
  "fawry",
  "geidea",
  "paytabs",
  "payfort",
  "tap",
];

export type FixtureGateway = (typeof FIXTURE_GATEWAYS)[number];

export type FixtureSource = "sandbox" | "synthetic";

export interface FixtureRequest {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface Fixture {
  readonly gateway: FixtureGateway;
  readonly scenario: string;
  readonly description: string;
  readonly source: FixtureSource;
  readonly recordedAt: string;
  readonly sandboxAccount?: string;
  readonly secret: string;
  readonly signedString: string;
  readonly expectedSignature: string;
  readonly request: FixtureRequest;
}

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const VISIBLY_FAKE = /test|fake|do_not_use/i;

type Fields = Readonly<Record<string, unknown>>;

function invalid(problem: string): InvalidArgumentError {
  return new InvalidArgumentError(`Invalid fixture: ${problem} (see fixtures/README.md)`);
}

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(fields: Fields, name: string): string {
  const value = fields[name];

  if (typeof value !== "string" || value === "") {
    throw invalid(`"${name}" must be a non-empty string`);
  }

  return value;
}

function stringRecord(fields: Fields, name: string): Readonly<Record<string, string>> {
  const value = fields[name];

  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === "string")) {
    throw invalid(`"request.${name}" must be an object of strings`);
  }

  return value as Readonly<Record<string, string>>;
}

function parseRequest(value: unknown): FixtureRequest {
  if (!isRecord(value) || typeof value.rawBody !== "string") {
    throw invalid('"request.rawBody" must be the raw body as a string');
  }

  return { rawBody: value.rawBody, headers: stringRecord(value, "headers"), query: stringRecord(value, "query") };
}

function parseSource(fields: Fields): { source: FixtureSource; sandboxAccount?: string } {
  const source = fields.source;
  const alias = fields.sandboxAccount;

  if (source !== "sandbox" && source !== "synthetic") {
    throw invalid('"source" must be "sandbox" or "synthetic"');
  }

  if (alias !== undefined && typeof alias !== "string") {
    throw invalid('"sandboxAccount" must be a string');
  }

  if (source === "sandbox" && alias === undefined) {
    throw invalid('a sandbox fixture needs a "sandboxAccount" alias');
  }

  return alias === undefined ? { source } : { source, sandboxAccount: alias };
}

function parseJson(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch (cause) {
    throw new InvalidArgumentError("Invalid fixture: not valid JSON", { cause });
  }
}

export function parseFixture(input: unknown): Fixture {
  const fields = parseJson(input);

  if (!isRecord(fields)) {
    throw invalid("it must be a JSON object");
  }

  const gateway = text(fields, "gateway");
  const scenario = text(fields, "scenario");
  const recordedAt = text(fields, "recordedAt");
  const secret = text(fields, "secret");
  const signedString = text(fields, "signedString");

  if (!(FIXTURE_GATEWAYS as readonly string[]).includes(gateway)) {
    throw invalid(`"gateway" must be one of ${FIXTURE_GATEWAYS.join(", ")}`);
  }

  if (!KEBAB_CASE.test(scenario)) {
    throw invalid('"scenario" must be kebab-case');
  }

  if (!ISO_TIMESTAMP.test(recordedAt) || Number.isNaN(Date.parse(recordedAt))) {
    throw invalid('"recordedAt" must be an ISO 8601 UTC timestamp');
  }

  if (!VISIBLY_FAKE.test(secret)) {
    throw invalid('"secret" must be visibly fake (contain "test", "fake" or "do_not_use")');
  }

  if (signedString.includes(secret)) {
    throw invalid('"signedString" must not contain the secret');
  }

  return {
    gateway: gateway as FixtureGateway,
    scenario,
    description: text(fields, "description"),
    ...parseSource(fields),
    recordedAt,
    secret,
    signedString,
    expectedSignature: text(fields, "expectedSignature"),
    request: parseRequest(fields.request),
  };
}

export function fixtureRequest(fixture: Fixture): RawWebhookRequest {
  return { rawBody: fixture.request.rawBody, headers: fixture.request.headers, query: fixture.request.query };
}
