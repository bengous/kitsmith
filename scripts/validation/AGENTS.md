## Validation Scripts

**Layer invariant**: Validation scripts implement progressive, scope-aware feedback for the repo and for generated projects.

**Progressive model**:

- edit-level feedback should stay cheap and local
- stop and hook validation should stay scope-aware
- full validation should remain independent and reproducible

**Shared logic**: Scope detection belongs in shared validation helpers, not duplicated across each script.

**Boundary**: Do not couple these scripts to scaffolder engine internals. They are external tooling, not part of runtime generation flow.

**Decision bias**: When changing validation behavior, optimize for trustworthy signal and predictable developer feedback rather than maximal cleverness.

## Validation And Quality Tooling

- These scripts are project tooling, not agent runtime.
- Keep public CLI entrypoints easy to find; put implementation helpers behind `internal/` or `shared/` when needed.
- `internal/` means private to validation entrypoints. `shared/` means reusable project quality logic consumed by validation and agent hooks.
- Fail fast with contextual errors. Do not silently swallow validation failures.
- When changing protected project surfaces, keep validation, Lefthook, Knip, JSCPD, Dependency Cruiser, and lint audits aligned.
- Prefer outcome-based orchestration: define the validation result, blocking reason, and output shape before adding process steps.
