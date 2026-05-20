# Validation Ubiquitous Language

## Lane Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Validation Lane** | A named maintainer command that groups validation steps for a specific feedback depth or risk surface. | Check, test bundle |
| **Check Lane** | Fast read-only maintainer validation for local feedback. | Quick test |
| **Validate Lane** | Daily maintainer validation that extends check with architecture lint and OXLint audit. | Full test |
| **Deep Lane** | Slower local validation that adds dead-code, duplicate-code, GitHub Actions, and link checks. | Scale validation |
| **Generated Lane** | Host-safe generated-project contract validation. | Generated tests |
| **Sandbox Lane** | Linux bubblewrap validation that installs and runs generated projects. | Smoke lane |

## Routing Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Routing Scope** | A classified change area used to choose stop and pre-push validation steps. | Change kind |
| **Routed Product Surface** | Files under `templates/` or `template-sources/` that validation routing treats as generated-output product changes. | Product surface |
| **Quality Workspace** | A lint/format execution target resolved from a touched path. | Workspace |
| **Ordered Prerequisite** | A validation step that must pass before concurrent steps can start. | First step |

## Relationships

- A **Validation Lane** contains package-script steps.
- A **Routing Scope** determines hook-triggered validation.
- A **Routed Product Surface** change is treated as generated project contract risk.
- An **Ordered Prerequisite** prevents concurrent validation from masking required sequencing.

## Flagged Ambiguities

- "Check" can mean the `check` lane or a domain-specific command such as `generated-dependencies:check`.
  Use the exact script name when the command matters.
- "Sandbox" should mean bubblewrap-isolated runtime validation, not any temporary directory test.
- `release:prepare` belongs to the release domain and is not a **Validation Lane**.
