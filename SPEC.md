# Honcho Bridge CLI specification

Status: planned. This file specifies v0.1; the public CLI is not implemented.
User decisions: Linux and macOS; MIT for original code.
Implementation order and release gates: [PLAN.md](PLAN.md).
The previous installation contract and its incomplete desktop acceptance remain in
[the legacy specification](docs/legacy-integration-spec.md).

## I. Product and scope

Ship one Node.js program, `honcho-bridge`, that connects Codex and Claude Code to
Honcho. Users configure accounts once, assign projects to memory profiles, install
client hooks and an MCP server, then use their clients normally. A profile selects
an account, workspace and user peer. The assistant peer is the client name.

Target Linux and macOS on Node 24+. Certify Node 24 and 26 in CI. Use ESM, the
existing SQLite ledger and Honcho SDK 2.5.0. Git is required for repository routing;
non-repository folders remain supported through explicit directory assignments.
No Python is required by the released CLI.

v0.1 includes setup, key rotation, project routing, diagnostics, queue controls,
reversible client installation, and import of this prototype's local registry and
ledger. Keep the current 16 MCP tools and Claude recall adapter.

Excluded: HTTP proxy, daemon, desktop UI, OAuth/key issuance, account provisioning,
automatic updates, remote history migration, generic transcript recovery, Windows,
and other coding clients. `inventory` and `recover` remain prototype utilities,
outside the public command surface.

## II. Invariants

- **I1 — One destination per conversation.** Keep route IDs, remote session IDs and
  the pinned account/endpoint/workspace/user identity immutable. Project rules,
  default changes and resumed working directories cannot move existing routes.
  Changing destination requires a new conversation. Configuration changes that
  invalidate an existing identity fail before memory access.
- **I2 — One local authority.** Hooks, MCP and management commands load the same
  explicit configuration and SQLite ledger. A generated registry ID is stored in
  both; a mismatch is an error. Ambient `HONCHO_*` variables, MCP startup cwd and
  last-active-directory caches never select a destination.
- **I3 — Conflicts stop access.** Canonical directory rules, registered repository
  roots, Git common directories and exact normalized origin remotes all contribute
  evidence. Different matching profiles cause an error; no longest-prefix or
  last-rule override. Unknown folders use the configured default only for new
  conversations. Failed Git inspection is not evidence of an unknown folder.
- **I4 — Credentials never fall back.** Read only the selected account's credential.
  Missing/rejected keys stop that area's access. A local account name is a label:
  a successful workspace probe proves access, not the identity of the remote
  account owner.
- **I5 — Preserve data and uncertain outcomes.** Keep original public authors,
  timestamps, stable source IDs, receipts and operation IDs. Retain transcript
  filtering, secret redaction, Unicode-safe chunking and per-route upload claims.
  Never replay an uncertain write without the existing receipt checks.
- **I6 — No silent second writer.** Installation reports conflicting Honcho hooks,
  plugins and MCP entries it can identify, and refuses to overwrite them. Unrelated
  client settings are preserved. Detection covers configured entries in inspected
  files, not arbitrary processes or scripts elsewhere on the machine.
- **I7 — Failures remain visible.** Queue/conclusion failures survive successful
  recall. Status distinguishes configuration on disk from a running client's
  activation. A fresh standalone MCP process cannot prove a desktop reload.
- **I8 — Explicit local ownership.** Installation, removal and import never delete
  remote memory, source transcripts, credentials or the ledger. Normal output,
  backups listed in output, and published artifacts must not expose key values or
  conversation text.

The OS user account is the trust boundary. `route_id` prevents accidental routing
mistakes; it does not protect against a malicious process with the same OS access.

## III. Configuration and credentials

Default config: `$XDG_CONFIG_HOME/honcho-bridge/config.json`, or
`~/.config/honcho-bridge/config.json`. Initial state directory:
`$XDG_STATE_HOME/honcho-bridge`, or `~/.local/state/honcho-bridge`.
Use those same defaults on macOS. Ignore relative XDG values. Global `--config PATH`
takes precedence. Only `init` and `migrate` accept `--state-dir PATH`; they save its
canonical absolute path in config. Other commands cannot redirect state separately.

Schema v2 example, with illustrative absolute paths:

