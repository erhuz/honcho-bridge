# Contributing

Small, focused contributions are welcome. For a new feature, describe the current
problem and desired behavior in an issue before proposing a broad redesign.
`SPEC.md` describes a future CLI; it is not a list of commands already available.

## Development

Use Node 24+ and Python 3.11+ with a virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
npm ci --ignore-scripts
npm run check
```

Tests use temporary homes and fictional identities. They may start Git, Python,
and Node subprocesses; restricted sandboxes can block those operations. No live
Honcho API key is needed. Do not run the installer against your real home or run
live verification as part of an ordinary test contribution.

The CI matrix covers Node 24/26 on Linux/macOS. Keep the pinned Node lockfile and
Python requirements in sync with intentional dependency changes. A change to
vendored behavior belongs in the build adapter where possible; preserve upstream
sources, license, and provenance.

## Changes that need particular care

Preserve pinned destinations, original message IDs/timestamps, uncertain receipts,
credential separation, and the rule that conflicting routing evidence stops
access. Never silently switch accounts or delete state to recover from an error.

Test changed behavior with the existing `node:test` suite. For installation changes,
use temporary homes and verify unrelated settings, preview behavior, repeat
installation, and rollback. For documentation changes, check relative links and
run every command you can safely rehearse in a temporary home.

Keep personal configuration, keys, transcripts, SQLite files, and backup manifests
outside the repository. Use synthetic fixtures. Redact diagnostics before sharing.

## Pull requests and bug reports

Explain the observable problem, the change, and what you tested. Mention any
remaining platform or client-version uncertainty. A successful direct MCP test
does not prove a running desktop client has reloaded.

For a bug, include OS, Node/Python/client versions, sanitized error output, and the
smallest reproduction. Do not attach a real registry, ledger, or transcript.
Report security vulnerabilities through [SECURITY.md](SECURITY.md).

Be respectful and focus review on the code and behavior. Contributions are made
under the repository's MIT license; retain third-party notices.
