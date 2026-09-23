# Honcho Bridge CLI plan

Status: ready for implementation. No public CLI has been implemented by this plan.
The user selected Linux and macOS and MIT licensing on 2026-09-23.
[SPEC.md](SPEC.md) defines the command and acceptance contracts.

## Approach

Package the working Node bridge as one executable, `honcho-bridge`. Keep its SQLite
ledger, project resolver, capture/delivery logic, MCP tools and isolated Claude
recall adapter. Add a strict command dispatcher, account/profile setup, a Node
installer and portable packaging. Do not build a daemon, HTTP service or UI.

Normal use stays automatic: assign repositories once, then start Codex or Claude
normally. An unknown directory uses the configured default for a new conversation;
an existing conversation retains its original destination. Conflicting evidence
stops memory access and reports the rules that disagree.

## Starting point and gaps

The repository was imported at `bea0910`. Its 21 offline checks passed at import.
Those checks cover the existing integration; CLI acceptance remains open.

| Existing code | Keep or change for v0.1 |
| --- | --- |
| `src/cli.mjs` loads runtime before dispatch and prints JSON | Parse/help/version first; add human output, a stable JSON envelope, strict flags and useful exit status. |
| v1 profiles repeat credential paths and assume personal fallback | v2 accounts own keys; profiles select account/workspace/user; make the default explicit. Bind config and ledger with one registry ID. |
| Project resolver and immutable route ledger | Reuse; expose assignment commands and conflict explanations. |
| Receipt-based message delivery and atomic conclusion claims | Preserve IDs, uncertainty rules, deadlines and complete health reporting. |
| `scripts/install.py` contains this machine's users, roots and wrappers | Replace public installation with Node edits, an ownership manifest, private backups, conflict checks and guarded removal. |
| Claude recall is built from attributed upstream source | Keep the adapter and its build for v0.1; ship its required runtime assets and notices. |
| Maintenance doctor only probes profiles | Add local setup/conflict/version checks, offline mode and failing exit status for unhealthy checks. |
| Private package, no bin or allowlist | Add an executable and test the packed artifact outside the checkout. Current pack contents omit required dist files. |
| Machine-specific README/SPEC/verification history | Write generic product docs during implementation. Retain historical evidence privately; review Git history before public export. |

The old specification is retained in
[docs/legacy-integration-spec.md](docs/legacy-integration-spec.md). Its outstanding
desktop reload check stays historical and open; neither this plan nor a future
CLI test run retroactively completes it.

## First-run experience

These are planned commands, not commands available in the current checkout:

```sh
honcho-bridge init --workspace personal --user alex
# Prompts for the personal key without echoing it. Uploads begin paused.
honcho-bridge account add work
honcho-bridge profile add work --account work --workspace engineering --user alex
honcho-bridge project assign work ~/repos/work/service
honcho-bridge resolve ~/repos/work/service
honcho-bridge install both --dry-run
honcho-bridge install both --disable-native-memory
honcho-bridge doctor
# Approve/reload clients and verify honcho/status in each client.
honcho-bridge resume
```

`init` configures an existing Honcho workspace; it does not create an account or
issue a key. Noninteractive setup supplies `--key-stdin` or `--key-file PATH`.
For one client, use `install codex` or `install claude`. The optional
`--disable-native-memory` flag makes Codex's second memory store opt-in to disable;
the current user's already-disabled setting is preserved on normal installation.

For maintenance: `account set-key`, `status`, `doctor --offline`, `pause`, `resume`
and `flush`. A paused queue remains local; resume does not blindly retry uncertain
writes. `uninstall` preserves unrelated client edits and all memory data;
`rollback` restores a backup only when the affected files have not changed.

## Implementation decisions

- **Stay in Node.** Use `node:util.parseArgs` and the existing `node:sqlite` ledger.
  Use `smol-toml` 1.9.0 for the Node installer; first-edit TOML formatting/comments
  may change, so preserve original bytes in backups and test semantic round trips
  with integer/float type preservation. Unsupported values must block the edit.
  No CLI framework, Python runtime or new test framework is needed.
- **Config chooses state.** Store one absolute state path in config. Installed hook
  and MCP commands pass the same explicit config path; the ledger must match its
  registry ID. This prevents independently chosen flags from splitting the pair.
