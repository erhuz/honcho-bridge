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

## Source-release rehearsal — 2026-09-23

A clean temporary checkout and home passed a fresh dependency installation,
`npm run check` (24 tests), installer preview/apply, paused-state verification,
repeat installation with no changes, and guarded rollback. The checkout path
contained a space. This run used Linux, Node v26.8.2, and Python 3.14.7; no live
Honcho writes were performed.

The locked npm dependency audit reported zero known vulnerabilities. Local
documentation links, workflow YAML, setup-skill structure, and whitespace checks
passed. These checks do not constitute a complete security audit.

The Linux/macOS × Node 24/26 workflow is prepared but has not run for these changes.
Fresh desktop activation and cross-platform release acceptance remain open.

## Alpha release rehearsal — 2026-10-01

A fresh temporary source copy and home passed dependency installation in an
isolated Python environment, `npm run check` (25 tests), installer preview/apply,
paused-state verification, explicit project routing with `defaultProfile: null`,
repeat installation with no changes, and rollback. The checkout path contained a
space. This run used Linux x86_64, Node v26.8.2, and Python 3.14.7.

The locked npm audit reported zero known vulnerabilities. All 34 local
documentation links passed. Review of the tracked file list and two-commit history
found no private configuration, transcripts, ledgers, operational backups, or
matches for the checked secret-token patterns. Root and upstream MIT notices and
adapter provenance are retained. GitHub private vulnerability reporting is enabled.

The previous source-preparation commit passed the Linux/macOS × Node 24/26
[CI matrix](https://github.com/erhuz/honcho-bridge/actions/runs/35881534888).
The release notes record CI for the release commit. Fresh desktop activation and
live Honcho acceptance remain unverified; no live service calls were made during
this rehearsal. These checks do not constitute a complete security audit.