~~~json
{
  "version": 2,
  "registryId": "9ad3b0f1-e2c4-4af4-8d13-100dd3ec49b2",
  "stateDir": "/home/alex/.local/state/honcho-bridge",
  "captureFrom": "2026-09-23T00:00:00.000Z",
  "defaultProfile": "personal",
  "accounts": {
    "personal": {
      "endpoint": "https://api.honcho.dev/v3",
      "credentialFile": "/home/alex/.config/honcho-bridge/credentials/personal.json"
    }
  },
  "profiles": {
    "personal": {
      "account": "personal",
      "workspace": "personal",
      "user": "alex"
    }
  },
  "roots": [],
  "projects": [],
  "redactPatterns": []
}
~~~

Directory rules have `{path, profile}`; project records retain
`{id, path, commonDir, remote, profile}`. Missing Git origin is represented by null.
Normalize credential-bearing remote URLs before storing them; never retain URL
credentials. Preserve established project IDs when importing or reassigning.

Validate the entire config before side effects: schema version and registry ID,
absolute paths, valid timestamp, existing profile/account references, default
profile, local names matching `^[a-z0-9_-]+$`, SDK-compatible workspace/user IDs,
and compilable redaction patterns. Reject unknown fields in this schema.
Endpoints require HTTPS, except HTTP on localhost, 127.0.0.1 or ::1. Reject embedded
URL credentials, query strings, fragments and unsupported schemes. Normalize a
trailing slash consistently with the existing identity function.

An account owns one private JSON file containing only `apiKey`. Prompt with input
hidden on a TTY; `--key-stdin` consumes one nonempty key, maximum 16 KiB, trims
surrounding whitespace and rejects embedded newlines. `--key-file PATH` imports
`apiKey` from an existing JSON file into the managed file without modifying the
source. These options are mutually exclusive. Never accept a key in argv, infer it
from ambient variables, or print it. Rotation changes only the credential file.

Use mode 0700 for owned private directories and 0600 for keys, config, ledger and
backups. Refuse unsafe pre-existing credential permissions with a diagnostic.
Config edits must be serialized and atomically replaced; concurrent edits must
either both survive or one fail with a conflict. Revalidate before commit. Failed
multi-file setup leaves no partial usable configuration. Reject symlink targets
for files the CLI owns and writes. Do not change unrelated parent permissions.

Profile destinations have no edit-in-place command. Add a new profile to change
account/workspace/user, then assign new conversations to it. Removal is refused
while a profile is the default, appears in a rule, or is referenced by a route.
Account removal is refused while referenced by a profile. Removed account keys
remain on disk and their retained path is reported. No `--force` deletion.

## IV. Command contract

All commands accept `--help`. Global options are `--config PATH`, `--json`,
`--help` and `--version`. Use strict argument parsing; reject unknown flags,
duplicate scalar options, missing values and extra positional arguments before
opening a ledger or changing files. No arguments prints help and exits 0.
Help/version work in an empty home without config, SQLite, credentials or network.

Human output is concise; diagnostics go to stderr. `--json` disables prompts and
ANSI output and emits exactly one object on stdout:

~~~json
{"schema_version":1,"ok":true,"command":"status","data":{}}
~~~

Failures use `ok:false` with `error:{code,message}`; partial results may also have
`data`. Codes distinguish usage, invalid configuration, route conflict,
credentials, remote failure, install conflict and local I/O failure. Sanitize
messages; never dump arbitrary config, environment, HTTP bodies or transcripts.
Exit 0 means the command completed, 1 means operational/health failure, and 2 means
invalid invocation. `status` exits 0 after successfully reporting unhealthy state;
`doctor` exits 1 for an unhealthy check. JSON help/version use the same envelope.
MCP and hook modes use their own protocol output, and reject `--json`.