- **Keep secrets separate.** Each account owns a mode-0600 JSON credential file.
  Profiles reference the account. Rotate a key without changing pinned identities.
  Never migrate credentials through argv, logs or Git.
- **Make installation reversible.** Preview the full transaction, then back up and
  write only owned settings. Existing foreign Honcho entries block installation
  until manually resolved. No automatic disabling of arbitrary shell scripts,
  plugins or other memory systems.
- **Distinguish setup from activation.** Expose the bridge version through MCP and
  record last-observed starts. On-disk configuration and standalone transport checks
  cannot establish what an already-running desktop client has loaded.
- **Import once into empty state.** Add a local v1 import with preview/apply, a
  consistent SQLite backup including WAL, copied credentials and identity/count
  checks. Require old writers stopped, keep the target paused, and preserve the
  source. Remote recovery and merging two ledgers are outside v0.1.
- **Keep the public artifact small.** Allowlist runtime modules, dist assets, skill,
  generic docs and license/provenance files. Keep development fixtures and private
  operational history out of the npm package.

## Build order and completion evidence

Work sequentially; each step consumes the preceding contracts. Task IDs and full
acceptance details live in SPEC.md IX.

| Task | Deliverable | Evidence before completion |
| --- | --- | --- |
| CLI-01 | Entrypoint, schema v2 and config/state pairing | Empty-home help/version, strict parsing, JSON/errors, no unintended state creation. |
| CLI-02 | Init and account/profile management | Private key input/rotation, atomic concurrent edits and referenced-delete guards. |
| CLI-03 | Project assignments and resolution | Repository/worktree/remote/root cases; conflicting rules and resumed pins. |
| CLI-04 | Public runtime and diagnostics | All 16 tools, correct hooks, deadlines, version/health evidence and preserved delivery semantics. |
| CLI-05 | Node install/uninstall/rollback | Both client fixtures, idempotence, conflicts, user edits, partial failures and safe rollback. |
| CLI-06 | Local v1 import | WAL-consistent copy, same IDs/receipts/uncertainty, unchanged source, paused target. |
| CLI-07 | Package, MIT/attribution and generic docs | Packed install without Python/checkouts, complete assets and publication cleanup review. |
| CLI-08 | CI and release verification | Linux/macOS on Node 24/26 plus explicit fresh-client/live acceptance. |

Rework existing tests only where the public schema/entrypoint changes; retain their
routing and delivery assertions. Add focused CLI and installer fixtures using the
existing Node test runner. Network access is forbidden in ordinary tests. Test the
actual tarball in isolated homes and prefixes, not just source imports.

Live acceptance uses dedicated test workspaces and explicit write probes. It must
verify both client routes, separation between areas, all chat reasoning levels and
current status fields. Track desktop activation separately. An unavailable client
or service leaves the corresponding release check open.

## Rollout and publication gates

Implementation in this repo must not switch the current installed bridge. Rehearse
the import against copied fixture state first. A real cutover requires old clients
and writers stopped, the final import, removal of reported legacy integrations,
new installation, doctor, client approval/reload and in-client status before resume.

Prepare a sanitized public export before pushing: the first commit contains local
operational names and records, so deleting files at HEAD is insufficient. Preserve
private records outside the published history. Do not rewrite this local history
as an incidental implementation step. Check the eventual npm package name/scope
and GitHub owner at release time; neither is assumed by the executable name.

No GitHub remote, push, npm publication or installation change is part of this plan.

## Primary references

Consulted for the planned contracts on 2026-09-23:

- [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/):
  executable bin mapping, shebang and explicit files allowlist; verify the resulting
  tarball rather than assuming ignored build output is included.
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli):
  STDIO server configuration and tool_timeout_sec. Keep the bridge's 150-second
  client deadline above its 120-second chat request deadline.
- [Claude Code MCP](https://code.claude.com/docs/en/mcp): per-server timeout is in
  milliseconds; retain 150000 and test the supported client version.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): lifecycle JSON and
  hookSpecificOutput.additionalContext; preserve valid output without blocking work
  on memory failure.
- [smol-toml source](https://github.com/squirrelchat/smol-toml): Node TOML parser and
  serializer selected to replace the installer's Python dependency.
- [Existing source and provenance](vendor/claude/PROVENANCE.json) and
  [upstream MIT notice](vendor/claude/LICENSE): retain attribution for the adapter.
