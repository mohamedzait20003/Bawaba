import {
  type ConformanceSubject,
  checkCapabilities,
  checkClient,
  checkInspect,
  checkMoney,
  checkMutation,
  checkSubject,
  checkWebhook,
} from "./conformance/checks.js";

export * from "./conformance/checks.js";
export { VERSION } from "./index.js";

// Vitest is ESM-only and refuses require(), so it is loaded only when the suite runs: requiring this entry stays safe.
// Call it with top-level await in a test file: `await runConformanceSuite(subject)`.
export async function runConformanceSuite(subject: ConformanceSubject): Promise<void> {
  const { describe, expect, it } = await import("vitest");
  const { secrets, inspect } = subject;

  describe(`${subject.gateway} conformance (@bawabajs/core/conformance)`, () => {
    it("declares its operations, secrets, webhooks and mutations", () => {
      expect(checkSubject(subject)).toEqual([]);
    });

    it("declares a capability level for every operation", () => {
      expect(checkCapabilities(subject)).toEqual([]);
    });

    it("round-trips Money for every supported currency", () => {
      expect(checkMoney(subject.money)).toEqual([]);
    });

    it("never reveals a secret through the client object", () => {
      expect(checkClient(subject)).toEqual([]);
    });

    for (const webhook of subject.webhooks) {
      it(`${webhook.name}: verifies the raw body and fails closed`, async () => {
        expect(await checkWebhook(webhook, secrets, inspect)).toEqual([]);
      });

      it(`${webhook.name}: inspect never throws and never reveals a secret`, async () => {
        expect(await checkInspect(webhook, secrets, inspect)).toEqual([]);
      });
    }

    for (const mutation of subject.mutations) {
      it(`${mutation.operation}: never retried, OutcomeUnknownError keeps the claim, a 4xx releases it`, async () => {
        expect(await checkMutation(mutation, secrets, inspect)).toEqual([]);
      });
    }
  });
}
