import { ApiError, CURRENCIES, defineCapabilities, fromDecimalString, OutcomeUnknownError, request, toDecimalString, utf8Encode } from "@bawabajs/core";
import {
  type ConformanceMutation,
  type ConformanceSubject,
  type ConformanceWebhook,
  checkCapabilities,
  checkClient,
  checkInspect,
  checkMoney,
  checkMutation,
  checkSubject,
  checkWebhook,
  findLeaks,
  type MutationContext,
  runConformanceSuite,
  SAMPLE_MINOR_AMOUNTS,
} from "@bawabajs/core/conformance";
import { describe, expect, it } from "vitest";
import { EXAMPLE_SECRET, ExampleClient, signedRequest } from "./support/example-client.js";
import { inspect } from "./support/inspect.js";

const client = new ExampleClient({ secret: EXAMPLE_SECRET });
const paid = JSON.stringify({ type: "payment.paid", id: "pay_1", amount: "250.00", note: "untrusted" });
const valid = await signedRequest(paid);

const webhook: ConformanceWebhook = {
  name: "payment webhook",
  valid,
  tampered: {
    missingSignature: { rawBody: paid },
    wrongSignature: { rawBody: paid, headers: { "x-signature": "00".repeat(32) } },
    changedSignedFields: [
      { name: "amount", request: { ...valid, rawBody: paid.replace("250.00", "1.00") } },
      { name: "id", request: { ...valid, rawBody: paid.replace("pay_1", "pay_2") } },
    ],
    unknownEventType: await signedRequest(JSON.stringify({ type: "payment.teleported", id: "pay_1", amount: "250.00" })),
    missingEventType: await signedRequest(JSON.stringify({ id: "pay_1", amount: "250.00" })),
  },
  verify: (input) => client.verify(input),
  inspect: (input) => client.inspect(input),
};

const mutation: ConformanceMutation = {
  operation: "refunds.create",
  idempotencyKey: "refund:pay_1",
  run: (context) => new ExampleClient({ secret: EXAMPLE_SECRET, ...context }).refund({ paymentId: "pay_1", amount: "50.00", idempotencyKey: "refund:pay_1" }),
};

const subject: ConformanceSubject = {
  gateway: "example",
  client,
  secrets: [EXAMPLE_SECRET],
  capabilities: defineCapabilities({ "refunds.create": "supported", "webhooks.verify": "beta" }),
  operations: ["refunds.create", "webhooks.verify"],
  money: {
    currencies: CURRENCIES,
    toGateway: (money) => toDecimalString(money),
    fromGateway: (value, currency) => fromDecimalString(value as string, currency),
  },
  webhooks: [webhook],
  mutations: [mutation],
  inspect,
};

await runConformanceSuite(subject);

const acceptAll = { ...webhook, verify: async () => ({}) };

describe("checkSubject", () => {
  it("reports every empty list", () => {
    expect(checkSubject({ ...subject, operations: [], secrets: [], webhooks: [], mutations: [] })).toEqual([
      "the subject declares no operations",
      "the subject declares no secrets",
      "the subject declares no webhooks",
      "the subject declares no mutations",
    ]);
  });
});

describe("checkCapabilities", () => {
  it("reports an undeclared operation and an invalid level", () => {
    const capabilities = { "refunds.create": "maybe" } as unknown as ConformanceSubject["capabilities"];
    expect(checkCapabilities({ capabilities, operations: ["refunds.create", "payments.void"] })).toEqual([
      "payments.void: no capability level is declared",
      "refunds.create: the declared level is not supported, beta or unsupported",
    ]);
  });
});

