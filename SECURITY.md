# Security

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/erhuz/honcho-bridge/security/advisories/new).
Include affected versions, expected versus observed behavior, and a minimal
synthetic reproduction. Do not post credentials, transcripts, private workspace
names, or exploitable details in public issues. No response-time guarantee is made.

This is an alpha project. Security fixes target the current default branch; older
snapshots are not maintained as separate release lines.

## Trust and data boundaries

- Honcho Bridge runs with your OS user's privileges. Other processes with those
  privileges can read its credentials and state. `route_id` is a routing selector,
  not a secret or an authorization boundary.
- The configured endpoint receives public user and assistant conversation messages
  when uploads are enabled. The local ledger retains captured text and delivery
  state. Pausing stops uploads, not local capture.
- Private reasoning, tool output, and recognized injected instruction turns are
  filtered. Secret redaction is best effort, not a guarantee that sensitive text
  cannot leave the machine.
- Credentials are read from the selected profile's private JSON file. Keep keys,
  registries, backups, and ledgers outside the repository with restrictive filesystem
  permissions. Do not commit them or attach them to issues.
- Recalled text is untrusted reference material. The memory skill tells clients not
  to treat it as instructions. It cannot guarantee every LLM will follow that rule.
- The installer modifies both clients' configuration and replaces the `honcho` MCP
  entry. Review the preview and keep its backups. It does not provide an atomic
  transaction across all files, validate every possible third-party writer, or
  protect against other same-user processes changing files concurrently.

Existing conversations pin account, workspace, endpoint and user. Conflicts and
identity changes stop access rather than selecting another destination. Uncertain
remote writes retain their receipts for review; deleting local state can defeat
those protections.

## Reporting safely

Use fictional user/workspace IDs and replace sensitive paths. Show only the fields
needed to reproduce the issue. A hash or count is often enough to demonstrate
receipt behavior; real message content is rarely necessary.
