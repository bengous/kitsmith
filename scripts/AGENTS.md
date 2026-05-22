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

### Kitsmith rule families

Kitsmith uses OXLint categories as raw inputs, but product decisions are made by
Kitsmith families. A rule is `error` when it is a rail for agents: type safety,
async safety, error propagation, import hygiene, frontend correctness, or a
mechanical convention with low ambiguity. A rule stays `warn` when it is a
refactor smell, style candidate, context-dependent performance hint, or likely to
need human judgment.

| Kitsmith family        | Error rails                                                                                             | Warn candidates                                                                                     | Surfaces                    | Rationale                                       |
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

## Scripts Layer

**Layer invariant**: `scripts/` contains standalone Bun automation for the repo and for confidence in generated projects.

**Role**: Scripts are tooling surfaces, not extensions of the scaffolder engine. They should stay explicit, deterministic, and easy to run independently.

**Boundary**: Avoid pushing product-generation logic into scripts when that logic belongs in `src/`. Scripts should orchestrate checks, bootstrap steps, sync tasks, and smoke verification.

**Failure mode**: Prefer clear exits and actionable errors over silent fallback behavior.
