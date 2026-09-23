# Third-party notices

## Claude Honcho adapter

`vendor/claude` contains source from the Claude Honcho plugin, version 0.3.2,
recovered from installed source maps. Copyright (c) 2026 Plastic Labs.

The original [MIT license](vendor/claude/LICENSE) remains with those files.
[PROVENANCE.json](vendor/claude/PROVENANCE.json) records source-map hashes.
`scripts/build.mjs` applies local adapter changes at build time: isolated state,
pinned session names, visible recall failures, disabled SDK retries, and the shared
MCP tool prefix. Only recall hooks and redaction are built; the bridge supplies
capture and delivery.

Keep both the upstream license and provenance when redistributing these sources
or their compiled adapter. The root MIT license covers original project code and
does not replace upstream notices.

## Installed dependencies

npm dependencies are pinned in `package-lock.json`. Python installer dependencies
are pinned in `requirements.txt`. Each dependency retains its own license in the
installed package. These dependencies are fetched during installation and are not
vendored here. Review their notices if distributing a bundle containing them.

## Names and artwork

Honcho, Codex, Claude, and their associated marks belong to their respective
owners. References describe interoperability and do not imply endorsement.
The repository logo was generated for this independent project; see
[asset notes](docs/assets/README.md).
