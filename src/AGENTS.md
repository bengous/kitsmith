## Antipattern Coverage

Last audit: 2026-05-20 | OXLint 1.65.0 | TypeScript 6.0.3 | Bun 1.3.14

Active rules: 252 | Available candidates: 459

When upgrading OXLint, TypeScript, or Bun, run `/antipattern-audit`.

### Coverage by plugin

| Plugin     | Active | Focus                                                                          |
| ---------- | ------ | ------------------------------------------------------------------------------ |
| eslint     | 99     | Correctness, best practices, no-unused-vars at error                           |
| typescript | 73     | Type safety, no-explicit-any, no-unsafe-* flow, strict-boolean-expressions     |
| unicorn    | 40     | Modern JS idioms, array method safety                                          |
| oxc        | 21     | Oxc-specific: bad comparisons, const analysis, erasing ops                     |
| import     | 19     | Module hygiene: no-cycle, no-default-export, consistent-type-specifier         |

### Key enforcement levels

| Antipattern                | Rule(s)                                              | Level |
| -------------------------- | ---------------------------------------------------- | ----- |
| Unused variables           | no-unused-vars                                       | error |
| Explicit `any`             | no-explicit-any                                      | error |
| Floating promises          | no-floating-promises                                 | error |
| Awaiting non-thenables     | await-thenable                                       | error |
| Misused spread             | no-misused-spread                                    | error |
| Misused promises           | no-misused-promises                                  | error |
| Unsafe type assertions     | no-unsafe-type-assertion                             | error |
| Unsafe `any` flow          | no-unsafe-assignment, no-unsafe-call, no-unsafe-*    | error |
| Unreachable code           | no-unreachable                                       | error |
| Invalid regex              | no-invalid-regexp                                    | error |
| Duplicate keys/cases       | no-dupe-keys, no-duplicate-case                      | error |
| Constant conditions        | no-constant-condition, no-constant-binary-expression | error |
| Regex literals             | prefer-regex-literals                               | error |
| Callback `this` drift      | prefer-arrow-callback                               | error |
| Implicit globals           | no-implicit-globals                                 | error |
| Import cycles              | import/no-cycle                                      | warn  |
| Shared branch code         | branches-sharing-code                                | warn  |
| Inefficient set lookup     | prefer-set-has                                       | warn  |
| Strict boolean expressions | strict-boolean-expressions                           | warn  |
| Consistent type imports    | consistent-type-imports                              | warn  |
| Prefer nullish coalescing  | prefer-nullish-coalescing                            | warn  |
| Cognitive complexity       | oxlint-plugin-complexity                             | warn  |

### Bonforge rule families

Bonforge uses OXLint categories as raw inputs, but product decisions are made by
Bonforge families. A rule is `error` when it is a rail for agents: type safety,
async safety, error propagation, import hygiene, frontend correctness, or a
mechanical convention with low ambiguity. A rule stays `warn` when it is a
refactor smell, style candidate, context-dependent performance hint, or likely to
need human judgment.

| Bonforge family        | Error rails                                                                                             | Warn candidates                                                                                     | Surfaces                    | Rationale                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Type safety            | no-explicit-any, no-unsafe-*, no-unsafe-type-assertion, no-unsafe-enum-comparison, no-redundant-types   | strict-boolean-expressions, restrict-plus-operands, no-unnecessary-condition                        | repo, scaffold base, frontend | Block unsafe flows; keep noisy inference rules as pressure. |
| Async safety           | no-floating-promises, no-misused-promises, await-thenable, return-await                                 | promise-function-async, no-await-in-loop                                                            | repo, scaffold base, frontend | Block broken async; allow deliberate sequential IO. |
| Error handling         | only-throw-error, missing-throw, no-promise-executor-return                                             | unicorn/error-message, prefer-type-error                                                            | repo, scaffold base, frontend | Throw real errors and avoid swallowed throws.   |
| Exhaustiveness/flow    | switch-exhaustiveness-check, consistent-return, no-fallthrough, no-unreachable                          | branches-sharing-code, complexity/complexity                                                        | repo, scaffold base, frontend | Block ambiguous control flow; keep refactor smells advisory. |
| Import hygiene         | no-default-export, first, no-duplicates, consistent-type-specifier-style, consistent-type-imports        | no-cycle, extensions, no-commonjs, no-dynamic-require, unambiguous                                  | repo, scaffold base, frontend | Normalize module shape; keep layout-dependent rules advisory. |
| Mechanical conventions | logical-assignment-operators, no-implicit-globals, object-shorthand, no-unnecessary-template-expression, prefer-arrow-callback, prefer-set-has, prefer-regex-literals | prefer-array-find, prefer-array-flat-map, prefer-string-replace-all, prefer-optional-chain          | repo, scaffold base, frontend | Enforce simple low-ambiguity conventions; keep taste/perf calls advisory. |
| Frontend accessibility | alt-text, aria-props, control-has-associated-label, heading-has-content, interactive-supports-focus, label-has-associated-control, no-interactive-element-to-noninteractive-role, no-noninteractive-element-interactions, no-noninteractive-element-to-interactive-role, no-redundant-roles, prefer-tag-over-role | none currently                                                                                      | scaffold frontend           | Generated frontends must be keyboard/a11y safe. |
| React correctness      | button-has-type, no-did-update-set-state, jsx-key, jsx-no-duplicate-props, jsx-no-undef                 | self-closing-comp                                                                                   | scaffold frontend           | Block React correctness bugs; keep presentation style advisory. |

