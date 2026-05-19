---
paths:
  - "scripts/validation/**/*.ts"
  - "scripts/quality/**/*.ts"
---

## Validation And Quality Tooling

- These scripts are project tooling, not agent runtime.
- Keep public CLI entrypoints easy to find; put implementation helpers behind `internal/` or `shared/` when needed.
- `internal/` means private to validation entrypoints. `shared/` means reusable project quality logic consumed by validation and agent hooks.
- Fail fast with contextual errors. Do not silently swallow validation failures.
- When changing protected project surfaces, keep validation, Lefthook, Knip, JSCPD, Dependency Cruiser, and lint audits aligned.
- Prefer outcome-based orchestration: define the validation result, blocking reason, and output shape before adding process steps.
