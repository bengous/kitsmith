# Generated Dependencies Contract

## Responsibility

The generated-dependencies domain owns the npm dependency product model that Kitsmith emits into
generated projects. It defines dependency versions, package ownership policy, target-specific
emissions, conditions, compatibility groups, sync behavior, and read-only drift checks.

## Product Surfaces

- Pkl schema: `config/generated-dependencies/GeneratedDependencies.pkl`.
- Editable baseline source: `config/generated-dependencies/baseline.pkl`.
- Committed runtime artifact: `src/core/generated-dependencies.generated.ts`.
- Runtime resolver: `src/core/generated-dependencies.ts`.
- Sync/check command: `scripts/sync/generated-dependencies.ts`.
- Maintainer docs: `docs/generated-dependencies/UBIQUITOUS_LANGUAGE.md` and
  `docs/maintainer-validation.md`.

## Invariants

1. The Pkl baseline is the human-edited source of truth for generated npm dependency data.

   Evidence: `GENERATED_DEPENDENCIES_BASELINE_PATH` in `scripts/sync/generated-dependencies.ts`,
   `config/generated-dependencies/baseline.pkl`, and generated artifact header comments.

2. The generated TypeScript artifact is committed and consumed at runtime; users of
   `kitsmith [destination]` do not need Pkl.

   Evidence: `src/core/generated-dependencies.generated.ts` imports no Pkl code; runtime resolution
   imports `GENERATED_DEPENDENCY_EMISSIONS_BY_TARGET`; docs state Pkl is maintainer-only.

3. Every generated dependency has one package-level version and one or more target-specific
   Dependency Emissions.

   Evidence: `GeneratedDependency` and `DependencyEmission` in
   `config/generated-dependencies/GeneratedDependencies.pkl`; `parseGeneratedDependency` rejects
   missing or empty emissions.

4. Supported dependency targets are exactly `root.dependencies`, `root.devDependencies`,
   `frontend.dependencies`, and `frontend.devDependencies`.

   Evidence: `DEPENDENCY_TARGETS` in `scripts/sync/generated-dependencies.ts` and
   `DependencyTarget` in the generated artifact.

5. Supported condition keys are exactly `backend`, `frontend`, `ai`, and `effect`; supported
   frontend condition values currently contain only `tanstack`.

   Evidence: `CONDITION_KEYS`, `FRONTEND_VALUES`, and `parseConditions` in
   `scripts/sync/generated-dependencies.ts`.

6. Missing conditions on an emission mean the emission is always active.

   Evidence: `DependencyEmission.conditions` default in Pkl and `conditionMatches` in
   `src/core/generated-dependencies.ts`.

7. A `frontend.*` emission must declare `conditions.frontend`.

   Evidence: `parseEmission` in `scripts/sync/generated-dependencies.ts`.

8. Effect packages require `conditions.effect = true`.

   Evidence: `isEffectPackage` and the Effect check in `parseEmission`.

9. Shared dependencies must appear exactly once in the parent `package.json` dependency sections
   and must match the baseline version.

   Evidence: `validateParentDependencyDrift` in `scripts/sync/generated-dependencies.ts`.

10. Compatibility groups are bidirectional maintainer invariants, not categories. `same-major`
    compares the first dot-separated version component in baseline versions; `review-together`
    checks membership integrity.

    Evidence: `CompatibilityGroup` in Pkl, `COMPATIBILITY_GROUP_POLICIES`, and
    `validateCompatibilityGroups`.

11. Sync regenerates the TypeScript artifact from Pkl. It does not copy parent versions into Pkl.

    Evidence: `syncGeneratedDependencies` reads Pkl output and writes only the artifact path.

12. Check is read-only and fails when Pkl evaluation, parent drift, or artifact freshness fails.

    Evidence: `checkGeneratedDependencies`.

13. Runtime dependency assembly resolves dependency sections by project shape and target, then the
    generated project contract consumes those sections.

    Evidence: `resolveGeneratedDependencySections` in `src/core/generated-dependencies.ts` and
    `buildGeneratedProjectContract` in `src/core/generated-project-contract.ts`.

## Commands

- `bun run generated-dependencies:sync` writes `src/core/generated-dependencies.generated.ts`.
- `bun run generated-dependencies:check` evaluates Pkl, checks parent drift, and checks artifact
  freshness.
- `bun run check`, `bun run validate`, `bun run validate:deep`, and `bun run validate:generated`
  include generated dependency freshness through validation plans.

## Non-Responsibilities

- This domain does not manage non-npm tools such as Pkl, Cocogitto, Lychee, or GitHub Actions tools.
- This domain does not run generated projects; sandbox validation owns real install/runtime checks.
- This domain does not define project shape; generation owns shape normalization.

## Known Ambiguities

- "Shared" means version-aligned with the maintainer repo, not necessarily emitted to every target.
- `review-together` is a documented review invariant, not a semver solver.
