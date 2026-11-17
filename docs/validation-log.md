# Validation log

What has been confirmed against a real gateway sandbox, where and when. This log is the evidence behind every capability level: an operation is `supported` only if an entry here proves it, with a `source: "sandbox"` fixture.

**How to add an entry:**
1. Run the scenario in the sandbox and capture the raw request, response and callback with the fixture recorder (`tools/`).
2. Scrub and re-sign it (see [fixtures/README.md](../fixtures/README.md)), then commit it under `fixtures/<gateway>/`.
3. Add a row below, close the uncertainty-register IDs it settles, and update the gateway spec file and its capability table.
4. Do all of this in the same pull request as the code it proves.

| Date | Gateway | Sandbox (alias) | What was tested | Result | Fixture | Register IDs closed |
|---|---|---|---|---|---|---|

*No entries yet. No gateway sandbox has been accessed (17 November 2026).*
