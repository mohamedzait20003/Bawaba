import type { ScrubbedRequest } from "./scrub.ts";

export const FIXTURE_TEST_SECRET = "test_secret_do_not_use";

export interface ResignedRequest {
  readonly request: ScrubbedRequest;
  readonly signedString: string;
  readonly expectedSignature: string;
}

export type FixtureSigner = (request: ScrubbedRequest, secret: string) => Promise<ResignedRequest>;

// Re-signs a scrubbed callback with the test secret. One entry per gateway, added on that gateway's build day
// from its independent @bawabajs/testing signer. Until then the recorder only writes drafts.
export const SIGNERS: Readonly<Record<string, FixtureSigner | undefined>> = {};
