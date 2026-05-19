# Changelog

## 0.4.0 - 2026-05-19

### Added

- Generate the shared agent hook runtime under `.agents/scripts/hooks` with
  Codex, Claude, and Pi adapter surfaces.
- Add generated validation policy shared by human commands, Git hooks, and agent
  stop hooks.
- Add frontend-specific agent guidance for generated TanStack workspaces.
- Add a parent tooling sync/check rail so Kitsmith can dogfood generated agent
  tooling without replacing parent-only repository policy.

### Changed

- Keep native Codex and Claude hook wrappers thin while routing hook behavior
  through the shared runtime.
- Split generated validation tooling into public entrypoints, `internal/`
  helpers, and reusable `shared/` quality policy.
- Keep generated root agent context project-owned and stop generating a default
  project `README.md`.

### Fixed

- Block agent hooks with actionable feedback when hook payloads are invalid or
  local quality binaries are missing, instead of crashing the hook process.
- Keep AI hook-only validation helpers out of base generated projects.
- Remove a stale Pi TODO preset entry from generated AI manifests.
- Preserve parent-only lint severities and ignored artifact paths when syncing
  Kitsmith's dogfooded tooling.

## 0.3.2 - 2026-05-17

### Changed

- Align the Bun tooling baseline to 1.3.14 for the repository and generated
  projects, including `@types/bun` 1.3.14 and generated project mise defaults.

## 0.3.1 - 2026-05-13

### Changed

- Update the quality-tooling patch baseline: `@commitlint/cli` 21.0.1,
  `@commitlint/config-conventional` 21.0.1, and `knip` 6.13.1.

## 0.3.0 - 2026-05-13

### Added

- Add sandboxed release preparation that builds a clean work copy, inspects the exact packed
  tarball, writes a release manifest, and smoke-tests the packed CLI before publish approval.
- Add sandboxed generated-project smoke coverage for install, validation, tarball, and supply-chain
  probe paths.
- Add explicit validation lanes for `check`, `validate`, `validate:deep`, `validate:generated`, and
  `validate:sandbox`.
- Add regression coverage for generated command surfaces, read-only commands, package execution
  guardrails, routing policy, and sandbox runners.

### Changed

- Simplify generated-project command surfaces by removing maintainer-only sandbox and release
  commands from scaffolded projects.
- Route validation through a shared policy so repo-only, generated-project, hook, and sandbox checks
  stay separated.
- Harden generated install and smoke workflows so external package execution is constrained to the
  intended sandbox paths.

## 0.2.0 - 2026-05-12

### Added

- Add Conventional Commits enforcement to Kitsmith and generated projects through
  Lefthook `commit-msg` hooks.
- Add agent-readable commit-message feedback so vague titles such as
  `Release 0.2.0` are rejected with actionable guidance.
- Add Cocogitto configuration and maintainer release documentation for Kitsmith
  itself, while keeping Cocogitto out of generated projects.

### Changed

- Make `kitsmith adopt` install the same Conventional Commits guard as new
  projects without rewriting existing commit history.
- Include `commitlint.config.js` in format checks for Kitsmith and generated
  projects.

## 0.1.3 - 2026-05-12

### Changed

- Update the quality-tooling baseline used by Kitsmith and by generated projects:
  `@clack/prompts` 1.4.0, `jscpd` 4.1.1, `knip` 6.13.0, `oxfmt` 0.49.0,
  and `oxlint` 1.64.0.
- Enable `eslint/prefer-regex-literals` in the repository and generated
  projects. This rejects `new RegExp("static-pattern")` when a regex literal is
  enough, which keeps simple regexes easier to read and avoids needless runtime
  construction.
- Enable stricter generated TanStack frontend accessibility rules:
  `jsx-a11y/no-noninteractive-element-to-interactive-role`,
  `jsx-a11y/no-redundant-roles`, and `jsx-a11y/prefer-tag-over-role`.
  These rules catch ARIA role misuse early, prefer native semantic elements over
  manual roles, and reduce generated UI patterns that can confuse assistive
  technologies.

## 0.1.2 - 2026-05-12

### Added

- Add `--lint-severity` for adoption workflows.

### Changed

- Make `kitsmith adopt --yes` copy OXLint rules as warnings by default, so existing projects can adopt Kitsmith without immediately failing on a strict lint baseline.
- Keep newly scaffolded projects on the strict OXLint baseline.

## 0.1.1 - 2026-05-10

### Fixed

- Fix generated TanStack projects so fresh scaffolds pass validation.
- Fix generated AI Codex hook presets.
- Allow generated Playwright config to use `PLAYWRIGHT_PORT` while keeping port `3000` by default.

## 0.1.0 - 2026-05-08

### Added

- Initial public release.
- Bun-first project scaffolding for TypeScript projects.
- Adoption workflow for existing Bun/TypeScript projects.
- Optional TanStack Router, Effect, Claude, and Codex presets.