describe("checkMoney", () => {
  it("tests every sample amount", () => {
    expect(SAMPLE_MINOR_AMOUNTS).toContain(0);
    expect(SAMPLE_MINOR_AMOUNTS).toContain(999_999_999);
  });

  it("reports a conversion that loses an amount or a currency", () => {
    const lossy = {
      ...subject.money,
      currencies: ["KWD"] as const,
      fromGateway: (value: unknown) => ({ minor: Math.round(Number(value) * 100), currency: "USD" as const }),
    };
    expect(checkMoney(lossy)).toContain("1 KWD round-trips to 0 USD");
  });

  it("reports a conversion that throws, by error name only", () => {
    const throwing = {
      ...subject.money,
      currencies: ["EGP", "SAR"] as const,
      toGateway: () => {
        throw new TypeError(`bad ${EXAMPLE_SECRET}`);
      },
      fromGateway: () => {
        throw "not an error";
      },
    };
    const problems = checkMoney(throwing);
    expect(problems).toContain("0 EGP: the conversion threw TypeError");
    expect(problems.join("\n")).not.toContain(EXAMPLE_SECRET);
    expect(checkMoney({ ...throwing, toGateway: () => 1 })).toContain("0 EGP: the conversion threw string");
  });

  it("reports an empty currency list", () => {
    expect(checkMoney({ ...subject.money, currencies: [] })).toEqual(["no currencies are declared"]);
  });
});

describe("checkWebhook", () => {
  it("reports a verifier that accepts anything", async () => {
    const problems = await checkWebhook(acceptAll, [EXAMPLE_SECRET]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "a parsed body was accepted instead of the raw body",
        "a missing signature was accepted",
        "a wrong signature was accepted",
        "a changed signed field (amount) was accepted",
        "an unknown event type was accepted",
        "a missing event type was accepted",
      ]),
    );
  });

  it("reports a verifier that refuses the valid request, or the same body as bytes", async () => {
    const stringOnly = {
      ...webhook,
      verify: async (input: Parameters<ConformanceWebhook["verify"]>[0]) =>
        typeof input.rawBody === "string" ? client.verify(input) : Promise.reject(new Error("bytes")),
    };
    expect(await checkWebhook(stringOnly, [])).toContain("the same body passed as bytes was refused: Error");

    const refusing = { ...webhook, valid: { rawBody: paid } };
    expect(await checkWebhook(refusing, [])).toContain("the valid request was refused: SignatureVerificationError (signature_invalid)");
  });

  it("handles a byte body that is a form, not JSON", async () => {
    const form = { ...acceptAll, valid: { rawBody: utf8Encode("a=1&b=2") } };
    const problems = await checkWebhook(form, []);
    expect(problems).toContain("a parsed body was accepted instead of the raw body");
    expect(problems).not.toContain("the same body passed as a string was refused: Error");
  });

  it("reports the wrong error type and a missing changed-field list", async () => {
    const wrongError = { ...webhook, verify: () => Promise.reject(new TypeError("bug")), tampered: { ...webhook.tampered, changedSignedFields: [] } };
    const problems = await checkWebhook(wrongError, []);
    expect(problems).toContain("no changed-signed-field requests are given: add one for each signed field");
    expect(problems).toContain("a missing signature threw TypeError, not SignatureVerificationError");
  });

  it("reports an error that reveals a secret, also through its cause chain", async () => {
    const leaking = { ...webhook, verify: () => Promise.reject(new Error("outer", { cause: new Error(`inner ${EXAMPLE_SECRET}`) })) };
    expect(await checkWebhook(leaking, [EXAMPLE_SECRET])).toContain("the error for a wrong signature contains a configured secret");
  });

  it("follows a cause chain only so far", async () => {
    let error = new Error(EXAMPLE_SECRET);

    for (let depth = 0; depth < 6; depth++) {
      error = new Error(`level ${depth}`, { cause: error });
    }

    const deep = { ...webhook, verify: () => Promise.reject(error) };
    expect(await checkWebhook(deep, [EXAMPLE_SECRET])).not.toContain("the error for a wrong signature contains a configured secret");
  });

  it("omits the optional event-type checks when they are not given", async () => {
    const { unknownEventType: _unknown, missingEventType: _missing, ...required } = webhook.tampered;
    const problems = await checkWebhook({ ...acceptAll, tampered: required }, []);
    expect(problems.some((problem) => problem.includes("event type"))).toBe(false);
  });
});

