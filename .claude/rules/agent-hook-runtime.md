---
paths:
  - ".agents/scripts/hooks/**/*.ts"
---

## Shared Agent Hook Runtime

- `.agents/scripts/hooks` owns shared agent hook behavior.
- Keep harness-agnostic contracts in the shared layer.
- Keep business behavior in core modules; keep protocol translation in adapters.
- Preserve clear outcomes: allow, block, formatted output, updated tool output, and validation diagnostics should be explicit contract fields.
- Do not duplicate validation orchestration inside harness wrappers.
- Prefer small typed contracts over implicit object shapes.
