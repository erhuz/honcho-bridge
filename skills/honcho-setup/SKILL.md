---
name: honcho-setup
description: Configure and install this Honcho Bridge checkout for Codex and Claude, including profiles, project routing, credential references, and local paths. Use for initial setup, relocation, or configuration changes.
---

# Honcho Bridge setup

Work from the user's Honcho Bridge checkout. Use `INSTALL.md` for the source
installation steps and isolated Python environment. Read `docs/configuration.md` there
for the supported v1 schema and commands. `SPEC.md` describes a future public CLI;
do not run its unimplemented commands or convert a working registry to v2.

Inspect existing configuration before creating anything. Preserve `captureFrom`,
`stateDir`, credentials, project IDs, and profile destinations on existing installs.
Ask for missing workspace/user IDs and project assignments; never infer company
membership or Honcho identities from the OS username or a folder basename.

For a new install, copy `config/profiles.example.json` outside the checkout and
replace the example identity. Choose the default profile explicitly. Older registries must gain `defaultProfile`
with their previously intended default before installation. Add directory
rules as `{ "path": "~/repos/work", "profile": "work" }` only for the user's intended
area. Use separate profiles for distinct destinations. Reference private credential
JSON files containing `apiKey`; do not request keys in chat, print them, put them in
argv, or commit them. The bridge does not issue keys or provision accounts.

Paths expand `~/` against the home directory and relative paths against the registry
file's directory. Set client paths in `installation` when their configuration is
outside the conventional home directories. The installer discovers Node and writes
absolute entrypoints from the current checkout. Keep that checkout available;
rerun installation after relocating it or changing Node's location.

Build and run the local tests, then preview with:

```sh
python3 scripts/install.py --config /absolute/path/profiles.json
```

Review the reported target files against the requested setup. Applying uses the
same command with `--apply`; it configures both clients, disables Codex native memory
and the stock Claude Honcho plugin, and installs the runtime memory skill. It adds
`captureFrom` if absent. Existing legacy writers must be stopped before enabling
uploads; configure `legacy` cleanup only for files verified to belong to the old
integration. Preserve unrelated client configuration.

Use `node src/cli.mjs --config /absolute/path/profiles.json status` and `resolve`
for local checks. `doctor` contacts Honcho using the configured credentials. A new
ledger starts paused. Enable uploads only within the user's authorized setup scope,
after the intended routes and client reloads have been verified. Do not run live
verification or historical recovery as routine setup: they can create remote data.

Report the configuration path, state path, selected profiles, backup path, and any
client approval/restart still needed. A successful file install does not prove that
an already-running client loaded the change. Rollback restores client configuration;
it does not undo remote writes or delete ledger data.
