# Install Honcho Bridge from source

This guide installs the current **alpha source release**, not the future CLI in
`SPEC.md`. It configures both Codex and Claude Code. Use a stable checkout location;
clients will reference it by absolute path.

## Requirements

- Linux or macOS. Windows is not supported by this installer.
- Node.js 24 or newer and npm; Git; Python 3.11+ with `venv` and pip.
- Codex and Claude Code with hooks and STDIO MCP support. Client approval and reload
  behavior depend on their versions; local tests cannot confirm desktop activation.
- A Honcho API key and an intended workspace/user peer. Consult the
  [Honcho documentation](https://honcho.dev/docs/v3/documentation/introduction/overview)
  for service setup. This project does not issue keys or provision accounts.

## 1. Get and build the source

```sh
git clone https://github.com/erhuz/honcho-bridge.git
cd honcho-bridge
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
npm ci --ignore-scripts
npm run check
```

Keep the virtual environment active for installer commands and tests; the tests
invoke `python3`. Normal runtime hooks use Node and do not need this environment.
If your Python installation lacks `venv`, install your OS's Python venv support first.

## 2. Create a private registry

For a **new** installation:

```sh
umask 077
mkdir -p "$HOME/.config/honcho/credentials"
python3 - <<'PY'
from pathlib import Path
source = Path('config/profiles.example.json')
target = Path.home() / '.config/honcho/profiles.json'
with target.open('x') as output:
    output.write(source.read_text())
print(target)
PY
```

The exclusive create refuses to replace an existing registry. If it already
exists, follow [upgrading and rollback](#upgrading-and-rollback) instead.

Open `~/.config/honcho/profiles.json` in your editor. Replace `your-workspace` and
`your-user-peer` with your chosen Honcho workspace and user peer. `main` and
`primary` are local labels; they do not identify a remote account owner.

Set `defaultProfile` to the profile intended for unassigned folders, or `null` to
limit memory to explicitly assigned roots and projects. The example saves state
under `~/.config/honcho/state` and credentials under
`~/.config/honcho/credentials/primary.json`: relative paths resolve from the registry,
not your shell's current directory. `~/` paths are also supported.

For a second memory area, add a profile and a directory assignment. For example,
a `work` profile can point at its own workspace and credential file, with:

```json
{"path": "~/repos/work", "profile": "work"}
```

Add that object to `roots` only after defining the `work` profile. See the full
[schema reference](docs/configuration.md#registry-fields). Review `installation`
paths if either client uses a nonstandard configuration location. Set matching
recovery paths separately if you plan to import historical conversations.

## 3. Save the API key without exposing it in shell history

This snippet prompts without echoing and refuses to overwrite an existing key:

```sh
python3 - <<'PY'
from getpass import getpass
from pathlib import Path
import json
import os

os.umask(0o077)
path = Path.home() / '.config/honcho/credentials/primary.json'
key = getpass('Honcho API key (hidden): ').strip()
if not key or '\n' in key or '\r' in key:
    raise SystemExit('Expected one nonempty API key')
with path.open('x') as output:
    json.dump({'apiKey': key}, output)
    output.write('\n')
path.chmod(0o600)
print('Saved private credential file')
PY
```

Run this in an interactive terminal. If you chose another `credentialFile`, adjust
`path` accordingly. Multiple profiles may reference one credential file when they
use the same account. Do not paste keys into chat, commands, issues, or Git.

## 4. Preview, then install

Close or stop older Honcho writers before switching installations. Preview:

```sh
python3 scripts/install.py --config "$HOME/.config/honcho/profiles.json"
```

Review the `changed` paths. Apply the same plan:

```sh
python3 scripts/install.py --config "$HOME/.config/honcho/profiles.json" --apply
```

The installer:

- Adds `captureFrom` if absent and saves resolved absolute paths in the registry.
- Installs hooks, an MCP server named `honcho`, and the memory skill for both clients.
- Enables Codex hooks, disables Codex native memory, and disables the stock
  `honcho@honcho` Claude plugin to avoid another automatic memory writer.
- Replaces existing `honcho` MCP entries and recognized bridge hooks. Inspect
  those entries before applying if another integration already owns that name.
- Backs up changed files and prints the backup directory. Keep this output.

Unrelated settings are preserved. Additional legacy cleanup is performed only for
explicitly listed `legacy` files. An existing legacy Codex wrapper is redirected.
Installation is not an all-files transaction: an interrupted write may require
manual recovery from the backup manifest. Run it while clients are stopped.

Node is found through PATH. Use `--node /absolute/path/to/node` to select another
executable. `--home` is intended for isolated installations and test homes; custom
client locations belong in the registry.

## 5. Verify before enabling uploads

```sh
node src/cli.mjs --config "$HOME/.config/honcho/profiles.json" status
node src/cli.mjs --config "$HOME/.config/honcho/profiles.json" resolve /path/to/your/project
node src/cli.mjs --config "$HOME/.config/honcho/profiles.json" doctor
```

`status` and `resolve` are local checks. `doctor` performs remote reads; inspect
each profile's `status` field, since the current command can exit successfully
while reporting an unavailable profile. The intended workspace must be accessible
for that profile to report healthy.

Reload/restart both clients and approve hooks through their normal UI if needed.
Start a fresh conversation in an assigned project. Confirm the injected
`<honcho-route>` describes the intended destination, then call `honcho/status`
using that exact route ID. Repeat in each client you intend to use.

A new ledger starts paused. Once the routes are correct, enable uploads:

```sh
node src/cli.mjs --config "$HOME/.config/honcho/profiles.json" enable
```

Public conversation messages captured since `captureFrom`, including messages
queued while paused, can now be uploaded by subsequent hooks. Never enable a new
installation as a connectivity test unless that upload is intended.

## Upgrading and rollback

Before upgrading, stop the clients and keep a backup of your registry and a
consistent SQLite backup of the state directory's `ledger.sqlite`. Do not copy
only the main SQLite file while it is being written; recent data may be in its WAL.

Keep profile identities, `captureFrom`, and `stateDir` unchanged. For older v1
registries missing `defaultProfile`, explicitly set the previous intended default.
Do not convert to the planned v2 schema. Fetch/review updates, rebuild with
`npm ci --ignore-scripts` and `npm run check`, then preview and reapply installation.
Repeat the reload and route checks.

Set `defaultProfile` to `null` to restrict memory to the configured roots and
projects. Unassigned folders cannot capture messages or use another workspace.

To restore a completed installation whose files have not changed afterward:

```sh
python3 scripts/install.py --rollback /absolute/path/to/printed/backup
```

Rollback refuses to overwrite newer edits. It restores configuration only; remote
memory, transcripts, and ledger data remain. There is no uninstall command yet.
Moving the checkout or changing Node's location requires reinstalling from the new
location. A rollback may restore references to the old checkout; keep it available.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `No module named tomlkit` | Activate `.venv` and run `python3 -m pip install -r requirements.txt`. |
| Missing `dist` module | Run `npm run build` from the checkout. |
| Unsupported/incomplete registry | Use schema v1 and set `defaultProfile` to an existing profile or `null`. |
| Profile unavailable | Check its credential file and endpoint, then inspect `doctor` output. |
| Conflicting project assignments | All matching roots, remotes and Git common directories must select one profile. |
| Pinned destination changed | Restore the original identity or use a new profile and conversation; editing config does not migrate history. |
| Hook not running or old tools shown | Approve hooks if requested and reload the client; a successful standalone MCP call is not proof of desktop reload. |
| Uncertain messages or conclusions | Review receipts and health; do not delete ledger state to force a retry. |

For assisted setup, use [the LLM setup skill](skills/honcho-setup/SKILL.md). For bug
reports, follow [CONTRIBUTING.md](CONTRIBUTING.md) and share sanitized diagnostics.
