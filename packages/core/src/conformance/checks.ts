import { type Capabilities, isCapabilityLevel } from "../capabilities.js";
import { utf8Decode, utf8Encode } from "../encoding.js";
import { ApiError, OutcomeUnknownError, SignatureVerificationError } from "../errors.js";
import type { FetchLike, RequestEvent, ResponseEvent } from "../http/types.js";
import { type IdempotencyRecord, type IdempotencyStore, MemoryIdempotencyStore } from "../idempotency.js";
import type { Currency, Money } from "../money.js";
import { parseFormBody, type RawWebhookRequest } from "../webhooks.js";

export type Inspect = (value: unknown) => string;

export interface ConformanceMoney {
  readonly currencies: readonly Currency[];
  readonly toGateway: (money: Money) => unknown;
  readonly fromGateway: (value: unknown, currency: Currency) => Money;
}

export interface TamperedRequest {
  readonly name: string;
  readonly request: RawWebhookRequest;
}

export interface TamperedRequests {
  readonly missingSignature: RawWebhookRequest;
  readonly wrongSignature: RawWebhookRequest;
  readonly changedSignedFields: readonly TamperedRequest[];
  readonly unknownEventType?: RawWebhookRequest;
  readonly missingEventType?: RawWebhookRequest;
}

export interface ConformanceWebhook {
  readonly name: string;
  readonly valid: RawWebhookRequest;
  readonly tampered: TamperedRequests;
  readonly verify: (input: RawWebhookRequest) => Promise<unknown>;
  readonly inspect: (input: unknown) => unknown;
}

export interface MutationContext {
  readonly fetch: FetchLike;
  readonly idempotencyStore: IdempotencyStore;
  readonly onRequest: (event: RequestEvent) => void;
  readonly onResponse: (event: ResponseEvent) => void;
}

export interface ConformanceMutation {
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly run: (context: MutationContext) => Promise<unknown>;
}

export interface ConformanceSubject {
  readonly gateway: string;
  readonly client: unknown;
  readonly secrets: readonly string[];
  readonly capabilities: Capabilities;
  readonly operations: readonly string[];
  readonly money: ConformanceMoney;
  readonly webhooks: readonly ConformanceWebhook[];
  readonly mutations: readonly ConformanceMutation[];
  readonly inspect?: Inspect;
}

interface Output {
  readonly label: string;
  readonly text: string;
}

interface Finding {
  readonly problems: readonly string[];
  readonly outputs: readonly Output[];
}

interface MutationFailure {
  readonly label: string;
  readonly outcome: "unknown" | "definite";
  readonly respond: () => Response | Promise<Response>;
}

export const SAMPLE_MINOR_AMOUNTS: readonly number[] = [0, 1, 5, 99, 100, 150_000, 999_999_999];

const ACCEPTED = Symbol("accepted");
const MAX_CAUSE_DEPTH = 5;

const MUTATION_FAILURES: readonly MutationFailure[] = [
  { label: "HTTP 503", outcome: "unknown", respond: () => new Response("unavailable", { status: 503 }) },
  { label: "HTTP 500", outcome: "unknown", respond: () => new Response("error", { status: 500 }) },
  { label: "a network error", outcome: "unknown", respond: () => Promise.reject(new TypeError("fetch failed")) },
  { label: "HTTP 400", outcome: "definite", respond: () => Response.json({ error: "bad request" }, { status: 400 }) },
];

async function outcome(run: () => unknown): Promise<unknown> {
  try {
    await run();

    return ACCEPTED;
  } catch (error) {
    return error;
  }
}

// Names and codes only: a message could carry the very secret the suite is looking for.
function describeError(error: unknown): string {
  if (error === ACCEPTED) {
    return "no error";
  }

  if (!(error instanceof Error)) {
    return typeof error;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" ? `${error.name} (${code})` : error.name;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "";
  }
}

function causeMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages;
}

function render(value: unknown, inspect: Inspect | undefined): string {
  const parts = [safeString(value), safeJson(value), ...causeMessages(value)];

  if (inspect !== undefined) {
    parts.push(inspect(value));
  }

  return parts.join("\n");
}

