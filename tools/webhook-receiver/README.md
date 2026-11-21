# Webhook receiver

A Cloudflare Worker that stores every gateway callback it receives, byte for byte, in Workers KV for 30 days. It is the permanent public HTTPS endpoint from TECHNICAL_SPECIFICATIONS §12. It's validation tooling: never published, and **never pointed at a live gateway account**.

## Routes

| Route | What it does |
|---|---|
| `ANY /hooks/<gateway>` | Stores the callback and answers `200 OK`. `<gateway>` is one of `paymob`, `kashier`, `fawry`, `geidea`, `paytabs`, `payfort`, `tap`. |
| `ANY /hooks/<gateway>/<label>` | The same, with a label such as `redirect` or `subscription` (lowercase letters, digits and `-`) |
| `GET /captures/<gateway>` | Lists the stored captures (up to 100; pass `?cursor=` for more). Needs `Authorization: Bearer <READ_TOKEN>`. |
| `GET /captures/<gateway>/<key>` | Returns one capture as JSON. Same token. |

A capture keeps the method, path, raw query string, headers and the raw body (base64). It drops credentials and proxy headers (`authorization`, `cookie`, `cf-*`, `x-forwarded-*` and the like). Bodies over 1 MiB are refused.

## Deploy (the lead, once)

From this folder, with a free Cloudflare account:

```sh
npx wrangler login
npx wrangler kv namespace create CAPTURES      # paste the printed id into wrangler.toml
npx wrangler secret put READ_TOKEN             # a long random value; keep it in your password manager
npx wrangler deploy                            # prints https://bawaba-webhook-receiver.<account>.workers.dev
```

The namespace id is not a secret. `READ_TOKEN` is: it lives only in Cloudflare and your password manager.

## Register it in the sandboxes

Use `https://bawaba-webhook-receiver.<account>.workers.dev/hooks/<gateway>` as the callback (webhook, notification or IPN) URL, and `.../hooks/<gateway>/redirect` as the return URL, in each **test** account:

- Paymob: the integration's transaction processed and response callbacks;
- Kashier: the webhook URL and the merchant redirect;
- every other gateway as its sandbox access arrives (see each spec file's validation checklist).

## Read a capture and turn it into a fixture

```sh
curl -H "Authorization: Bearer $READ_TOKEN" https://<receiver>/captures/paymob
curl -H "Authorization: Bearer $READ_TOKEN" "https://<receiver>/captures/paymob/<key>" -o tools/.captures/paymob-paid.json
node --experimental-strip-types tools/fixtures/record.ts tools/.captures/paymob-paid.json --scenario webhook-paid --source sandbox \
  --account paymob-eg-test-1 --verified-original --description "Transaction callback for a paid card payment, captured in the EG sandbox."
```

`tools/.captures/` is git-ignored. The recorder is described in [../README.md](../README.md).