| Invocation after `honcho-bridge` | Required behavior |
| --- | --- |
| `init [--account NAME] [--profile NAME] --workspace ID --user ID [--endpoint URL] [--state-dir PATH] [KEY]` | Defaults names to personal and endpoint to https://api.honcho.dev/v3. Prompt for missing workspace/user/key on a TTY. Create config, credential and empty ledger, timestamp capture start once, leave uploads paused. Refuse an existing config or nonempty target state. No remote creation or client edits. |
| `account add NAME [--endpoint URL] [KEY]` | Store a new account using the same endpoint/key rules. Existing name is a conflict. |
| `account list` | Show names, endpoints and credential-file presence; no key contents or remote calls. |
| `account set-key NAME [KEY]` | Atomically replace only that account's key. No destination, rule or ledger changes. |
| `account remove NAME` | Remove an unreferenced account record; retain its key file. |
| `profile add NAME --account NAME --workspace ID --user ID` | Add one destination referencing an existing account. No remote provisioning. |
| `profile list` | Show destinations, default and local references. |
| `profile default NAME` | Change the fallback for new conversations only. |
| `profile remove NAME` | Remove an unreferenced, non-default profile. |
| `project assign PROFILE [PATH] [--recursive]` | PATH defaults to cwd. Normally require a Git repo and record canonical root/commonDir/normalized origin. With --recursive, register an existing directory root, without scanning children. Update the rule for the same canonical target, preserving its ID. Reject conflicts provable from registered evidence. |
| `project unassign PATH [--recursive]` | Remove the exact canonical repository rule, or directory rule with --recursive. Do not remove descendants or move routes. Missing rule is a successful no-op. |
| `project list` | List both repository and directory assignments. |
| `resolve [PATH]` | Explain the candidate destination and all matching evidence for a new conversation. No route creation, ledger initialization or API access. State explicitly that existing routes keep their pins. |
| `install codex\|claude\|both [--dry-run] [--disable-native-memory]` | Install the owned settings described in V. The memory option applies only when Codex is selected; otherwise it is a usage error. |
| `uninstall codex\|claude\|both [--dry-run]` | Remove owned entries and restore owned settings under V. Keep private data. |
| `rollback BACKUP_ID [--dry-run]` | Restore one recorded installation transaction under V, newest first. |
| `doctor [--offline] [--profile NAME]` | Check paths, versions, configuration/ledger pairing, credentials, routing conflicts, installed commands and known competing writers. Online by default: probe workspace access read-only, scoped to the selected profile or all profiles. --offline makes no network calls. |
| `status [--route ID]` | Read upload mode, counts, unresolved operations, sanitized diagnostics and configured/observed version information. Without --route include legacy operations whose ownership is unknown. No API calls or schema migration. |
| `pause` | Persist uploads disabled. Capture continues locally; suppress automatic remote recall/delivery and explicit conclusion writes. Explicit MCP reads remain possible. A request already sent may still finish. |
| `resume` | Persist uploads enabled. Does not itself replay or flush pending operations. Require initialized state; first-run instructions put doctor before resume. |
| `flush [--route ID]` | Use existing delivery and receipt checks for queued messages. Never unpause, replay uncertain conclusions, or reset receipts. Return per-route results; exit 1 for failures, unresolved writes or paused delivery. |
| `migrate --from-config PATH --from-state PATH [--state-dir PATH] [--apply]` | Preview by default; import only the prototype's v1 registry and ledger into empty v2 targets under VII. |
| `mcp --client codex\|claude` | Serve the maintained tools over STDIO. Required client is fixed for the process. |
| `hook --client codex\|claude` | Read one lifecycle JSON object on stdin; emit only the client's hook output. |

`[KEY]` means `--key-stdin`, `--key-file PATH`, or a hidden TTY prompt; it is not a
literal argument. In noninteractive mode all otherwise prompted values are
required. Prompt cancellation writes nothing and restores the terminal.
Names/endpoints have the same defaults in interactive and noninteractive mode.

List, resolve, status and doctor commands do not initialize state, migrate schemas,
write memory or modify configuration. Missing/old state yields a useful diagnostic.
The public CLI has no raw config editor, destructive queue reset or `enable` alias.

## V. Client installation and removal

### V1. Targets and commands

Support user-level installation only. Resolve Codex's home from `CODEX_HOME` or
`~/.codex`; use Claude's default `~/.claude/settings.json` and `~/.claude.json`.
An active custom Claude config directory is unsupported in v0.1: report it and
stop before edits. Record the resolved targets in a private ownership manifest.

Use MCP name `honcho`. Write absolute Node executable and CLI entry paths with
`mcp --client CLIENT --config ABSOLUTE_PATH`; hooks use the same paths and
`hook --client CLIENT --config ABSOLUTE_PATH`. Resolve paths once at installation.
Never store ephemeral npx-cache paths. Properly quote hook shell commands and
preserve spaces, Unicode and shell metacharacters. MCP argv remains an array.