export function findLeaks(secrets: readonly string[], outputs: readonly Output[]): string[] {
  const problems: string[] = [];

  for (const output of outputs) {
    if (secrets.some((secret) => secret !== "" && output.text.includes(secret))) {
      problems.push(`${output.label} contains a configured secret`);
    }
  }

  return problems;
}

export function checkSubject(subject: ConformanceSubject): string[] {
  const missing = [
    ["operations", subject.operations],
    ["secrets", subject.secrets],
    ["webhooks", subject.webhooks],
    ["mutations", subject.mutations],
  ] as const;

  return missing.filter(([, list]) => list.length === 0).map(([name]) => `the subject declares no ${name}`);
}

export function checkCapabilities(subject: Pick<ConformanceSubject, "capabilities" | "operations">): string[] {
  const problems: string[] = [];

  for (const operation of subject.operations) {
    if (!Object.hasOwn(subject.capabilities, operation)) {
      problems.push(`${operation}: no capability level is declared`);
    }
  }

  for (const [name, level] of Object.entries(subject.capabilities)) {
    if (!isCapabilityLevel(level)) {
      problems.push(`${name}: the declared level is not supported, beta or unsupported`);
    }
  }

  return problems;
}

export function checkMoney(money: ConformanceMoney): string[] {
  const problems: string[] = money.currencies.length === 0 ? ["no currencies are declared"] : [];

  for (const currency of money.currencies) {
    for (const minor of SAMPLE_MINOR_AMOUNTS) {
      try {
        const back = money.fromGateway(money.toGateway({ minor, currency }), currency);

        if (back.minor !== minor || back.currency !== currency) {
          problems.push(`${minor} ${currency} round-trips to ${String(back.minor)} ${String(back.currency)}`);
        }
      } catch (error) {
        problems.push(`${minor} ${currency}: the conversion threw ${describeError(error)}`);
      }
    }
  }

  return problems;
}

function otherBodyType(rawBody: string | Uint8Array): string | Uint8Array {
  return typeof rawBody === "string" ? utf8Encode(rawBody) : utf8Decode(rawBody);
}

function parsedBody(rawBody: string | Uint8Array): unknown {
  const text = typeof rawBody === "string" ? rawBody : utf8Decode(rawBody);

  try {
    return JSON.parse(text);
  } catch {
    return { ...parseFormBody(text) };
  }
}

function tamperedList(tampered: TamperedRequests): [string, RawWebhookRequest][] {
  const list: [string, RawWebhookRequest][] = [
    ["a missing signature", tampered.missingSignature],
    ["a wrong signature", tampered.wrongSignature],
    ...tampered.changedSignedFields.map((field): [string, RawWebhookRequest] => [`a changed signed field (${field.name})`, field.request]),
  ];

  if (tampered.unknownEventType !== undefined) {
    list.push(["an unknown event type", tampered.unknownEventType]);
  }

  if (tampered.missingEventType !== undefined) {
    list.push(["a missing event type", tampered.missingEventType]);
  }

  return list;
}

export async function checkWebhook(webhook: ConformanceWebhook, secrets: readonly string[], inspect?: Inspect): Promise<string[]> {
  const problems: string[] = [];
  const otherType = typeof webhook.valid.rawBody === "string" ? "bytes" : "a string";

  const valid = await outcome(() => webhook.verify(webhook.valid));

  if (valid !== ACCEPTED) {
    problems.push(`the valid request was refused: ${describeError(valid)}`);
  }

  const converted = await outcome(() => webhook.verify({ ...webhook.valid, rawBody: otherBodyType(webhook.valid.rawBody) }));

  if (converted !== ACCEPTED) {
    problems.push(`the same body passed as ${otherType} was refused: ${describeError(converted)}`);
  }

  const parsed = await outcome(() => webhook.verify({ ...webhook.valid, rawBody: parsedBody(webhook.valid.rawBody) as unknown as string }));

  if (parsed === ACCEPTED) {
    problems.push("a parsed body was accepted instead of the raw body");
  }

  if (webhook.tampered.changedSignedFields.length === 0) {
    problems.push("no changed-signed-field requests are given: add one for each signed field");
  }

  const tampered = await Promise.all(
    tamperedList(webhook.tampered).map(async ([label, request]): Promise<Finding> => {
      const result = await outcome(() => webhook.verify(request));
      const output = { label: `the error for ${label}`, text: render(result, inspect) };

      if (result === ACCEPTED) {
        return { problems: [`${label} was accepted`], outputs: [output] };
      }

      return {
        problems: result instanceof SignatureVerificationError ? [] : [`${label} threw ${describeError(result)}, not SignatureVerificationError`],
        outputs: [output],
      };
    }),
  );

  return combine(secrets, [{ problems, outputs: [] }, ...tampered]);
}

