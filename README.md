# Honcho Bridge

Connect Codex and Claude to Honcho through one local bridge. A private JSON
registry selects user peers, workspaces, accounts, project assignments, credential
files, state storage, and client locations. No machine-specific identity is built
into the runtime or installer.

Start with [the configuration example](config/profiles.example.json), follow
[the setup guide](docs/configuration.md), or give an LLM the
[setup skill](skills/honcho-setup/SKILL.md). Keep your configured registry and keys
outside the repository. The installer discovers Node and records explicit paths.

## Setup

This checkout uses the v1 registry and requires Node 24+, Git, Python 3, and
Python's `tomlkit` package. After preparing the registry and credential file:

```sh
npm ci --ignore-scripts
npm run check
python3 scripts/install.py --config ~/.config/honcho/profiles.json
python3 scripts/install.py --config ~/.config/honcho/profiles.json --apply
node src/cli.mjs --config ~/.config/honcho/profiles.json status
node src/cli.mjs --config ~/.config/honcho/profiles.json resolve /path/to/project
node src/cli.mjs --config ~/.config/honcho/profiles.json doctor
```

The installer previews changes unless `--apply` is supplied. It backs up changed
files, preserves unrelated client settings, installs the runtime memory skill,
and points both clients to this checkout and the same explicit configuration.
It disables Codex native memory and the stock Claude Honcho plugin. Legacy writer
cleanup uses only the registry's explicit `legacy` paths.

Restart/reload clients after installation and approve hooks if required. A new
ledger starts paused; enable it after checking the routes using
`node src/cli.mjs --config /path/to/profiles.json enable`. `doctor` contacts Honcho;
`status` and `resolve` are local checks. Configuring files does not prove an already
running client loaded them.

## Memory behavior

Each conversation keeps its original account, workspace, user and endpoint.
New unassigned folders use `defaultProfile`. Directory rules, registered remotes,
and Git common directories identify projects and worktrees. Conflicting rules or
failed Git inspection stop access. Start a new conversation to change destination.
Changing an existing profile's identity does not move saved routes.

Hooks and MCP share one SQLite ledger. Every MCP call requires the current hook's
`route_id`. Ambient Honcho variables and startup directories do not select an area.
Missing credentials do not fall back to another account. Credential paths come
from profiles; secrets remain in private files and are read when needed.

Capture records public user and assistant messages, omits private reasoning and
tool output, and applies redaction. Only messages at or after `captureFrom` enter
normal capture. Stable source IDs and receipt checks prevent blind replay after
uncertain writes. Manual conclusion writes use the same uncertainty safeguards.
Health warnings remain visible after successful recall.

Use `pause`, `enable`, `flush`, and `status` through `src/cli.mjs` with the same
`--config` path. `flush` does not blindly replay uncertain writes. Historical
`inventory` and `recover` are separate maintenance operations described in the
[setup guide](docs/configuration.md); recovery requires deliberate review and does
not delete remote history.

## Verification and rollback

`npm run check` builds the Claude adapter and runs isolated local tests. Live
verification is separate and can create remote test messages; do not run it as
ordinary setup. [Verification notes](VERIFICATION.md) distinguish local checks
from fresh-client and live acceptance.

Installation prints a private backup directory. Restore unchanged installed files
with `python3 scripts/install.py --rollback /path/to/backup`. Rollback preserves
remote memory, credentials not changed by setup, and the conversation ledger.
Backups can contain private configuration and must stay outside version control.

## Project status and provenance

The public installable `honcho-bridge` CLI and v2 schema remain planned in
[PLAN.md](PLAN.md) and [SPEC.md](SPEC.md). Those commands are not implemented yet.
The [legacy contract](docs/legacy-integration-spec.md) records earlier behavior.

`vendor/claude` contains adapter 0.3.2 source recovered from source maps, with its
license and hashes in `PROVENANCE.json`. Builds isolate adapter state, pin session
names, propagate recall failures, and disable SDK retries. Shared capture and
delivery replace upstream message writers. Dependencies are pinned in the lockfile.

No daemon is required. The OS account is the trust boundary: `route_id` makes the
caller's selection explicit but does not protect against malicious code running
as the same OS user.
