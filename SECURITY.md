# Security policy

Bawaba verifies payment callbacks and calls money-moving APIs, so security bugs here can cost real money. Thank you for reporting them responsibly.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's **"Report a vulnerability"** button on this repository's Security tab (private vulnerability reporting).

Please include:
- the affected package and version;
- the gateway involved;
- a description and, if possible, a minimal reproduction using **sandbox or fake data only**.

## What counts

Especially:
- a webhook or redirect verifier that accepts a forged or modified callback, or that runs logic before verification;
- a money-moving call that can be retried, or reported as retryable, when its outcome is unknown;
- secrets or personal data leaking into errors, logs, hooks or `inspect` output;
- anything that lets an attacker influence amounts, currencies or payment status.

## Our commitments

- **Acknowledgement** within 3 working days, and an assessment within 10.
- **Fixes:** a fix and release for confirmed issues, with credit to the reporter unless they prefer otherwise.
- **Advisories:** a GitHub security advisory for every confirmed verifier bug.

## Supported versions

Bawaba is pre-1.0. Only the latest published version receives fixes.