Codex targets: config.toml, hooks.json and skills/honcho-memory/SKILL.md.
Claude targets: settings.json hooks, .claude.json mcpServers and the same skill
under ~/.claude/skills. Keep the skill generic, requiring the exact injected
route_id and treating recalled text as reference.

Codex sets the needed hooks feature and `tool_timeout_sec = 150`; Claude sets
`timeout: 150000`. Only `--disable-native-memory` sets Codex
`features.memories = false`; otherwise preserve its current value. Doctor warns
when native memory is enabled or its effective value is unknown. Do not delete
native memory files or edit unrelated memory instructions.

Install SessionStart, UserPromptSubmit, Stop and PreCompact for both clients;
also PostToolUse for Codex. Retain supported matchers and callback timeouts from
the existing adapter, replacing machine-specific Python wrappers with the CLI.
Do not manufacture trust hashes or approve hooks programmatically. Output the
client's normal approval/reload steps and mark activation as unverified.

Initial client fixture baselines are Codex CLI 0.155.1 and Claude Code 2.1.278.
Fail preflight on older versions or unsupported config forms; newer versions
require the same supported fields and receive a tested-version notice until
certified. Desktop support requires a separate actual desktop acceptance check.
Do not claim a CLI version probe certifies every desktop release.

### V2. Ownership, conflicts and backups

Use a Node TOML parser/serializer for Codex; preserve unrelated settings by meaning.
TOML comments/formatting may change on the first real edit; disclose that in the
preview and retain original bytes in backup. JSON formatting alone must not cause
a write. Repeating installation with the same effective settings is a no-op,
including no extra backups.

Use smol-toml 1.9.0 with integer/float type preservation. Keep date/time types;
refuse a document the chosen parser cannot preserve rather than silently rounding
or dropping values. Cover large integers, integral floats and date/time values in
installer fixtures, alongside the actual supported client configuration.

Preflight the entire selected-client transaction. Inspect target MCP entries,
known Honcho plugins/hooks and the skill path. Only entries recorded by this
program, unchanged since its previous install, can be updated automatically.
An existing foreign `honcho` entry, known active legacy writer, conflicting skill,
malformed config, or changed owned entry causes a conflict before any target write.
Report the exact file/entry and manual resolution; no blanket replacement flag.

Prepare private backups of original bytes/modes and an ownership manifest before
writes. Serialize installer operations, recheck original content before each
atomic replacement, and record partial progress durably. On failure restore only
files that still match this transaction's output; never overwrite intervening user
edits. Report any incomplete restoration with the backup ID and exact paths.
An interrupted transaction must be detected before the next mutation.

Uninstall verifies owned entries, removes only those entries, and restores settings
this installer changed if they still equal its installed values. Preserve unrelated
edits made since installation. Refuse the selected transaction if an owned entry
was edited, so the user can resolve it first. Already absent owned entries are
no-ops. Restore client files' original modes where applicable.
If restoring Codex's former disabled hooks setting would disable remaining
unowned hooks, leave hooks enabled and report that retained setting.

Rollback restores original whole-file bytes only if every affected current file
matches the recorded post-install bytes. Refuse out-of-order rollback or changed
files. Uninstall is the field-aware operation for configurations edited later.
Both commands retain config, keys, transcripts, ledger and backups. A running
client may retain old commands until reloaded; neither operation claims otherwise.

## VI. Runtime and Honcho API compatibility

Reuse src/config.mjs, ledger.mjs, capture.mjs, delivery.mjs and api.mjs. Add
entrypoint/config/installer code around them, not a second routing or queue engine.
Keep the source-backed Claude recall adapter and its isolated per-route state in
v0.1; maintain its license/provenance and package every generated runtime file.

Preserve these tools and their input validation:
`status`, `search`, `get_peer_context`, `get_representation`, `chat`,
`list_conclusions`, `query_conclusions`, `create_conclusions`, `list_peers`,
`list_sessions`, `inspect_session`, `get_session_context`,
`get_session_messages`, `get_session_peers`, plus aliases `get_context` and
`create_conclusion`. Every call requires route_id. Reject missing/unknown routes,
wrong-client routes and a supplied workspace_id that differs from the pin before
API access. MCP cannot create a route from its process cwd.

