# Adoption Contract

## Responsibility

The adoption domain owns `kitsmith adopt [destination]`: it inspects an existing Bun/TypeScript
project, derives project identity, builds a dry-run adoption plan, optionally applies writable
actions with backups, and supports rollback for manifest-recorded file writes.

## Product Surfaces

- CLI subcommand: `src/index.ts`.
- Adoption planning and apply/rollback: `src/core/adopt.ts`.
- Policy for preserved, skipped, conflicting, and merged files: `src/core/adoption-policy.ts`.
- Optional adoption finalization: `src/core/install.ts`.
- Tests: `src/core/adopt.test.ts` and related CLI tests in `src/index.test.ts`.

## Invariants

1. Adoption requires an existing `package.json` and `tsconfig.json`.

   Evidence: `assertAdoptableProject` in `src/core/adopt.ts`.

2. Adoption currently supports Bun/TypeScript projects only.

   Evidence: `packageHasBunSignal` and `assertAdoptableProject` check scripts, dependencies,
   devDependencies, and Bun-style bin signals.

3. Adoption defaults differ from generation: `install` defaults to `false`, `gitInit` is forced
   off through adopted project description, and `lintSeverity` defaults to `warn`.

   Evidence: `normalizeAdoptOptions`, `describeAdoptedProject`, and `collectAdoptOptionsWithRuntime`
   in `src/core/adopt.ts` and `src/core/prompts.ts`.

4. Kitsmith refuses self-adoption of the Kitsmith parent repo and points maintainers to parent
   tooling sync commands instead.

   Evidence: `isKitsmithParentRepo` and `assertNotKitsmithParentSelfAdoption` in `src/core/adopt.ts`.

5. Adoption copies preset files through adoption policy, but existing frontend workspaces are not
   converted in adopt v1.

   Evidence: `hasExistingFrontend`, `shouldOmitPresetDuringAdopt`,
   `shouldOmitTemplateDuringAdopt`, and `planExistingFrontendConflict`.

6. Adoption merges `package.json` scripts, dependencies, devDependencies, and workspaces while
   preserving existing entries.

   Evidence: `planPackageJson`, `mergeAdoptedPackageJson`, `mergeObjectsPreservingExisting`, and
   `mergeStringArrayPreservingExisting`.

7. Existing project source files `src/index.ts` and `src/index.test.ts` are skipped, not overwritten.

   Evidence: `adoptionTemplatePolicy` in `src/core/adoption-policy.ts`.

8. Some guidance files are preserved if they already exist, including `CLAUDE.md` and the legacy
   Claude rule paths explicitly listed in the adoption policy. Current generated AI rule template
   paths are not part of that preserve list unless the policy is updated.

   Evidence: `shouldPreserveExistingTemplate` and `templatePreserveReason`.

9. Applying an adoption plan backs up each modified file before writing that file and records
   created/modified entries in memory while writable actions run. The backup manifest is persisted
   after writable actions complete, and rollback uses the persisted manifest in reverse order.
   Rollback does not undo post-apply agent sync output, dependency installs, setup side effects, or
   `mise install` side effects.

   Evidence: `applyAdoptionPlan`, `backupExistingFile`, `rollbackAdoption`, and
   `rollbackBackupEntry`.

10. When AI tooling is enabled and the target project contains the agent sync script, adoption runs
    `scripts/agents/sync-agents-md.ts --write --preserve-root` after applying files.

    Evidence: `applyAdoptionPlan` in `src/core/adopt.ts` and adoption-specific package scripts in
    `withAdoptionPackageScripts`.

11. When adoption is applied with `--install`, adoption runs project finalization after file writes
    and agent sync. Adopted finalization disables Git initialization and agent sync, but it may run
    dependency install, generated setup, and `mise install`.

    Evidence: `applyAdoptionPlan` in `src/core/adopt.ts` and `finalizeProject` in
    `src/core/install.ts`.

## Commands

- `kitsmith adopt [destination]` prints a dry-run adoption plan.
- `kitsmith adopt [destination] --apply` applies writable actions.
- `kitsmith adopt [destination] --apply --install` applies writable actions and then runs adopted
  project finalization.
- `kitsmith adopt [destination] --rollback <runId>` rolls back a backup run.
- `--lint-severity warn|error` selects copied OXLint rule severity for adoption.

## Non-Responsibilities

- Adoption does not bootstrap native Bun or TanStack projects.
- Adoption does not convert existing frontend workspaces in v1.
- Adoption does not rewrite existing commit history.
- Adoption rollback does not restore side effects that are not recorded in the backup manifest.

## Known Ambiguities

- Adoption currently uses the generated project description as input, but applies a different write
  policy. Future docs should keep "generated output" and "adoption plan" separate when describing
  file ownership.
- The current apply path writes the persisted backup manifest after `Promise.all` completes. If a
  write fails after another write succeeds but before the manifest is written, the filesystem may
  have changed without a persisted rollback manifest. This is current behavior, not a stronger
  rollback guarantee.
