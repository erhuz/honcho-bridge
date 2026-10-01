# Changelog

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
