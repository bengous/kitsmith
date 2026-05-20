# Adoption Ubiquitous Language

## Planning Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Adoption Plan** | The dry-run result describing what Kitsmith would create, modify, skip, or reject in a target project. | Migration plan |
| **Adoption Action** | One planned create, modify, skip, or conflict entry in an adoption plan. | Change |
| **Writable Adoption Action** | A create or modify action that writes during `--apply`. | Write action |
| **Adoptable Project** | An existing project with `package.json`, `tsconfig.json`, and Bun/TypeScript signals. | Compatible repo |
| **Lint Severity** | The adoption setting that controls whether copied OXLint rules are adopted as warnings or errors. | Lint mode |

## Safety Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Backup Manifest** | The JSON record stored under `.kitsmith/backups/<runId>/manifest.json` describing written adoption actions. | Rollback file |
| **Backup Run ID** | The timestamp-derived identifier for one adoption backup run. | Backup id |
| **Preserved File** | An existing target file intentionally skipped instead of overwritten. | Ignored file |
| **Adoption Conflict** | A planned action that requires human review before Kitsmith can safely write. | Error |
| **Non-Directory Parent Conflict** | A path conflict where Kitsmith would need a directory but the target project already has a file at a parent path. | Path collision |

## Relationships

- An **Adoption Plan** contains many **Adoption Actions**.
- A **Writable Adoption Action** is backed up before it is applied.
- A **Backup Manifest** is used by rollback to undo created files and restore modified files.
- An **Adoptable Project** may still produce **Adoption Conflicts**.

## Flagged Ambiguities

- "Adopt" should not mean "generate into an existing folder." Adoption preserves existing project ownership unless the adoption policy explicitly permits a write.
- "Conflict" is not the same as process failure. A conflict is a planned result that tells the maintainer why Kitsmith will not write automatically.
