# Changelog

## 0.1.0-alpha.3 — 2026-10-01

- Correct session selection to use only the primary project directory, such as
  `honcho-bridge`, shared across all clients and conversations.
- Add explicit consolidation of existing session history with a local backup,
  preserved authors and timestamps, verified receipts, and retained originals.

## 0.1.0-alpha.2 — 2026-10-01

- New Honcho sessions use the primary directory, client, and UTC creation time
  instead of a hash. Existing session mappings stay pinned to their saved history.
- Hooks quietly skip unassigned conversations when `defaultProfile` is `null`,
  without injecting unavailable-memory messages. Conflicts and failures affecting
  existing memory routes remain visible.

## 0.1.0-alpha.1 — 2026-10-01

First alpha source release. Install from the Git tag; no npm package is published.

- Shared Honcho MCP runtime and recall hooks for Codex and Claude Code.
- Private, configuration-driven profiles, routing, credentials, state and client paths.
- Optional `defaultProfile: null` restricts memory to assigned projects and roots;
  unassigned folders cannot capture messages or access another workspace.
- Immutable conversation destinations and a shared SQLite delivery ledger.
- Receipt-aware message delivery and visible uncertain conclusion writes.
- Installer preview, backups, repeatable application, and guarded rollback.
- Installation and configuration guides, LLM setup skill, logo, MIT license,
  third-party attribution, contribution and security guidance, and a CI matrix.
- New saluting-face logo and Honcho Bridge wordmark.

This alpha is installed from a checkout and uses a Python installer. The planned
Node-only public CLI and v2 configuration schema are not implemented.