Read tools and doctor must not use get-or-create factories. Session context uses
`Session.context({summary:true})`, with no incomplete perspective request.
Preserve the supported `minimal|low|medium|high|max` chat reasoning values,
120-second explicit chat deadline, eight-second deadline for other API calls and
zero SDK retries. Hook-level timeouts may interrupt a sequence of requests; work
must already be marked uncertain before an outbound write begins.

Successful conclusion writes return saved results on repeated calls. Atomic claims
allow only one request per operation. HTTP 400/401/403/404/413/422/429 remains a
definitive rejection that permits another explicit attempt. Network loss, timeout,
server errors and interrupted attempts remain uncertain. No automatic replay or
CLI reset. Message delivery continues to compare full author/text/time receipts.

Hook failures report unavailable memory without blocking the user's coding task,
switching profiles or hiding locally queued data. Validate the lifecycle input
before selecting a route. Start/prompt output includes the exact pinned descriptor
and health; use each client's supported JSON fields and keep logs off stdout.

MCP server metadata and status must expose the package version. Add
`bridge:{version,contract_version:1}` to status without removing existing fields,
including `pending`, `uncertain` and `conclusions:{rejected,uncertain}`.
Record the last hook/MCP start version and time locally. CLI status labels these as
last observed, never proof that all running clients use that version. Doctor
distinguishes installed paths, executable version, and activation still needing
an in-client status call.

## VII. Importing the existing local installation

Import is local and explicit. `migrate` does not run at install/startup, infer
profiles from folder names, edit client configs, or read/write remote Honcho data.
Both target config and target state must be absent or empty. Never merge ledgers.
Refuse overlapping source/target paths and pre-existing target credential files;
never overwrite a source key or partially populated target.

Before `--apply`, the operator pauses the old bridge, closes its clients and stops
its hooks/MCP processes. Document that pausing alone does not stop capture.
Refuse an unpaused source or detectable source activity. Read the source database
without migrating it; take a consistent SQLite backup that includes WAL contents,
not a raw copy of ledger.sqlite. Check for source changes during import and abort
if detected. No claim that a filesystem check proves every external writer stopped.

Convert v1 profiles into accounts plus profiles without changing account labels,
endpoint identity, workspace, user, project IDs, rules or captureFrom. Profiles
sharing an account must agree on endpoint and credential source; otherwise stop
with a conflict. Copy referenced keys into private target files without printing
or changing their originals. Generate a registry ID and bind the copied ledger.

Preserve all routes, remote session IDs, events, receipts, diagnostics, conclusion
IDs/results/states, and nullable ownership on old operations. Add only the metadata
needed by v2; never guess ownership. Compare record counts and stable identifiers,
run SQLite integrity checks, and leave the imported target paused. Preserve the
source unchanged. On error remove only this attempt's new target files.

Cutover instructions: stop the old clients, import, manually disable/remove the
reported old Honcho integrations, install the new CLI, run doctor, approve/reload
clients, verify in-client status and pinned destinations, then resume uploads.
Do not run the old and new writers together. The existing machine's live runtime
is not switched merely by completing implementation in this repository.

## VIII. Packaging, documentation and release

Expose `honcho-bridge` through package.json bin pointing to a shebang entrypoint.
Use version 0.1.0 for the first product release; the imported prototype's 1.0.0 is
not evidence of a prior public release. Package name honcho-bridge is provisional
until registry availability is checked; a scoped npm name may retain the same bin.

Keep exact direct dependency versions and the lockfile. Use Node's parser and
SQLite support; one small TOML dependency replaces Python/tomlkit. Keep the existing
build for the Claude adapter. npm installation must neither run client setup nor
require a compiler/build toolchain. Build runtime assets before packing.

Use an explicit package allowlist: public runtime modules, required dist files,
the memory skill, generic README, MIT LICENSE and third-party license/provenance
notices. Exclude tests, private operational reports, local history imports,
recovery utilities and unused vendor source from the npm artifact. GitHub source
may retain vendor source required to reproduce the build, with attribution.

README must cover prerequisites, key provisioning in Honcho, paused first setup,
two-account examples, project/worktree rules, install/reload, doctor/status,
key rotation, upgrade/reinstall, pause/resume, uninstall/rollback and local import.
State that the selected workspaces must already be accessible; setup does not
create accounts or provision keys. Document what data leaves the machine and that
regex redaction cannot guarantee removal of every secret.

