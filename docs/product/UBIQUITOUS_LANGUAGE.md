# Kitsmith Ubiquitous Language

This glossary contains only terms that are used across several Kitsmith domains. Domain-specific
terms live in each domain's own `UBIQUITOUS_LANGUAGE.md`.

## Product Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Kitsmith** | The Bun-first CLI product that creates new projects and adopts existing Bun/TypeScript projects into the Kitsmith product contract. | Forge, generator-only tool |
| **Maintainer Repo** | The Kitsmith source repository that owns the CLI, templates, configs, validation scripts, release scripts, and generated artifacts. | Parent project, local repo |
| **Generated Project** | A new project created by `kitsmith [destination]`. | Emitted project, output project |
| **Target Project** | An existing project inspected or modified by `kitsmith adopt`. | Host project, base repo |
| **Product Contract** | The set of generated/adopted behavior, files, commands, validation gates, and safety properties Kitsmith intentionally guarantees. | Standards, guidelines, baseline |
| **Project Shape** | The normalized combination of enabled backend, frontend, AI, and Effect options. | Preset selection, flags |
| **Preset** | A named copied source layer that contributes static files to a generated or adopted project. | Overlay, config bundle |
| **Template** | A dynamic source file rendered with a project contract and written to a generated or adopted project. | Boilerplate, stub |
| **Finalization** | The post-write project step that can initialize Git, install dependencies, run setup, and attempt `mise install`. | Setup, install phase |
| **Product Surface** | Any user-visible or maintainer-visible contract surface whose change can alter generated/adopted behavior, validation, release safety, or agent guidance. | Template surface, output |

## Source Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Source of Truth** | The file or model that is edited by humans and from which derived artifacts are generated or checked. | Artifact, generated output |
| **Generated Artifact** | A committed file produced from a source of truth and consumed by runtime code or validation. | Source, baseline |

## Relationships

- A **Maintainer Repo** produces the **Kitsmith** CLI.
- **Kitsmith** creates a **Generated Project** or plans/applies changes to a **Target Project**.
- A **Project Shape** selects **Presets**, **Templates**, generated dependencies, validation surfaces, and finalization behavior.
- A **Product Contract** is verified through validation behavior owned by the validation domain.
- A **Generated Artifact** must be traceable to a **Source of Truth** and checked for drift.

## Flagged Ambiguities

- "Baseline" is not global enough to use alone. Prefer the precise local term, such as **Generated Dependency Baseline**, or say **Product Contract** when describing the whole Kitsmith promise.
- "Generated" can mean a generated project, generated artifact, or generated file. Use the full term when ambiguity matters.
- "Validation" can mean a lane, a leaf command, a hook, or a sandbox scenario. Validation lane terms live in `docs/product/validation/UBIQUITOUS_LANGUAGE.md`.