describe("checkInspect", () => {
  it("reports an inspect that throws, by error name only", async () => {
    const throwing = {
      ...webhook,
      inspect: (input: unknown) => {
        if (input === undefined) {
          throw new TypeError(EXAMPLE_SECRET);
        }

        return { ok: true };
      },
    };
    const problems = await checkInspect(throwing, [EXAMPLE_SECRET]);
    expect(problems).toEqual(["inspect threw TypeError for undefined"]);
  });

  it("reports a report that reveals a secret, and copes with reports that do not serialize", async () => {
    const leaking = { ...webhook, inspect: () => ({ expectedKey: EXAMPLE_SECRET }) };
    expect(await checkInspect(leaking, [EXAMPLE_SECRET])).toContain("the inspect report for the valid request contains a configured secret");

    const awkward = { ...webhook, inspect: () => Object.assign(Object.create(null) as object, { big: 1n }) };
    expect(await checkInspect(awkward, [EXAMPLE_SECRET])).toEqual([]);

    const empty = { ...webhook, inspect: () => undefined };
    expect(await checkInspect(empty, [EXAMPLE_SECRET], inspect)).toEqual([]);
  });
});

const mutationRequest = (context: MutationContext) =>
  request(
    { gateway: "example", baseUrl: "https://api.example.test", fetch: context.fetch },
    { method: "POST", path: "/refunds", kind: "mutation", operation: "refunds.create" },
  );

describe("checkMutation", () => {
  it("reports a client that calls the gateway twice and hides the failure", async () => {
    const retrying: ConformanceMutation = {
      ...mutation,
      run: async ({ fetch }) => {
        await fetch("https://api.example.test/refunds", {}).catch(() => undefined);

        return fetch("https://api.example.test/refunds", {});
      },
    };
    const problems = await checkMutation(retrying, []);
    expect(problems).toEqual(
      expect.arrayContaining([
        "refunds.create after HTTP 503: fetch was called 2 times, not exactly once",
        "refunds.create after HTTP 503: threw no error, not OutcomeUnknownError",
        "refunds.create after HTTP 503: the idempotency claim was not kept",
        "refunds.create after a network error: threw TypeError, not OutcomeUnknownError",
        "refunds.create after HTTP 400: threw no error, not the gateway's 400 error",
      ]),
    );
  });

  it("reports a client that releases the claim after an unknown outcome", async () => {
    const releasing: ConformanceMutation = {
      ...mutation,
      run: async (context) => {
        await context.idempotencyStore.claim(mutation.idempotencyKey, "fp");

        try {
          return await mutationRequest(context);
        } catch (error) {
          await context.idempotencyStore.release(mutation.idempotencyKey);
          throw error;
        }
      },
    };
    expect(await checkMutation(releasing, [])).toEqual([
      "refunds.create after HTTP 503: the idempotency claim was not kept",
      "refunds.create after HTTP 500: the idempotency claim was not kept",
      "refunds.create after a network error: the idempotency claim was not kept",
    ]);
  });

  it("reports a client that keeps the claim after a definite failure", async () => {
    const keeping: ConformanceMutation = {
      ...mutation,
      run: async (context) => {
        await context.idempotencyStore.claim(mutation.idempotencyKey, "fp");

        return mutationRequest(context);
      },
    };
    expect(await checkMutation(keeping, [])).toEqual(["refunds.create after HTTP 400: the idempotency claim was not released after a definite failure"]);
  });

  it("reports an error or a hook event that reveals a secret", async () => {
    const leaking: ConformanceMutation = {
      ...mutation,
      run: async (context) => {
        context.onRequest({
          gateway: "example",
          operation: "refunds.create",
          kind: "mutation",
          method: "POST",
          url: `https://x/${EXAMPLE_SECRET}`,
          attempt: 1,
        });

        return mutationRequest(context).catch((error: unknown) => {
          throw error instanceof ApiError || error instanceof OutcomeUnknownError ? new Error(EXAMPLE_SECRET) : error;
        });
      },
    };
    const problems = await checkMutation(leaking, [EXAMPLE_SECRET]);
    expect(problems).toContain("the error for refunds.create after HTTP 503 contains a configured secret");
    expect(problems).toContain("the hook events for refunds.create after HTTP 400 contains a configured secret");
  });
});

describe("checkClient and findLeaks", () => {
  it("reports a client that exposes a secret", () => {
    expect(checkClient({ client: { secretKey: EXAMPLE_SECRET }, secrets: [EXAMPLE_SECRET] })).toEqual(["the client contains a configured secret"]);
    expect(checkClient({ client, secrets: [EXAMPLE_SECRET], inspect })).toEqual([]);
  });

  it("ignores empty secrets", () => {
    expect(findLeaks([""], [{ label: "x", text: "anything" }])).toEqual([]);
  });
});