function combine(secrets: readonly string[], findings: readonly Finding[]): string[] {
  const problems = findings.flatMap((finding) => finding.problems);
  const outputs = findings.flatMap((finding) => finding.outputs);

  return [...problems, ...findLeaks(secrets, outputs)];
}

export async function checkInspect(webhook: ConformanceWebhook, secrets: readonly string[], inspect?: Inspect): Promise<string[]> {
  const inputs: [string, unknown][] = [
    ["the valid request", webhook.valid],
    ...tamperedList(webhook.tampered),
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a parsed body", { rawBody: parsedBody(webhook.valid.rawBody) }],
    ["an invalid header", { rawBody: "", headers: { "bad name": "x" } }],
    ["a string", "rawBody"],
  ];

  const findings = await Promise.all(
    inputs.map(async ([label, input]): Promise<Finding> => {
      try {
        const report = await webhook.inspect(input);

        return { problems: [], outputs: [{ label: `the inspect report for ${label}`, text: render(report, inspect) }] };
      } catch (error) {
        return { problems: [`inspect threw ${describeError(error)} for ${label}`], outputs: [] };
      }
    }),
  );

  return combine(secrets, findings);
}

function outcomeProblems(prefix: string, failure: MutationFailure, error: unknown, record: IdempotencyRecord | undefined): string[] {
  if (failure.outcome === "unknown") {
    return [
      ...(error instanceof OutcomeUnknownError ? [] : [`${prefix}: threw ${describeError(error)}, not OutcomeUnknownError`]),
      ...(record?.state === "held" ? [] : [`${prefix}: the idempotency claim was not kept`]),
    ];
  }

  return [
    ...(error instanceof ApiError && error.status === 400 ? [] : [`${prefix}: threw ${describeError(error)}, not the gateway's 400 error`]),
    ...(record === undefined ? [] : [`${prefix}: the idempotency claim was not released after a definite failure`]),
  ];
}

async function runMutationFailure(mutation: ConformanceMutation, failure: MutationFailure, inspect: Inspect | undefined): Promise<Finding> {
  const store = new MemoryIdempotencyStore();
  const events: (RequestEvent | ResponseEvent)[] = [];
  let calls = 0;
  const fetch: FetchLike = async () => {
    calls += 1;

    return failure.respond();
  };

  const error = await outcome(() =>
    mutation.run({ fetch, idempotencyStore: store, onRequest: (event) => events.push(event), onResponse: (event) => events.push(event) }),
  );
  const record = await store.get(mutation.idempotencyKey);
  const prefix = `${mutation.operation} after ${failure.label}`;
  const callProblems = calls === 1 ? [] : [`${prefix}: fetch was called ${calls} times, not exactly once`];

  return {
    problems: [...callProblems, ...outcomeProblems(prefix, failure, error, record)],
    outputs: [
      { label: `the error for ${prefix}`, text: render(error, inspect) },
      { label: `the hook events for ${prefix}`, text: safeJson(events) },
    ],
  };
}

export async function checkMutation(mutation: ConformanceMutation, secrets: readonly string[], inspect?: Inspect): Promise<string[]> {
  return combine(secrets, await Promise.all(MUTATION_FAILURES.map((failure) => runMutationFailure(mutation, failure, inspect))));
}

export function checkClient(subject: Pick<ConformanceSubject, "client" | "secrets" | "inspect">): string[] {
  return findLeaks(subject.secrets, [{ label: "the client", text: render(subject.client, subject.inspect) }]);
}
