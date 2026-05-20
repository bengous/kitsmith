# Validation Contract

## Responsibility

The validation domain owns maintainer validation lanes, generated-project validation, sandbox
validation, scope-aware stop/pre-push hooks, CI validation jobs, and validation command routing.

## Product Surfaces

- Validation plans and runner: `scripts/validation/validation-plan.ts`,
  `scripts/validation/validation-runner.ts`, `scripts/validation/validate.ts`.
- Generated validation sources: `template-sources/base/scripts/validation/` and copied validation
  files asserted by the generated project contract tests.
- Scope routing: `scripts/validation/detect-scope.ts`, `scripts/validation/routing-policy.ts`,
  `scripts/validation/format-and-lint-routing.ts`.
- Hook validation: `scripts/validation/validate-on-stop.ts`,
  `scripts/validation/validate-push.ts`, `lefthook.yml`.
- Sandbox testing: `scripts/testing/sandbox-runner.ts`, `scripts/testing/e2e-contract.ts`,
  `scripts/testing/safe-install-smoke.ts`, `scripts/testing/smoke.ts`.
- CI: `.github/workflows/ci.yml`.
- Maintainer docs: `docs/maintainer-validation.md`.

## Invariants

1. Public maintainer validation lanes are package scripts, and their membership is defined in
   `scripts/validation/validation-plan.ts`.

   Evidence: root `package.json` scripts and `LIVE_CHECK_PLAN`, `LIVE_VALIDATE_PLAN`,
   `LIVE_DEEP_PLAN`, `LIVE_GENERATED_PLAN`, `LIVE_SANDBOX_PLAN`.

2. `check` includes generated dependency freshness, parent tooling drift, agent drift, formatting,
   lint errors, typecheck, and tests.

   Evidence: `LIVE_CHECK_PLAN`.

3. `validate` extends `check` with architecture lint and OXLint audit.

   Evidence: `LIVE_VALIDATE_PLAN`.

4. `validate:deep` extends `validate` with dead-code, duplicate-code, GitHub Actions, GitHub
   Actions security, and local link checks.

   Evidence: `LIVE_DEEP_PLAN` and `docs/maintainer-validation.md`.

5. `validate:generated` runs `generated-dependencies:check` as an ordered prerequisite before
   generated project contract tests.

   Evidence: `LIVE_GENERATED_PLAN` and `validationExecutionGroups`.

6. `validate:sandbox` runs e2e contract, safe install, and smoke tests, which require Linux
   bubblewrap for sandboxed execution.

   Evidence: `LIVE_SANDBOX_PLAN`, `requireLinuxBubblewrap`, `e2eContract`, and `smoke`.

7. Validation runner executes ordered prerequisites sequentially and only starts concurrent steps
   if prerequisites passed.

   Evidence: `collectValidationResults` in `scripts/validation/validation-runner.ts`.

8. Scope routing classifies backend, frontend, scripts, config, and product changes and expands
   config changes across relevant surfaces.

   Evidence: `RoutingScope`, `classifyRoutingPath`, and `expandConfigRoutingScope`.

9. Routed product surfaces are `templates/` and `template-sources/`, and generated dependency checks
   are required for package, lockfile, generated dependency config/artifact, or routed product
   surface changes.

   Evidence: `isProductSurface` and `requiresGeneratedDependencyCheck`.

10. Stop validation and pre-push validation choose steps from changed files rather than always
    running every lane.

    Evidence: `validate-on-stop.ts`, `validate-push.ts`, and `detect-scope.ts`.

11. CI runs deep validation and generated validation on Linux and Windows, and sandbox validation
    on Linux.

    Evidence: `.github/workflows/ci.yml`.

12. CI installs Pkl for jobs that need generated dependency checks and installs Lychee for deep
    link checking.

    Evidence: `Setup mise` steps in `.github/workflows/ci.yml`.

13. Generated-project validation script behavior is owned by this domain, but generation owns which
    validation files and package scripts are emitted for a project shape.

    Evidence: generated validation sources in `template-sources/base/scripts/validation/`,
    root package script assembly in `packageJsonContractForContext`, and generated output assertions
    in `scripts/testing/generated-project-contract-runner.ts`.

## Commands

- `bun run check`
- `bun run validate`
- `bun run validate:deep`
- `bun run validate:generated`
- `bun run validate:sandbox`
- `bun run check:links`
- `bun run check:github-actions`
- `bun run check:github-actions-security`

## Non-Responsibilities

- Validation does not publish packages or create tags.
- Validation does not own generated dependency source data, only when checks run.
- Validation does not own generation-time inclusion of generated validation files or package scripts.
  It owns their behavior once they are part of the generated project contract.

## Known Ambiguities

- `release:prepare` runs validation but is not itself a validation lane. Keep release-only checks in
  the release domain.
