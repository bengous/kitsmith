---
paths:
  - ".codex/hooks/**/*.ts"
  - ".claude/hooks/**/*.ts"
---

## Native Hook Wrappers

- Native hook folders adapt each harness protocol to the shared agent hook runtime.
- Keep wrappers thin: parse native input, call the shared adapter/runtime, print the native response.
- Do not add project validation logic directly in native wrappers.
- Codex and Claude may expose different hook capabilities; model those differences in adapters, not by branching throughout core logic.
- Preserve harness-specific behavior such as Claude `updatedToolOutput` when supported.
