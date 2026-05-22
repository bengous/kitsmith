# Agent Tooling Ubiquitous Language

## Agent Instruction Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Claude-Native Source** | `CLAUDE.md` or `.claude/rules/*.md`, read directly by Claude Code and used as the source for generated agent instructions. | Claude docs |
| **Generated AGENTS File** | An `AGENTS.md` file generated for non-Claude agents from Claude-native sources. | Agent doc |
| **Agent Manifest** | `.agents/agents-md-manifest.json`, the generated metadata used to detect AGENTS drift and stale outputs. | Manifest |
| **Layer AGENTS File** | A generated `AGENTS.md` scoped to one directory based on Claude rule path frontmatter. | Directory instructions |
| **Hook Runtime** | Shared TypeScript hook code under `.agents/hooks/` used by thin Claude and Codex wrappers. | Hook scripts |
| **Native Hook Wrapper** | A Claude or Codex hook file that delegates to the shared hook runtime. | Wrapper |

## Sync Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Agents Sync** | The operation that writes generated `AGENTS.md` files and the agent manifest from Claude-native sources. | Agent update |
| **Agents Check** | The read-only operation that verifies generated agent files and manifest metadata are fresh. | Agent validate |
| **Parent Tooling Sync** | Maintainer operation that mirrors selected generated-project tooling sources back into the Kitsmith parent repo. | Self adoption |

## Relationships

- **Claude-Native Source** files produce **Generated AGENTS Files** through **Agents Sync**.
- **Generated AGENTS Files** are tracked by the **Agent Manifest**.
- **Native Hook Wrappers** call the **Hook Runtime**.
- **Parent Tooling Sync** is the maintainer path for keeping the parent repo aligned with selected generated tooling.

## Flagged Ambiguities

- "Agent tooling" can mean generated project files or local maintainer skills. Local `.agents/skills`
  are workspace aids unless they are explicitly emitted by Kitsmith.
- `AGENTS.md` files are generated artifacts. Do not edit them as independent sources unless a command
  explicitly preserves root content during adoption.
