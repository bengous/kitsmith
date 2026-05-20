# Generation Contract

## Responsibility

The generation domain owns `kitsmith [destination]`: it turns normalized CLI options into a new
project by combining native bootstrap output, cleanup, preset copies, rendered templates,
generated dependency sections, and finalization.

## Product Surfaces

- CLI root command and flags: `src/index.ts`.
- Project shape and generated project contract: `src/core/generated-project-contract.ts`.
- Generation pipeline: `src/core/generator.ts`.
- Template rendering: `src/core/template.ts` and `templates/`.
- Static copied files: `template-sources/` and `template-sources/manifest.json`.
- Generated setup/bootstrap preset sources: `template-sources/base/scripts/setup/`.
- Output contract tests: `src/core/project-contract.test.ts` and
  `scripts/testing/generated-project-contract-runner.ts`.

## Invariants

1. A project cannot disable backend unless the TanStack frontend is enabled.

   Evidence: `resolveProjectShape` in `src/core/generated-project-contract.ts`,
   `normalizeFlagOptions` and interactive collection in `src/core/prompts.ts`, and CLI error
   formatting in `src/index.ts`.

2. The Effect starter requires the backend starter.

   Evidence: `resolveProjectShape`, `normalizeFlagOptions`, `collectOptionsWithRuntime`, and
   `formatCliError`.

3. Generation refuses a non-empty destination unless no sensitive conflict exists and the
   destination is empty.

   Evidence: `ensureDestinationIsSafe` in `src/core/conflicts.ts`; generation calls it before
   writing in `src/core/generator.ts`.

4. Backend native bootstrap runs `bun init --yes` when backend is enabled.

   Evidence: `bootstrapBackendNative` and `generateProjectWithRuntime` in `src/core/generator.ts`.

5. TanStack frontend native bootstrap runs `bun x --yes @tanstack/cli@0.68.0 create frontend`
   under `apps/` with router-only, Bun package manager, React framework, no install, no git, and
   no examples.

   Evidence: `TANSTACK_CLI_PACKAGE`, `tanStackFrontendBootstrapCommand`, and
   `bootstrapFrontendNative` in `src/core/generator.ts`.

6. Native cleanup removes fixed root native files for every generated project and additional
   TanStack native paths when the frontend is enabled.

   Evidence: `BASE_CLEANUP_PATHS`, `FRONTEND_CLEANUP_PATHS`, and `cleanupPathsForShape` in
   `src/core/generated-project-contract.ts`; `cleanupNativeScaffold` in `src/core/generator.ts`.

7. Preset copies are selected from `base`, `frontend-tanstack`, `ai`, and `effect` according to
   project shape and copied paths from `template-sources/manifest.json`.

   Evidence: `PRESET_NAMES`, `presetNamesForShape`, `parsePresetCopyManifest`, and
   `presetCopySpecsForShape` in `src/core/generated-project-contract.ts`.

8. Templates receive rendered values from the generated project contract. Templates do not own
   dependency condition evaluation.

   Evidence: `renderTemplateFromContract` and `templateValuesFromContract` in `src/core/template.ts`;
   dependency section resolution happens before template rendering in
   `buildGeneratedProjectContract`.

9. The generated `setup` script is part of the root generated package contract and runs generated
   setup/bootstrap sources. When generation finalization installs dependencies, it runs
   `bun run setup` after `bun install`.

   Evidence: `packageJsonContractForContext`, `template-sources/base/scripts/setup/`, and
   `finalizeProject` in `src/core/install.ts`.

10. The root generated package exposes only the public scripts modeled by the generated project
   contract. Generated projects do not expose maintainer-only release, sandbox, or generated
   dependency sync/check scripts.

   Evidence: `packageJsonContractForContext` in `src/core/generated-project-contract.ts` and
   public script assertions in `src/core/project-contract.test.ts`.

11. Finalization optionally syncs agent files, initializes Git, installs dependencies, runs setup,
    and attempts `mise install`; all of these are controlled by generated options.

    Evidence: `finalizeProject`, `syncAgentsIfEnabled`, and `maybeInstallMiseWithRuntime` in
    `src/core/install.ts`.

## Commands

- `bun run dev` runs the CLI from source through `src/index.ts`.
- `bun run test:project-contract` verifies generated project contract behavior.
- `bun run validate:generated` runs generated dependency freshness before generated project
  contract tests.
- `bun run validate:sandbox` runs sandbox scenarios that install and execute generated projects.

## Non-Responsibilities

- Generation does not decide whether generated dependency versions match the maintainer repo;
  the generated-dependencies domain owns that.
- Generation owns setup/bootstrap inclusion and finalization invocation, but setup script behavior
  remains visible through generated setup sources and generated project contract tests.
- Generation does not plan safe writes into existing projects; adoption owns that.
- Generation does not publish, tag, or release packages.

## Known Ambiguities

- The `effect` preset currently copies `.gitkeep`, while most Effect behavior comes from templates
  and dependency conditions. Treat this as current behavior, not proof that all future Effect
  behavior belongs in preset copies.
