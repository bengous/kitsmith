# Agent Tooling Contract

## Responsibility

The agent-tooling domain owns AI-agent instruction files, generated `AGENTS.md` sync/check,
Claude/Codex hook wiring, shared hook runtime files, and the boundary between generated project
agent tooling and Kitsmith parent repo tooling sync.

## Product Surfaces

- **Claude-Native Source** files: `CLAUDE.md` and `.claude/rules/`.
- Generated agent files and manifest: `AGENTS.md`, nested `AGENTS.md` files, and
  `.agents/agents-md-manifest.json`.
- Agent sync/check: `scripts/agents/sync-agents-md.ts`.
- Hook runtime and wrappers: `.agents/scripts/hooks/`, `.codex/hooks/`, `.claude/hooks/`.
- Generated AI sources: `template-sources/ai/`.
- Parent sync: `scripts/sync/parent-tooling.ts`.
- Generated project contract assertions: `src/core/project-contract.test.ts`.

## Invariants

1. **Claude-Native Source** files are the source of truth for generated `AGENTS.md` files.

   Evidence: script header and constants `RULES_DIR`, `ROOT_MD`, and `ROOT_AGENTS_MD` in
   `scripts/agents/sync-agents-md.ts`.

2. Layer `AGENTS.md` files contain only matched Claude rule bodies, not duplicated root context.

   Evidence: `parsePaths`, `stripFrontmatter`, `generateLayerAgentsMd`, and script header mapping.

3. Agent sync writes a manifest with generated paths, output metadata, source checksums, and
   version metadata.

   Evidence: `buildManifest` in `scripts/agents/sync-agents-md.ts`.

4. Agent check verifies byte-exact generated files, manifest path/metadata drift, stale files,
   LF line endings, and semantic layer content.

   Evidence: `checkGeneratedFile`, `checkManifest`, `checkStaleFiles`,
   `verifyLayerContent`, and `checkGeneratedState`.

5. Managed `AGENTS.md` files must not be symlinks.

   Evidence: `pathIsSymlink`, `managedPathRegularFileError`, and
   `ensureManagedPathIsRegularFile`.

6. Generated projects with AI enabled include Claude/Codex configs, hook wrappers, hook runtime,
   agent sync script, generated `AGENTS.md` files, and agent manifest.

   Evidence: `template-sources/manifest.json`, `finalizedFileSpecsForShape`, and
   `assertAiContract` in `src/core/project-contract.test.ts`.

7. Generated projects without AI enabled do not include Claude/Codex agent tooling or
   `agents:sync` root package script.

   Evidence: `assertAiContract` and `packageJsonContractForContext`.

8. Native hook wrappers stay thin and delegate to shared hook runtime files.

   Evidence: generated project contract assertions for `.codex/hooks/*`, `.claude/hooks/*`, and
   `.agents/scripts/hooks/*`.

9. Parent tooling sync replaces or merges only explicitly listed managed paths and refuses symlinked
   managed paths.

   Evidence: `PARENT_TOOLING_SYNC_RULES`, `planParentToolingSync`,
   `assertManagedPathIsNotSymlink`, and `applyParentToolingSync`.

10. Kitsmith parent self-adoption is rejected; parent tooling sync is the supported maintenance path.

    Evidence: `assertNotKitsmithParentSelfAdoption` in `src/core/adopt.ts`.

## Commands

Maintainer repo commands:

- `bun run agents:sync`
- `bun run agents:check`
- `bun run parent-tooling:sync`
- `bun run parent-tooling:check`

Generated project public script when AI tooling is enabled:

- `bun run agents:sync`

Generated projects do not expose `agents:check` as a public package script; generated validation
direct-runs the agent sync script as a hidden validation leaf.

## Non-Responsibilities

- Agent tooling does not define product behavior of generated apps.
- Agent tooling does not own validation lane membership, though it contributes hook and validation files.
- Local `.agents/skills` are not part of generated project output unless explicitly added to
  `template-sources/manifest.json`.

## Known Ambiguities

- Adoption can run agent sync with `--preserve-root`, which means the root `AGENTS.md` may be
  intentionally preserved in an existing target project. That is adoption behavior, not a general
  rule for generated projects.
