# Generation Ubiquitous Language

## Project Shape

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Backend Starter** | The Bun backend part of a generated project. | Backend preset |
| **Frontend Preset** | The selected frontend option for a generated project; currently `none` or `tanstack`. | Frontend type, frontend framework |
| **TanStack Frontend** | The optional frontend workspace bootstrapped through the TanStack CLI and normalized by Kitsmith. | React app, frontend app |
| **AI Option** | The project shape option that emits agent instructions, hooks, sync tooling, and related validation paths. | Agent preset |
| **Effect Starter** | The project shape option that emits Effect runtime dependencies and Effect-flavored backend starter source. | Effect preset |

## Generation Pipeline

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Native Bootstrap** | The external bootstrap step that creates initial Bun or TanStack project files before Kitsmith normalization. | Scaffolding |
| **Cleanup Path** | A path removed after native bootstrap because Kitsmith does not keep that native output. | Deleted native file |
| **Preset Copy** | A static file copied from `template-sources/` into the generated project. | Overlay write |
| **Template Render** | A rendered `templates/` file written with values from the generated project contract. | Interpolation |
| **Generated File Spec** | The contract entry describing a generated file and whether it is owned by a preset, template, or finalization. | File list |

## Relationships

- A **Project Shape** determines **Native Bootstrap**, **Cleanup Paths**, **Preset Copies**, **Template Renders**, and **Generated File Specs**.
- A **TanStack Frontend** requires frontend-specific native bootstrap, cleanup, templates, dependencies, and validation.
- An **Effect Starter** requires a backend and changes backend source plus dependency sections.
- The **AI Option** adds agent tooling and generated `AGENTS.md` finalization outputs.

## Flagged Ambiguities

- "Preset" should mean a copied static source layer. Do not use it for backend, Effect, or AI unless referring to the actual `Preset` copy spec.
- "Generated project contract" is broader than generated files. It includes shape, cleanup, scripts, dependencies, tooling paths, and frontend package facts.
