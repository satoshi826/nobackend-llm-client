# Security policy

What the security design protects, and where it stops: [docs/security.md](docs/security.md) ([日本語](docs/security.ja.md)).

## Supported versions

Only the newest version gets fixes: the newest commit on `main`, and the latest release when there is one. Older builds are not patched; update to the newest.

## Reporting a vulnerability

Report it privately with GitHub's private vulnerability reporting: on this repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/satoshi826/nobackend-llm-client/security/advisories/new)). Do not open a public issue or pull request for it, and do not disclose it publicly until a fix is out.

Reports in English or Japanese are welcome.

## What to include

- The commit you tested (Settings → About shows it), and whether it was the default deployment or the strict setup, on which host.
- The browser and its version, and the operating system.
- Steps to reproduce, with a proof of concept if you have one.
- What an attacker gains: keys, conversations, files, sending data out, spending money, or something else.

Do not include real API keys, passphrases or conversations. Use spend-limited test keys, or the mock server (README, "Try it without real APIs").

The limits listed in [docs/security.md](docs/security.md) §4 are known. A report that shows one of them is worse than described there, or a way around a protection in §3, is in scope.

## What to expect

This is a project maintained in spare time. Reports are handled on a best-effort basis: there is no fixed time for a reply or a fix. You will be told whether the report is accepted, and credited in the advisory if you want to be.

There is no bug bounty.
