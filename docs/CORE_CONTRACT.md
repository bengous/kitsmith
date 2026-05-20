# Kitsmith Core Contract

This file records only cross-domain product invariants. Domain-specific behavior is authoritative
in the contracts linked from [DOMAIN_MAP.md](./DOMAIN_MAP.md).

## Invariants

1. Kitsmith has two public project flows: create a **Generated Project** and adopt a
   **Target Project**.

   Authoritative domains: [Generation](./generation/CONTRACT.md),
   [Adoption](./adoption/CONTRACT.md).

2. Generated projects are part of the product contract. Changes to generated files, scripts,
   dependencies, validation, or agent guidance are product changes.

   Authoritative domains: [Generation](./generation/CONTRACT.md),
   [Generated Dependencies](./generated-dependencies/CONTRACT.md),
   [Validation](./validation/CONTRACT.md),
   [Agent Tooling](./agent-tooling/CONTRACT.md).

3. Maintainer tooling and generated-project tooling are separate surfaces. A command or file may
   exist in both only when the owning domain explicitly models that relationship.

   Authoritative domains: [Validation](./validation/CONTRACT.md),
   [Release](./release/CONTRACT.md),
   [Agent Tooling](./agent-tooling/CONTRACT.md).

4. Human-edited sources and generated artifacts must stay distinguishable. Generated artifacts are
   committed only when an owning source and check path exist.

   Authoritative domains: [Generated Dependencies](./generated-dependencies/CONTRACT.md),
   [Agent Tooling](./agent-tooling/CONTRACT.md).

5. Release preparation verifies release readiness but does not publish, tag, or push.

   Authoritative domain: [Release](./release/CONTRACT.md).

## Non-Goals

- This global contract does not restate domain evidence.
- This global contract does not define domain-specific command membership, file lists, or package
  versions.
- This global contract does not replace source-code tests or validation lanes.
