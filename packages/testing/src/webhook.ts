export interface WebhookRequestInput {
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
}

export interface TestWebhookRequest {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

// Serializes an object body once, so the bytes a test signs are the bytes it sends.
export function webhookRequest(input: WebhookRequestInput): TestWebhookRequest {
  return {
    rawBody: typeof input.body === "string" ? input.body : JSON.stringify(input.body),
    headers: input.headers ?? {},
    query: input.query ?? {},
  };
}
