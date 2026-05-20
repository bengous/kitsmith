# kitsmith

`kitsmith` is an opinionated Bun project scaffolder.

It generates projects by starting from native ecosystem bootstraps, then normalizing them into the kitsmith contract:

- backend starts from `bun init --yes`
- optional frontend starts from the official TanStack Router scaffold
- kitsmith then cleans native output, applies presets, renders templates, and finalizes install/bootstrap

## Repository Surfaces

- `src/` contains the scaffolder engine: CLI entrypoint, option collection, preset selection, template rendering, generated dependency resolution, and project finalization.
- `config/generated-dependencies/` contains the human-edited Pkl source for generated npm dependency data; `src/core/generated-dependencies.generated.ts` is the committed generated artifact.
- `templates/` contains tokenized files rendered with project-specific values and kitsmith-owned normalization.
- `template-sources/` contains stable preset files copied into generated projects as overlays on top of the native scaffold base.
- `scripts/` contains repo automation, validation, quality checks, AGENTS sync, parent-tooling sync, release preparation, and smoke tests.
- `docs/product/` contains domain contracts and ubiquitous language for product behavior.
- `docs/maintainer/` contains maintainer runbooks; it is guidance, not the primary source for agent-facing policy.
- `CLAUDE.md` and `.claude/rules/` are the source of truth for Codex-facing generated `AGENTS.md` files.

## Change Routing

Before editing, decide which surface owns the change:

- Engine behavior or generation flow: `src/`
- Generated dependency product data: `config/generated-dependencies/baseline.pkl`
- Generated dependency runtime artifact: run `bun run generated-dependencies:sync`; do not edit `src/core/generated-dependencies.generated.ts` directly
- Dynamic generated file with placeholders or conditional content: `templates/`
- Stable copied preset or repo standard shipped to generated projects: `template-sources/`
- Repo automation, validation, release prep, or sync logic: `scripts/`
- Product contracts and domain terminology: `docs/product/`
- Maintainer procedure/runbook text: `docs/maintainer/`
- Agent-facing rules: `CLAUDE.md` or `.claude/rules/`, then run `bun run agents:sync`

If a change touches generated-project behavior, check whether it belongs in one surface or must be reflected across copied presets, rendered templates, generated dependency data, product contracts, and validation.
Generated output also includes decisions about what native scaffold output is kept, replaced, or removed.

## Product Invariant

`kitsmith` dogfoods its own standards. A change is only complete when it keeps the scaffolder repo coherent and also preserves the quality of the projects it generates.

The generated project is part of the product contract. Visible output changes should be treated as deliberate product decisions, not as incidental side effects of internal refactors.

## Quality Output Defaults

`jscpd` uses the `ai` reporter and `noTips: true` intentionally in both the repo and generated projects.
The duplicate-code gate should emit stable check output for humans, CI, and agents; `noTips` only removes post-run promotional/tip lines and must not hide clone findings, errors, or exit codes.
