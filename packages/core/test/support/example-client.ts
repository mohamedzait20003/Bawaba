// A minimal, well-behaved client for an imaginary gateway, used to test the conformance suite itself.
import {
  type FetchLike,
  type HttpClientConfig,
  hmacSha256,
  type IdempotencyStore,
  MemoryIdempotencyStore,
  parseJsonObject,
  pickSigned,
  type RawWebhookRequest,
  Redactor,
  type RequestEvent,
  type ResponseEvent,
  request,
  requireEventType,
  runIdempotent,
  safeEqualHex,
  verifyWebhook,
} from "@bawabajs/core";

export const EXAMPLE_SECRET = "example_secret_do_not_use";
export const EXAMPLE_EVENT_TYPES = ["payment.paid", "payment.failed"] as const;

const SIGNED_FIELDS = ["type", "id", "amount"];

export interface ExampleOptions {
  readonly secret: string;
  readonly fetch?: FetchLike;
  readonly idempotencyStore?: IdempotencyStore;
  readonly onRequest?: (event: RequestEvent) => void;
  readonly onResponse?: (event: ResponseEvent) => void;
}

export interface ExampleEvent {
  readonly type: (typeof EXAMPLE_EVENT_TYPES)[number];
  readonly signed: Readonly<Record<string, unknown>>;
}

export class ExampleClient {
  readonly #secret: string;
  readonly #config: HttpClientConfig;
  readonly #store: IdempotencyStore;

  constructor(options: ExampleOptions) {
    this.#secret = options.secret;
    this.#store = options.idempotencyStore ?? new MemoryIdempotencyStore();
    this.#config = {
      gateway: "example",
      baseUrl: "https://api.example.test",
      headers: { authorization: `Bearer ${options.secret}` },
      redactor: new Redactor([options.secret]),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.onRequest ? { onRequest: options.onRequest } : {}),
      ...(options.onResponse ? { onResponse: options.onResponse } : {}),
    };
  }

  refund(params: { paymentId: string; amount: string; idempotencyKey?: string }): Promise<unknown> {
    const call = {
      store: this.#store,
      key: params.idempotencyKey,
      gateway: "example",
      operation: "refunds.create",
      params: { id: params.paymentId, amount: params.amount },
    };

    return runIdempotent(call, async () => {
      const response = await request(this.#config, {
        method: "POST",
        path: "/payments/{id}/refunds",
        pathParams: { id: params.paymentId },
        kind: "mutation",
        operation: "refunds.create",
        json: { amount: params.amount },
      });

      return response.data;
    });
  }

  verify(input: RawWebhookRequest): Promise<ExampleEvent> {
    return verifyWebhook(input, {
      gateway: "example",
      verify: async (webhook) => safeEqualHex(await hmacSha256(this.#secret, webhook.bytes), webhook.headers["x-signature"]),
      parse: (webhook) => {
        const body = parseJsonObject(webhook.body);

        return { type: requireEventType(body.type, EXAMPLE_EVENT_TYPES, "example"), signed: pickSigned(body, SIGNED_FIELDS) };
      },
    });
  }

  async inspect(input: unknown): Promise<{ valid: boolean; reason: string }> {
    try {
      await this.verify(input as RawWebhookRequest);

      return { valid: true, reason: "verified" };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.name : "unknown" };
    }
  }
}

export async function signedRequest(body: string, secret: string = EXAMPLE_SECRET): Promise<{ rawBody: string; headers: Record<string, string> }> {
  return { rawBody: body, headers: { "x-signature": await hmacSha256(secret, body) } };
}
