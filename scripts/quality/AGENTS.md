## Repo Automation Scripts

**Layer invariant**: These scripts protect the integrity of the kitsmith repo and verify that generated projects behave as intended.

**Setup scripts**: Bootstrap local repo behavior only. They should not hide product decisions or mutate generated-project content.

**Quality scripts**: Audit focused concerns with explicit intent. Keep them narrow and explainable.

**Testing scripts**: Prefer validating the real scaffolding flow end to end: native bootstrap, cleanup, overlay/render, install, and validate a disposable project.

**Smoke tests are architectural**: `scripts/testing/` is the enforcement point for generated-project contract changes. They should exercise the actual Bun bootstrap and optional TanStack bootstrap flows, not a simplified internal path.

**Product lens**: A repo-only improvement is incomplete if it weakens confidence in emitted projects.

## Validation And Quality Tooling

- These scripts are project tooling, not agent runtime.
- Keep public CLI entrypoints easy to find; put implementation helpers behind `internal/` or `shared/` when needed.
- `internal/` means private to validation entrypoints. `shared/` means reusable project quality logic consumed by validation and agent hooks.
- Fail fast with contextual errors. Do not silently swallow validation failures.
- When changing protected project surfaces, keep validation, Lefthook, Knip, JSCPD, Dependency Cruiser, and lint audits aligned.
- Prefer outcome-based orchestration: define the validation result, blocking reason, and output shape before adding process steps.
