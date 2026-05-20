# Maintainer Validation

Kitsmith keeps the maintainer command surface separate from generated-project
commands. Public validation lanes are short entrypoints; validation membership
lives in `scripts/validation/validation-plan.ts`.

## Validation Lanes

| Lane | Use | Notes |
| --- | --- | --- |
| `bun run autofix` | Apply mechanical fixes. | Mutating by design; run before read-only gates when you want the tree repaired. |
| `bun run check` | Fast local read-only feedback. | Excludes deep, generated, sandbox, supply-chain, and release work. |
| `bun run validate` | Daily complete read-only gate. | Includes `lint:arch` and the explicit `lint:audit` assignment. |
| `bun run validate:deep` | Daily gate plus slower local analysis. | Adds dead-code, duplicate-code, GitHub Actions, and local link checks without sandbox or release work. |
| `bun run validate:generated` | Host-safe generated-project contract checks. | Covers generated package scripts, emitted files, docs, template contracts, and non-sandbox generation scenarios. |
| `bun run validate:sandbox` | Sandbox, network, install, supply-chain, and smoke checks. | Uses e2e/safe-install/smoke scenarios outside the fast host-safe gates; `test:e2e-contract` and `test:safe-install` require Linux/bubblewrap. |

## Related Release Gate

`bun run release:prepare` is documented in
[`docs/maintainer-release.md`](./maintainer-release.md). It runs release-only checks, scriptless
`npm pack`, no-network tarball inspection, manifest writing, and tarball smoke; it is not a
validation lane.

## Generated Dependency Baseline

The generated dependency contract lives in
[`docs/generated-dependencies/CONTRACT.md`](./generated-dependencies/CONTRACT.md);
the domain terms live in
[`docs/generated-dependencies/UBIQUITOUS_LANGUAGE.md`](./generated-dependencies/UBIQUITOUS_LANGUAGE.md).

`generated-dependencies:check` is part of `check`, `validate`, and
`validate:deep`. `validate:generated` runs it as an ordered prerequisite before
generated project contract tests so stale dependency artifacts cannot be
validated by the same generated contract lane.

`validate:generated` may create temporary projects under the OS temp directory.
It must not run bubblewrap sandboxes, network-enabled e2e scenarios,
`bun install`, sandbox smoke, tarball smoke, npm publish dry-runs, or registry
dependency execution.

`validate:sandbox` may run bubblewrap sandboxes, network-enabled generated-project
e2e scenarios, `bun install`, generated-project smoke, and code from registry
packages inside disposable projects or sandbox caches.
The supply-chain probe runs inside `test:safe-install` after sandboxed install.
This lane must not publish, tag, push, prepare a release, run release package
inspection, or execute tarball smoke; those release artifact checks stay in
`release:prepare`.

## GitHub Actions Hardening

Workflow validation is intentionally repo-local and tool-based rather than a
custom scanner. `check:github-actions` runs `actionlint` for workflow syntax and
semantic mistakes. `check:github-actions-security` runs `zizmor --offline` for
GitHub Actions security findings, including unpinned actions, risky token
handling, and unsafe workflow patterns. `zizmor` is a dedicated static analyzer
for GitHub Actions security; see <https://docs.zizmor.sh/>.

External actions are pinned to full commit SHAs, with a trailing version comment
such as `# v6` so humans and dependency automation can still see the intended
release line. Dependabot owns updates for those GitHub Actions references via
`.github/dependabot.yml`.

## CI Reliability

The sandbox lane is intentionally serialized in CI. It already starts nested
bubblewrap sandboxes, generated-project installs, and frontend Playwright/Vite
checks, so the workflow runs `validate --plan sandbox --jobs 1` and pins
scenario-level smoke/e2e concurrency through `KITSMITH_SMOKE_JOBS` and
`KITSMITH_E2E_CONTRACT_JOBS`.

`release:prepare` depends on Cocogitto's `cog` binary for changelog and version
checks. Keep Cocogitto pinned in `mise.toml` and installed in the manual
release workflow before running the release preparation script.

## Migration Map

| Previous/current command | Target lane | Status |
| --- | --- | --- |
| `validate` | `validate` | Kept as the daily gate. |
| `validate:scale` | removed | Replaced by explicit `validate:deep`, `validate:generated`, and `validate:sandbox` lanes; no legacy alias. |
| `lint:dead` | `validate:deep` | Kept as an internal leaf. |
| `lint:dupes` | `validate:deep` | Kept as an internal leaf. |
| `check:github-actions` | `validate:deep` | Kept as an internal leaf. |
| `check:github-actions-security` | `validate:deep` | Kept as an internal leaf. |
| `check:links` | `validate:deep` | Kept as an internal leaf. |
| `test:e2e-contract` | `validate:sandbox` | Kept as an internal leaf; requires Linux/bubblewrap and enables sandbox network. |
| `test:smoke` | `validate:sandbox` | Kept as an internal leaf. |
| `test:safe-install` | `validate:sandbox` | Kept as an internal leaf; requires Linux/bubblewrap. |
| supply-chain probe | `validate:sandbox` | Runs inside `test:safe-install` after sandboxed install. |
| tarball smoke | `release:prepare` | Kept release-only through `scripts/release/prepare.ts`. |
| `release:prepare` | `release:prepare` | Kept maintainer-only and outside validation lanes. |

## Internal leaves

The package can keep technical leaves such as `lint:dead`, `lint:dupes`,
`check:github-actions`, `check:github-actions-security`, `check:links`,
`test:e2e-contract`, `test:smoke`, `test:safe-install`, and the supply-chain
probe for debugging and CI composition. They are implementation details of the
maintainer lanes, not the primary mental model for daily work.
