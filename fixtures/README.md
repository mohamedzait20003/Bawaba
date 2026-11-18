# Fixtures

Scrubbed callbacks and API responses, one folder per gateway. This folder is the **single source of truth**: `@bawabajs/testing` copies it into its build, and the contract tests and docs read it from here.

Files here are stored byte for byte (`.gitattributes` disables line-ending conversion), because signatures cover the exact bytes.

## Format

One JSON file per scenario, named `<source>-<scenario>.json` (for example `sandbox-webhook-paid.json`):

```jsonc
{
  "gateway": "paytabs",
  "scenario": "webhook-paid",
  "description": "IPN for a paid sale, captured in the KSA sandbox.",
  "source": "sandbox",                 // "sandbox" (captured) or "synthetic" (written from the docs)
  "recordedAt": "2026-11-20T10:00:00.000Z",
  "sandboxAccount": "paytabs-ksa-test-1", // an alias, never an account ID
  "secret": "test_server_key_do_not_use", // the TEST secret the payload was re-signed with
  "signedString": "...",               // what the signature covers (never contains the secret)
  "expectedSignature": "...",
  "request": {
    "rawBody": "...",                  // exactly as received, as a string
    "headers": { "signature": "..." },
    "query": {}
  }
}
```

## Scrubbing rules

Before committing a captured payload:

1. **Replace credentials:** every key, secret, phrase, password and token becomes a visibly fake value containing `test`, `fake` or `do_not_use`.
2. **Replace personal data:**
   - names become `Test Customer`;
   - emails go on `example.com`;
   - phones become `+20100000000x`;
   - addresses become placeholders.
3. **Replace card data:** use a public test card number, or keep only a masked PAN (`411111******1111`). Never commit a BIN and last 4 digits from a real card.
4. **Replace merchant and account IDs** with marked fakes (`MID-0000-0000`).
5. **Re-sign the scrubbed payload** with the test secret, and update `signedString` and `expectedSignature`.
6. **Record evidence:** keep `source: "sandbox"` only if the original payload verified against its real signature before scrubbing, and say so in `description`.

`pnpm check:secrets` fails on credentials that aren't visibly fake, real email domains and real card numbers in this folder.

## Proof rule

Only `source: "sandbox"` fixtures can move a capability from `beta` to `supported`. Synthetic fixtures test our reading of the docs; they prove nothing about the gateway.

## Third-party data

Fixtures copied from another project (for example Sarraf's Apache-2.0 Kashier fixtures) must keep their attribution and licence in `THIRD_PARTY_NOTICES.md`, and must say in `description` that they were copied and changed.
