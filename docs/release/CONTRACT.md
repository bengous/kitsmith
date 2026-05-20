# Release Contract

## Responsibility

The release domain owns maintainer release preparation, changelog/version checks, clean work-copy
packaging, tarball safety inspection, tarball smoke, and the human approval boundary for publish,
tag, and push.

## Product Surfaces

- Release preparation: `scripts/release/prepare.ts`.
- Tarball inspection: `scripts/release/inspect-tarball.ts`.
- Tarball smoke support: `scripts/testing/tarball-smoke-sandbox.ts`.
- Release docs: `docs/maintainer-release.md`.
- Release workflow: `.github/workflows/release-prepare.yml`.
- Cocogitto configuration: `cog.toml`.

## Invariants

1. `release:prepare` requires Linux bubblewrap sandboxing.

   Evidence: `requireLinuxBubblewrap("release prepare")` in `scripts/release/prepare.ts`.

2. Release preparation requires a clean worktree.

   Evidence: `assertCleanWorktree`.

3. Release preparation rejects an already existing local or remote `v<version>` tag.

   Evidence: `assertTagAvailable`.

4. Release preparation rejects a package version that npm already reports for `kitsmith`.

   Evidence: `assertNpmVersionAvailable`.

5. Release preparation checks Cocogitto commit/changelog/bump state and expects the dry-run bump to
   match the current package version tag.

   Evidence: `cog check`, `cog changelog`, `cog bump --auto --dry-run`, and suggested version check
   in `scripts/release/prepare.ts`.

6. Release preparation runs the regular `validate` lane before packaging.

   Evidence: `runOrThrow(["bun", "run", "--silent", "validate"])`.

7. Release preparation builds a clean work copy from `git archive HEAD`, installs dependencies with
   frozen lockfile and ignored scripts, builds, and runs `npm pack --ignore-scripts`.

   Evidence: `prepareCleanWorkCopy` and `buildReleaseBuildPackSandboxCommand`.

8. Tarball inspection runs in a no-network sandbox and rejects unexpected files, sensitive files,
   forbidden lifecycle scripts, and invalid tarball paths.

   Evidence: `buildReleaseInspectSandboxCommand`, `inspectTarball`, allowlist/denylist patterns, and
   lifecycle script checks.

9. Release preparation writes a release manifest after tarball inspection and tarball smoke pass.

   Evidence: `createReleaseManifest` and manifest write in `main`.

10. Release preparation does not publish, tag, or push.

    Evidence: `docs/maintainer-release.md` and the final `release:prepare` log message.

11. The GitHub release-prepare workflow installs Pkl and Cocogitto through mise, installs Bun and
    bubblewrap, installs dependencies with the frozen lockfile, and runs `bun run release:prepare`.

    Evidence: `.github/workflows/release-prepare.yml`.

## Commands

- `bun run release:prepare`
- Debug commands documented in `docs/maintainer-release.md`: `cog check`,
  `cog changelog <range>`, and `cog bump --auto --dry-run`.

## Non-Responsibilities

- Release preparation does not choose product features or edit changelog text.
- Release preparation does not bypass GitHub rules or npm approval.
- Release preparation does not create or push tags.

## Known Ambiguities

- Commit signatures are optional on `main`; release trust is anchored by signed `v*` tags according
  to maintainer docs. That policy is documented, but tag signing itself remains a human action after
  release preparation.
