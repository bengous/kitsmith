---
paths:
  - "src/**/*.ts"
---

## Source Code Conventions

- Runtime: Bun.
- Keep imports ESM-only.
- Keep application code independent from generated-project tooling.
- Prefer minimal, behavior-preserving changes unless the user asks for a product change.
- Use existing local patterns before introducing new abstractions.
- Extract abstractions only when they reduce real duplication or clarify a repeated contract.
- Prefer explicit, straightforward code: clear names, strict types, typed states/data shapes, and visible error paths.
- Fail fast; propagate errors with useful context. Do not silently swallow failures.
- Add descriptive tests for behavior changes; keep test scope proportional to risk.
- Write comments only for complex logic, public APIs, or non-obvious behavior.
