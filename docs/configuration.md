# Configure this checkout

This checkout supports the v1 registry described here. The public CLI and v2 schema
in `SPEC.md` remain planned. Setup requires Node 24+, Git, Python 3, and Python's
`tomlkit` package. Runtime hooks use Node directly; no fixed Python path is required.

Copy `config/profiles.example.json` to a private location outside the repository,
for example `~/.config/honcho/profiles.json`. Edit the workspace and user peer to
match the intended Honcho destination. Create the referenced private credential
file with one JSON property, `apiKey`, and mode 0600. Do not commit credentials.
The installer does not create keys or accounts.

## Registry fields

| Field | Meaning |
| --- | --- |
| `version` | `1` for this implementation. |
| `defaultProfile` | Profile used for new conversations in unassigned folders. Required; no profile name is inferred. Add it explicitly when upgrading an older registry. |
| `stateDir` | Directory containing the SQLite ledger and adapter state. Omission preserves the legacy `~/.local/state/honcho-integration` location. |
| `captureFrom` | ISO timestamp before which normal capture ignores messages. Setup saves the current time if absent. Preserve it when updating an existing installation. |
| `profiles` | Map of arbitrary profile names to `account`, `workspace`, `user`, `endpoint`, and `credentialFile`. Names use lowercase letters, numbers, `_`, and `-`. |
| `roots` | Directory assignments, each `{ "path": "~/repos/work", "profile": "work" }`. No automatic company or repository discovery. |
| `projects` | Explicit repository assignments with `id`, `path`, `profile`, optional `commonDir`, and optional normalized `remote` such as `github.com/team/repo`. |
| `redactPatterns` | Additional regular expressions used to redact captured text. |
| `installation` | Optional `codexHome`, `claudeHome`, `claudeConfigFile`. Defaults: `~/.codex`, `~/.claude`, `~/.claude.json`. Set these explicitly for custom client locations. |
| `recovery` | Optional arrays `codexQueueDirs`, `codexTranscriptDirs`, `claudeTranscriptDirs`. Queue directories default to none. Transcript defaults are the standard Codex sessions/archived_sessions and Claude projects directories. Custom client locations require corresponding recovery paths. |
| `legacy` | Optional explicit cleanup lists: `disableConfigs`, `miseFiles`, `envSources`. Setup disables listed existing legacy Honcho configs and removes a mise `env._.source` only when it matches a listed source. No personal legacy paths are inferred. |

Paths can be absolute, start with `~/`, or be relative to the registry's directory.
Shell variables such as `$HOME` are not interpolated. Installation saves expanded
absolute paths so client startup directories cannot affect routing. `--home PATH`
on the installer changes the home used for tilde expansion and default client
paths; it is useful for isolated setup tests.

All matching rules must agree. Existing conversations retain their assigned
identity; changing a profile's account, workspace, user or endpoint causes those
routes to refuse access. Add another profile for a new destination. Preserve the
existing state directory to retain conversation routes and delivery receipts;
changing the path does not migrate that data.

## Install and verify

From the checkout, after editing the registry:

```sh
npm ci --ignore-scripts
npm run check
python3 scripts/install.py --config ~/.config/honcho/profiles.json
python3 scripts/install.py --config ~/.config/honcho/profiles.json --apply
node src/cli.mjs --config ~/.config/honcho/profiles.json status
node src/cli.mjs --config ~/.config/honcho/profiles.json resolve /path/to/project
node src/cli.mjs --config ~/.config/honcho/profiles.json doctor
```

The first installer command previews changed files without writing. `--apply`
backs up existing files and updates both clients. It preserves unrelated settings,
disables Codex native memory and the stock Claude Honcho plugin, and copies the
runtime `honcho-memory` skill. Node is discovered through PATH; `--node PATH`
overrides it. Generated hooks and MCP entries pass the same explicit `--config`
path and use the registry's state directory. The legacy runtime `--state` override
remains available for tests; do not use it to split a live installation's ledger.

Installation uses absolute paths to the current checkout and Node executable.
Keep both available and rerun setup after relocation. Restart/reload the clients
and approve hooks in their normal UI when required. `doctor` makes remote read
requests; local `status` and `resolve` do not prove a running client has reloaded.

A fresh ledger starts paused. After checking each intended client route and
stopping any older message writers, enable normal uploads:

```sh
node src/cli.mjs --config ~/.config/honcho/profiles.json enable
```

The installer prints a backup path. Restore unchanged installed configuration with
`python3 scripts/install.py --rollback /path/to/backup`. Rollback preserves ledger
data and remote memory. Existing registry files are restored to their original
bytes, including relative paths.

## Maintenance and LLM setup

Use [the setup skill](../skills/honcho-setup/SKILL.md) to guide an LLM through setup.
It is included in this repository; the installer copies only the runtime memory
skill into clients. Supply the setup skill's path when asking an LLM to configure
this checkout.

Both verification scripts accept `--config PATH` and optional `--state PATH` and
iterate configured profiles. `verify-live.mjs` requires a root or project for each
profile and writes remote test receipts; run it only when those writes are intended.
`verify-compatibility.mjs` requires existing verification sessions and reads them.
Historical inventory uses only configured queue directories; add old queue paths
to `recovery.codexQueueDirs` before a deliberate legacy import. Neither live
verification nor historical recovery is part of ordinary setup.
