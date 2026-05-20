# Kitsmith Domain Map

This map is an index, not a second contract. Domain behavior belongs in each linked
`CONTRACT.md`; domain vocabulary belongs in each linked `UBIQUITOUS_LANGUAGE.md`.

## Source Hierarchy

1. Domain contracts are authoritative for domain behavior.
2. Domain ubiquitous-language files are authoritative for domain-specific terms.
3. Global docs contain only cross-domain terms, invariants, and routing.

## Domains

| Domain | Canonical docs | Owns |
| --- | --- | --- |
| Generation | [Contract](./generation/CONTRACT.md), [Language](./generation/UBIQUITOUS_LANGUAGE.md) | New project generation through `kitsmith [destination]`. |
| Adoption | [Contract](./adoption/CONTRACT.md), [Language](./adoption/UBIQUITOUS_LANGUAGE.md) | Existing project adoption through `kitsmith adopt`. |
| Generated Dependencies | [Contract](./generated-dependencies/CONTRACT.md), [Language](./generated-dependencies/UBIQUITOUS_LANGUAGE.md) | The npm dependency model emitted into generated projects. |
| Validation | [Contract](./validation/CONTRACT.md), [Language](./validation/UBIQUITOUS_LANGUAGE.md) | Local, hook, CI, generated-project, and sandbox validation behavior. |
| Release | [Contract](./release/CONTRACT.md), [Language](./release/UBIQUITOUS_LANGUAGE.md) | Release preparation, tarball checks, and publish/tag boundaries. |
| Agent Tooling | [Contract](./agent-tooling/CONTRACT.md), [Language](./agent-tooling/UBIQUITOUS_LANGUAGE.md) | Agent instructions, hook wrappers, AGENTS sync, and parent/generated agent tooling boundaries. |

## Cross-Domain Routing

- Generated output behavior usually routes to **Generation** first, then to the contributing
  domain if the emitted content is owned elsewhere.
- Existing-project write policy routes to **Adoption**.
- Dependency version/product data routes to **Generated Dependencies**.
- Validation command behavior and CI routing route to **Validation**.
- Publish, tag, package inspection, and release approval route to **Release**.
- Agent instruction and hook content routes to **Agent Tooling**.
