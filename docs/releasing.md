# Preparing a source release

The current deliverable is an alpha installed from a Git checkout. `private: true`
in `package.json` deliberately blocks accidental npm publication. The metadata
version identifies this source snapshot; it does not mean the future packaged CLI
in `SPEC.md` exists.

## Before tagging

- Review README, install guide, examples, and changelog against implemented behavior.
- Rehearse `INSTALL.md` in a fresh temporary home, including an isolated Python
  environment, build, preview/apply, paused state, idempotence, and rollback.
- Run `npm run check` and review the Linux/macOS, Node 24/26 CI matrix after pushing.
  Configuring the workflow alone is not a passing CI result.
- Review the exact Git tree and history being released for credentials, private
  configuration, transcripts, ledger files and operational backups. Review
  dependency audit findings and record unresolved risk; an audit alone is not a
  security assessment.
- Preserve root MIT licensing and the upstream adapter's license/provenance.
- Verify supported client versions in fresh conversations with disposable Honcho
  profiles. Keep real keys and transcripts out of issues and release attachments.
  Standalone MCP tests do not establish desktop activation.
- Confirm the private vulnerability reporting link in `SECURITY.md` works and the
  repository description matches the source-release scope.

Only after these checks, choose and tag the intended alpha version, push the tag,
and draft release notes describing support and remaining limitations. Release
publication is a separate action; this document does not automate it.

## Release-note outline

- What the source release does and how to install it from `INSTALL.md`.
- Exact tested OS, Node, Python and coding-client versions.
- Configuration changes and how existing installations preserve state and identity.
- Known limits: both-client installer, checkout dependency, non-atomic file updates,
  no public CLI/npm installation yet, and any pending desktop checks.

Use GitHub's source archives or a reviewed Git tag. Do not attach a copy of your
working directory, `node_modules`, private configuration, or state. The build is
performed after checkout, so generated `dist` files are not part of the source tree.

## Future npm release

Keep npm publication blocked until the actual package contract is implemented:
a public entrypoint, runtime asset allowlist, installable dependencies and notices,
and an isolated packed-tarball test. That work is tracked in `PLAN.md` and `SPEC.md`.