Retain the upstream MIT notice and add MIT for original code. Before any public
push, review both files and Git history for machine-specific reports, private
workspace/project names, paths, receipts and secrets. Preserve local operational
records privately; prepare a sanitized export/history as an explicit release task.
Removing a file at HEAD does not remove it from history. Do not rewrite this local
repository's history or publish as part of the planning/implementation tasks.

CI runs build, tests and a packed-install smoke test on Linux/macOS, Node 24/26.
Install the tarball in an isolated prefix/home, with no repository node_modules,
Python, real client config or credentials. Verify help, fixture setup, offline
doctor, MCP tool listing, hook execution and uninstall from the actual artifact.

Live checks are opt-in, use dedicated test workspaces, label/retain test records and
never use personal production destinations as defaults. Read checks must remain
read-only; any write probe requires a separate explicit invocation. Publication
requires passing offline/pack checks plus fresh Codex and Claude activation,
cross-area isolation and timeout/conclusion checks. Record desktop acceptance
separately. GitHub repo/owner, npm scope and publishing credentials are release-time
inputs; no remote publication is authorized by this specification.

## IX. Tasks and acceptance

All CLI tasks are open. Existing 21 prototype tests are regression evidence only;
they do not satisfy the new command, installer or package acceptance criteria.
Complete tasks in the order below, keeping each task's evidence in its commit.

- [ ] **CLI-01 — Entrypoint and configuration foundation** (III, IV).
  Add strict CLI dispatch, help/version/JSON/errors, XDG defaults, schema v2,
  registry/ledger pairing and explicit initialization. Prove empty-home help has
  no side effects; bad options/noninteractive omissions fail before writes;
  alternate configs cannot silently share a mismatched ledger.
- [ ] **CLI-02 — Accounts and profiles** (III, IV).
  Implement init and account/profile commands with private atomic writes.
  Prove hidden/stdin/file key input, cancellation, key rotation, referenced-delete
  refusal, read-only lists and concurrent-edit handling. No test may print keys.
- [ ] **CLI-03 — Project assignments** (I1–I4, IV).
  Implement project commands/default resolution around the existing resolver.
  Test normal repos, external worktrees, missing origins, spaces/Unicode/symlinks,
  recursive roots, conflicting roots/remotes, Git errors, reassignment and resumed
  conversations. Existing routes must not move.
- [ ] **CLI-04 — Runtime entrypoints and diagnostics** (I5, I7, IV, VI).
  Wire mcp/hook/doctor/status/pause/resume/flush into one registry/ledger.
  Keep all 16 tools and protocol shapes, add version evidence, and migrate only
  through explicit write paths. Test wrong/missing routes, rejected keys without
  fallback, no get-or-create reads, hook output, paused behavior, partial flush
  failure, uncertain receipts/conclusions and legacy unowned operation reporting.
- [ ] **CLI-05 — Node installer and removal** (V).
  Replace machine-specific Python setup with owned, reversible Node edits.
  Test both clients separately/together, foreign writers, native-memory opt-in,
  malformed settings, semantic idempotence, paths with shell characters,
  unsupported clients, npx-cache refusal, concurrent edits, injected partial
  failure/crash, uninstall preserving unrelated edits and guarded rollback.
- [ ] **CLI-06 — Local prototype import** (VII).
  Implement preview/apply and cutover instructions. Test WAL-backed data,
  unpaused/active sources, nonempty target, mismatched account definitions,
  missing keys and interrupted copy; preserve every route/event/operation identity
  and uncertain state. Source bytes/data remain unchanged; target stays paused.
- [ ] **CLI-07 — Package and public documentation** (VIII).
  Add bin, metadata, allowlist, MIT/third-party notices and generic usage docs.
  Prove the tarball runs from an isolated install with all adapter assets and no
  Python. Review tracked/public artifacts and prepare the private-record cleanup
  list; do not publish or silently rewrite history.
- [ ] **CLI-08 — Release verification** (I–VIII).
  Add the Linux/macOS CI matrix and run the new checks plus retained regressions.
  Record actual fresh-client activation, cross-area isolation, all five chat levels,
  timeout/rejection/lost-response behavior and desktop status separately. Leave
  unavailable external checks open. Release is blocked until required evidence
  exists; publication remains a separate user action.
