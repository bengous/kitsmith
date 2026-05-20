---
paths:
  - "config/generated-dependencies/**"
---

## Generated Dependencies

- `config/generated-dependencies/baseline.pkl` is the human-edited source of truth for npm dependency data emitted into generated projects.
- Changes to the generated dependency baseline are product contract changes because they alter generated `package.json` dependency output.
- Do not edit `src/core/generated-dependencies.generated.ts` directly. Regenerate it with `bun run generated-dependencies:sync`.
- After changing the baseline or generated dependency sync logic, run `bun run generated-dependencies:sync` and `bun run generated-dependencies:check`.
