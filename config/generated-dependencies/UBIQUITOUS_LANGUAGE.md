# Ubiquitous Language

## Generated dependency model

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Generated Dependency Baseline** | The editable product definition of npm dependencies that Kitsmith emits into generated projects. | Baseline, source, parent deps |
| **Generated Dependency** | An npm package entry that Kitsmith writes into a generated project's `package.json`. | Dependency, package |
| **Parent Dependency** | An npm package entry declared by the Kitsmith repo's own `package.json`. | Repo dependency, local dependency |
| **Shared Dependency** | A generated dependency whose version must match the parent dependency version. | Mirrored dependency, synced dependency |
| **Scaffold-Only Dependency** | A generated dependency whose version is owned by the generated project product model, not by the parent repo. | Product dependency, frontend dependency |
| **Dependency Target** | A generated `package.json` section where a dependency is emitted. | Target, output, destination |
| **Dependency Emission** | One rule that emits a generated dependency into one dependency target when its conditions match the generated project shape. | Emission, emitted target, placement |
| **Condition** | A generated project shape requirement that controls when a dependency is emitted. | Preset flag, gate |
| **Compatibility Group** | A named maintainer invariant for generated dependencies that must be reviewed together because they have a real compatibility relationship. | Coupled deps, dependency family, package category |
| **Compatibility Policy** | The rule that explains why a compatibility group exists and how it is checked. | Group type, group reason |
| **Same-Major Policy** | A compatibility policy requiring every package in the group to share one SemVer major. | Major alignment, same version family |
| **Review-Together Policy** | A compatibility policy requiring grouped package bumps to be reviewed as one coupled set when no simple machine rule exists. | Manual group, soft group |

## Source and artifact model

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Pkl Source** | The human-edited typed configuration that defines the generated dependency baseline. | YAML, config, schema |
| **Generated Dependency Artifact** | The committed TypeScript file generated from the Pkl source and consumed by Kitsmith at runtime. | Generated TS, artifact, output |
| **Sync** | The operation that regenerates the generated dependency artifact from the Pkl source. | Update, refresh, repair |
| **Check** | The read-only operation that verifies the Pkl source, generated artifact, and declared invariants agree. | Validate, test |
| **Parent Drift** | A mismatch between a shared dependency version in the generated dependency baseline and the parent dependency version. | Version drift, repo drift |
| **Artifact Drift** | A mismatch between the Pkl source and the generated dependency artifact. | Generated drift, stale output |
| **Lockfile** | The package-manager artifact that records exact installed dependency resolutions for the repo. | Baseline, source of truth |

## Validation workflow

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Bump Workflow** | The maintainer flow for changing dependency versions, regenerating artifacts, validating, and committing the complete change. | Batch update, dependency update |
| **Fast Check Lane** | The local read-only validation lane intended to catch core drift before commit. | Check, quick validate |
| **Generated Validation Lane** | The validation lane that verifies the generated project product contract. | Contract tests, generated tests |
| **Sandbox Validation Lane** | The validation lane that installs and executes generated projects in disposable sandboxes. | Smoke tests, deep tests |

## Relationships

- A **Generated Dependency Baseline** is authored in one **Pkl Source**.
- A **Pkl Source** produces exactly one **Generated Dependency Artifact** through **Sync**.
- A **Generated Dependency Artifact** is consumed by Kitsmith to emit many **Generated Dependencies**.
- A **Generated Dependency** has one or more **Dependency Emissions**.
- A **Dependency Emission** has exactly one **Dependency Target**.
- A **Dependency Emission** may have zero or more **Conditions**; no **Condition** means always emitted.
- A **Shared Dependency** must have exactly one matching **Parent Dependency**.
- A **Compatibility Group** must have exactly one **Compatibility Policy**.
- A **Compatibility Group** is valid only when every listed **Generated Dependency** declares the same group and every grouped **Generated Dependency** is listed by that group.
- A **Compatibility Group** is enforced by **Check**, not by `bun install`.
- **Parent Drift** is detected by **Check**, not repaired automatically by **Sync**.
- A **Lockfile** belongs to package-manager reproducibility and is not a **Generated Dependency Baseline**.

## Example dialogue

> **Dev:** "When I bump `oxlint` in the parent repo, do I edit the **Generated Dependency Baseline** too?"
>
> **Domain expert:** "Yes, if `oxlint` is a **Shared Dependency**. The **Check** should fail until the **Pkl Source** and the **Parent Dependency** agree."
>
> **Dev:** "Then does **Sync** copy the parent version into Pkl automatically?"
>
> **Domain expert:** "No. **Sync** only regenerates the **Generated Dependency Artifact** from the **Pkl Source**. A human or agent must make the product decision explicitly."
>
> **Dev:** "And `bun.lock`?"
>
> **Domain expert:** "That is a **Lockfile**, not the **Generated Dependency Baseline**. It must be tracked, but it does not define what Kitsmith emits."
>
> **Dev:** "Can I put all frontend tools in one **Compatibility Group**?"
>
> **Domain expert:** "No. A **Compatibility Group** needs a real **Compatibility Policy**. Use **Same-Major Policy** when the rule is machine-checkable, or **Review-Together Policy** when the packages are coupled but require human review."

## Flagged ambiguities

- "Baseline" is too vague by itself. Prefer **Generated Dependency Baseline** when referring to the Pkl-owned product definition.
- "Dependency" can mean **Parent Dependency** or **Generated Dependency**. State which one when discussing drift.
- "Emission" by itself is too vague. Prefer **Dependency Emission** in docs and errors.
- "Sync" must not mean "copy parent versions into Pkl". It means regenerating the **Generated Dependency Artifact** from the **Pkl Source**.
- "Check" and "validate" were used interchangeably. Prefer **Check** for this read-only invariant and reserve validation lane names for broader command groups.
- "Frontend dependency" can mean a **Scaffold-Only Dependency** or a **Shared Dependency** emitted to `frontend.*`; use **Dependency Target** plus ownership term.
- `bun.lock` is tracked, but it is a **Lockfile**, not a dependency baseline or product source of truth.
- "Compatibility Group" must not mean "category". It is a maintainer invariant for coupled generated dependencies, and every group must have a clear **Compatibility Policy**.
