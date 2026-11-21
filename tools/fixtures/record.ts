// Fixture recorder: scrubs a captured callback, re-signs it with the test secret and writes
// fixtures/<gateway>/<source>-<scenario>.json. Without a signer for the gateway it writes a draft instead.
// Run: node --experimental-strip-types tools/fixtures/record.ts <capture.json> --scenario <name> --source <sandbox|synthetic>
//        --description "<text>" [--account <alias>] [--verified-original] [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { Capture } from "../capture/capture.ts";
import { Scrubber } from "./scrub.ts";
import { FIXTURE_TEST_SECRET, SIGNERS } from "./signers.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const SCENARIO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message: string, code = 1): never {
  console.error(`record: ${message}`);
  process.exit(code);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: "string" },
    source: { type: "string" },
    description: { type: "string" },
    account: { type: "string" },
    "verified-original": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const capturePath = positionals[0] ?? fail("pass the capture file (from the receiver or tools/.captures/)");
const scenario = values.scenario ?? fail("--scenario is required");
const source = values.source;
const description = values.description ?? fail("--description is required");

if (!SCENARIO.test(scenario)) fail("--scenario must be kebab-case, such as webhook-paid");
if (source !== "sandbox" && source !== "synthetic") fail('--source must be "sandbox" or "synthetic"');
if (source === "sandbox" && values.account === undefined) fail("a sandbox fixture needs --account <alias> (an alias, never an account ID)");
if (source === "sandbox" && !values["verified-original"]) {
  fail("pass --verified-original only after the captured payload verified against its real signature (fixtures/README.md, rule 6)");
}

const capture = JSON.parse(readFileSync(capturePath, "utf8")) as Capture;
const scrubber = new Scrubber();
const scrubbed = scrubber.scrubCapture(capture);
const signer = SIGNERS[capture.gateway];

console.log(`scrubbed: ${JSON.stringify(scrubber.counts)}`);

if (signer === undefined) {
  const draft = join(ROOT, "tools", ".captures", "drafts", `${capture.gateway}-${scenario}.json`);

  mkdirSync(dirname(draft), { recursive: true });
  writeFileSync(draft, `${JSON.stringify({ gateway: capture.gateway, scenario, request: scrubbed }, null, 2)}\n`);
  fail(`no re-signing signer for ${capture.gateway} yet (it is added on the gateway's build day). Draft written to ${draft}; it is not a fixture.`, 2);
}

const resigned = await signer(scrubbed, FIXTURE_TEST_SECRET);
const target = join(ROOT, "fixtures", capture.gateway, `${source}-${scenario}.json`);

if (existsSync(target) && !values.force) fail(`${target} exists; pass --force to replace it`);

const fixture = {
  gateway: capture.gateway,
  scenario,
  description,
  source,
  recordedAt: capture.receivedAt,
  ...(values.account === undefined ? {} : { sandboxAccount: values.account }),
  secret: FIXTURE_TEST_SECRET,
  signedString: resigned.signedString,
  expectedSignature: resigned.expectedSignature,
  request: resigned.request,
};

writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${target}. Run pnpm check:secrets, then review it before committing.`);
