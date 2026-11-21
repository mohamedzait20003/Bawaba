# Validation tooling

Tools for capturing real sandbox callbacks and turning them into fixtures (TECHNICAL_SPECIFICATIONS §12). Never published; tested by the `tools` Vitest project and type-checked by `pnpm typecheck`.

| Tool | Purpose |
|---|---|
| [`webhook-receiver/`](webhook-receiver/README.md) | A Cloudflare Worker that stores raw callbacks in KV: the permanent public endpoint registered in each sandbox |
| `capture-server.ts` | The same capture on your machine, for an interactive session behind a tunnel |
| `fixtures/record.ts` | Scrubs a capture, re-signs it with the test secret and writes `fixtures/<gateway>/<source>-<scenario>.json` |
| `fixtures/scrub.ts` | The byte-preserving scrubber the recorder uses |

Raw captures and drafts go in `tools/.captures/`, which is git-ignored: they may hold sandbox personal data.

## Local capture with a tunnel

```sh
node --experimental-strip-types tools/capture-server.ts 8787
cloudflared tunnel --url http://localhost:8787     # or: ngrok http 8787
```

Register `https://<tunnel host>/hooks/<gateway>` (and `/hooks/<gateway>/redirect`) in the sandbox, run the payment, and each callback lands in `tools/.captures/<gateway>/`.

## Recording a fixture

```sh
node --experimental-strip-types tools/fixtures/record.ts <capture.json> --scenario <kebab-case> --source <sandbox|synthetic> \
  --description "<what it is and where it was captured>" [--account <alias>] [--verified-original] [--force]
```

1. **Scrubs** names, emails, phones, addresses, card numbers and masked PANs, credentials, merchant IDs and IP addresses ([fixtures/README.md](../fixtures/README.md)). It replaces values in place and never re-serializes, so every other byte stays as captured. It prints how many values of each kind it replaced; it never prints them.
2. **Re-signs** the scrubbed payload with `test_secret_do_not_use`, using the gateway's signer in `fixtures/signers.ts`. Signers are added on each gateway's build day from its independent `@bawabajs/testing` signer. **Until then the recorder writes a draft** to `tools/.captures/drafts/` and exits with code 2: a draft is not a fixture.
3. **Writes** the fixture. `--source sandbox` needs an `--account` alias and `--verified-original`, which you pass only after the captured payload verified against its real signature (rule 6).

Then run `pnpm check:secrets` and read the fixture before committing it.