### Known gaps

| Gap                        | Reason                                          | Revisit when                     |
| -------------------------- | ----------------------------------------------- | -------------------------------- |
| Schema-level JSON parsing  | Guards are manual, no schema library            | External JSON contracts grow     |
| Broad path nominal typing  | Only adoption relative paths are branded        | More path domains appear         |

## Pragmatic Functional Style

**Use pure helpers for**: classification, planning, summarizing, token generation, manifest metadata, and command specs.

**Keep boundaries imperative**: CLI parsing, `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.spawnSync`, cleanup, and process exits should stay direct.

**Prefer explicit collections when clearer**: Use `for`, `Map`, `Set`, or `Record` for indexing, counting, deduping, and stateful parsing when chained array methods hide intent.

**No FP library**: Do not add a functional-programming dependency for local script or scaffolder cleanup.

## Preset Composition

**Composition order**: Presets compose explicitly over a project that has already been bootstrapped and cleaned. Base comes first, optional overlays come after, and template rendering happens after preset copies.

**Ownership rule**: Each emitted file should have a clear owner:

- copied from a preset source
- rendered from a template
- finalized by an explicit generation step

**Avoid hidden coupling**: If multiple presets influence the same emitted file, make ownership explicit. Prefer a single template or a clearly defined overlay rule over accidental last-write-wins behavior.

**No native reliance**: Presets must not depend on incidental files left behind by Bun or TanStack scaffolds. If native scaffold output matters, cleanup and ownership should make that explicit first.

**No magic mutation**: Do not introduce cross-preset behavior that depends on implicit side effects, undocumented ordering assumptions, or ad hoc patching.

## Preset Topology

**Topology rule**: kitsmith currently ships a small explicit preset set:

- `base` provides the common project foundation
- `frontend-tanstack` extends the foundation with frontend-specific output
- `ai` extends the foundation with AI-agent and context-sync tooling

**Composition rule**: These presets are additive layers over the same generated project, not separate product families. They sit on top of the native bootstrap base that kitsmith creates first.

**Contract rule**: Changing which preset owns a file, changing overlay expectations, or changing the topology of the preset set is a generated-project contract change.

**Design bias**: Prefer making preset boundaries clearer over adding convenience coupling between presets.

## Product Architecture

**Model**: `kitsmith` is a product that emits another product. The repository is organized around a fixed native-first generation pipeline:

- collect and normalize options
- bootstrap the backend with native Bun
- optionally bootstrap the frontend with the native TanStack scaffold
- clean native scaffold output that kitsmith does not keep
- copy preset sources
- render dynamic templates
- finalize install and bootstrap
- verify the emitted project through smoke tests

**Stage ownership**:

- `src/` owns orchestration, native bootstrap routing, and cleanup decisions
- `template-sources/` owns stable copied overlays
- `templates/` owns declared output variation and kitsmith-owned normalization
- `scripts/testing/` proves the emitted product still works

**Do not collapse stages**: A stage should not quietly absorb another stage's responsibility. Native bootstrap, cleanup, preset overlays, and template rendering are separate product stages and should stay explicit.

**Architecture bias**: Prefer explicit ownership and visible product flow over convenience shortcuts.

## Scaffolder Source

**Layer invariant**: `src/` owns generation behavior, not emitted project content. Keep the engine focused on orchestration, option normalization, native bootstrap, cleanup routing, preset selection, template rendering, and finalization.

**Ownership**: `src/` decides how generation works, how native scaffolds are invoked, which native files are cleaned up, and which surface owns a change. It should not become a storage layer for preset payload or emitted-file policy that belongs elsewhere.

**Option rule**: If a CLI flag or prompt changes generated output, that output must still have an explicit owner in `templates/`, `template-sources/`, or an intentional finalization step. `src/` may route the change and decide native cleanup, but it should not quietly become the place where emitted file content is patched.

**Keep separate**:

- prompt and flag handling
- native backend and frontend bootstrap orchestration
- cleanup of native scaffold output
- naming and path helpers
- preset selection and copy orchestration
- template rendering
- install and bootstrap finalization

**Do not hardcode product files**: If a change mainly alters generated file content, prefer `templates/` or `template-sources/` instead of embedding the detail in engine code.

**Do not bypass surfaces**: If a behavior depends on preset payload, model it through preset selection, template rendering, or explicit finalization flow. Avoid engine-only shortcuts that silently override generated content policy or rely on incidental native scaffold leftovers.

**Verification rule**: New generation branches need a verification story. Pure orchestration logic should have targeted tests, and output-changing behavior should remain covered by smoke validation.

**Design bias**: Favor small composable helpers over feature-specific branching in the CLI entrypoint.
