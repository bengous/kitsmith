# Release Ubiquitous Language

## Release Terms

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Release Prepare** | The maintainer gate that verifies release state, builds a clean package, inspects the tarball, and stops before publishing. | Publish, dry run |
| **Release Manifest** | The JSON summary written by release preparation with package, version, commit, tarball, file list, and safety checks. | Release report |
| **Scriptless Pack** | An `npm pack --ignore-scripts` package build used to avoid executing package lifecycle scripts during packaging. | Npm pack |
| **Tarball Inspection** | The no-network inspection of the packed npm tarball for allowlisted files, sensitive files, lifecycle scripts, and hashes. | Package audit |
| **Tarball Smoke** | The sandbox test that installs the packed CLI tarball and scaffolds a generated project. | Smoke test |
| **Release Trust Boundary** | The policy that publishing, signing tags, and pushing tags require explicit maintainer approval. | Release approval |

## Relationships

- **Release Prepare** creates a **Release Manifest**.
- **Release Prepare** includes **Scriptless Pack**, **Tarball Inspection**, and **Tarball Smoke**.
- **Release Prepare** respects the **Release Trust Boundary** by stopping before publish, tag, or push.

## Flagged Ambiguities

- "Dry run" is not precise enough here. `release:prepare` does more than a dry run, but it still does
  not publish.
- "Smoke" in the release domain means packed tarball smoke, not the general sandbox lane smoke.
