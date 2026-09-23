# Honcho integration

## Contract

Codex and Claude share the configured user peer within isolated destinations.
Each profile specifies its account and workspace. Assistant peers remain `codex`
and `claude`. Machine-specific identities and operational records are kept in
private local configuration and backups outside this repository.

Normal launches require no profile choice. New unknown folders default to
the configured default profile. Registered projects, exact registered remotes and Git worktrees retain
their assigned area. Conflicting evidence stops memory operations. A conversation
has one immutable destination; changing area requires a new conversation.

Hooks and MCP use the same SQLite route and receipt ledger. Every MCP call
requires the injected `route_id`; ambient credentials, process working directory
and last-active-directory caches must not choose a destination. Missing or invalid
credentials never fall back to another account. Native Codex memory stays disabled.

Uploads retain original authors and timestamps, filter private/internal transcript
channels, and use stable source IDs. Uncertain write outcomes are checked against
remote receipts, never blindly retried. Existing history and original queues are
retained. Recovery uploads only verified missing history to a verified destination.
Unknown legacy material does not inherit the new-session default profile.

Session context returns messages and any available summary without requesting a
peer perspective. Explicit MCP chat requests have a 120-second API deadline and
150-second client deadline; automatic recall and other API requests retain their
eight-second deadline. SDK retries remain disabled.

Conclusion writes retain their operation ID and successful result. An atomic
claim permits only one concurrent request. HTTP 400/401/403/404/413/422/429 records
a definitive rejection and permits another explicit attempt. Network failures,
timeouts, server errors and interrupted attempts remain uncertain and cannot be
automatically replayed. Route-specific status and hook health include conclusion
failures; successful recall cannot hide them. Legacy operations retain their
receipts, and operations without route ownership appear in global status only.

## Tasks and evidence

- [x] T1 Shared profiles, repository resolver, immutable routes and upload ledger.
- [x] T2 Shared MCP bridge and source-backed Codex/Claude lifecycle adapters.
- [x] T3 Idempotent installation, backups, rollback and revised memory instructions.
- [x] T4 Credential verification, workspace restoration and visible failures.
- [x] T5 Verified legacy recovery with remote read-back and durable report.
- [ ] T6 Offline checks, installed transport checks, live cross-client isolation,
      desktop/terminal verification and task-scoped commit.
- [x] T7 Repair session context, separate chat deadlines, classify conclusion
      failures, migrate operation ownership and expose complete write health.

2026-09-22: 14 offline checks pass. All six client/area combinations pass live
MCP, author, isolation and recall checks. Fresh normal Codex and Claude CLI runs selected their expected configured areas. Current desktop hooks inject the
new route. Existing desktop MCP catalog remains from before installation: restart
the desktop client and verify `honcho/status` to close desktop acceptance. No
browser/native application control is available in this session.

Recovery restored and read back 20,857 public messages across 464 conversations.
Another 11 conversations needed no upload; 641 existing messages matched exactly.
Held 132 conversations with unverified destinations and 1,955 message comparisons
with timestamp/chunk ambiguity. No recovery upload was left blocked. Remote legacy
history and local source queues were retained. Uploads are enabled.

Detailed receipts and backup locations: `VERIFICATION.md`.

Installer follow-up: ordinary Claude rewrites of `.claude.json` must not produce
format-only installation changes. Covered by the installation regression check.

Compatibility follow-up, 2026-09-22: build and 21 offline checks pass. All 84 live
read calls pass across both clients and three areas; all five chat reasoning
levels pass through each client. Fresh normal Codex and Claude processes return
the new conclusion-health fields and correct configured routes.
The current desktop session now exposes the maintained 16-tool catalog, but its
already-running bridge still returns the earlier status shape. Reload the Honcho
MCP connection and verify the new `conclusions` field to close T6. A fresh CLI or
direct STDIO process is not evidence of that desktop reload.

Local tests are not proof of desktop activation or live acceptance. External access
or client-restart blockers must remain explicitly open in this ledger.
