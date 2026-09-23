# Verification

## Local checks

Run `npm run check` to build the adapter and test configuration, routing, pinned
identities, message filtering, receipt handling, conclusion health, protocol
framing, installation, idempotence and rollback. Tests use fictional identities
and temporary directories. They do not require personal configuration or live keys.

Configuration coverage includes arbitrary defaults and user peers, relative and
home-relative paths, custom client locations, paths with spaces, generated hooks
and MCP entries sharing state, checkout relocation, and configured recovery paths.

## Installed and live checks

Use the private registry with `--config PATH`. `status` and `resolve` inspect local
state. `doctor` probes the configured destinations. Verification scripts operate
on configured profiles; `verify-live.mjs` writes retained test receipts and
`verify-compatibility.mjs` reads existing verification sessions.

Keep installation reports, backups, route/session IDs, recovery reports, and live
verification receipts in private local state outside the repository. Original
machine-specific historical notes were archived outside the project during the
configuration cleanup. They are not current acceptance evidence.

A successful standalone MCP check does not prove an already-open desktop client
reloaded. After installation, verify `honcho/status` from a fresh conversation in
each client. Preserve any outstanding desktop acceptance item until that happens.

Rollback protects against overwriting subsequent edits and restores configuration
only. It does not remove remote messages, source transcripts, or ledger receipts.
