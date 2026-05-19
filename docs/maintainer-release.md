# Maintainer Release Workflow

Kitsmith uses Conventional Commits for commit history quality. Lefthook owns Git hooks in this
repository; do not install Cocogitto hooks with `cog install-hook`.

Cocogitto is maintainer tooling for release preparation only. It is not part of the generated
project contract.

## Install Cocogitto

Install the `cog` binary outside the Bun dependency graph:

```bash
cargo install --locked cocogitto
```

Use another package manager if preferred, but keep `cog` as an external maintainer prerequisite.

## Create Commits

Regular `git commit` is still valid. The Lefthook `commit-msg` hook validates the final message.

Cocogitto can also create Conventional Commits directly:

```bash
cog commit feat "add generated commit hooks" scaffold
cog commit fix "preserve existing commit hooks" adopt
cog commit chore "update release workflow" release
```

Use `--edit` when the commit needs a body:

```bash
cog commit chore --edit "publish kitsmith 0.3.0" release
```

Release commits should explain the product or tooling change. Do not add meta-commentary about
release mechanics, such as preparing the changelog, passing `release:prepare`, tagging, or publishing.
Those facts belong in the run log or release checklist, not in the commit message.

Good:

```text
fix(deps): align Bun 1.3.14 tooling baseline

Update the repository Bun pin, generated project Bun defaults, and @types/bun baseline to 1.3.14.
```

Bad:

```text
fix(deps): align Bun 1.3.14 tooling baseline

Update the repository Bun pin, generated project Bun defaults, and @types/bun baseline to 1.3.14.

Prepare the 0.3.2 changelog entry for the local release gate.
```

## GitHub Integration Policy

`main` uses GitHub rulesets as the human approval boundary. Changes land through pull requests,
with linear history enforced and merge commits disabled. Squash merge is the default for one
coherent change; rebase merge is reserved for a deliberately curated commit series where every
commit is useful on `main`.

Agents may create branches, open pull requests, run validation, and perform read-only reviews.
Agents must not merge pull requests, bypass repository rules, publish to npm, create or push
release tags, or push `main` unless the maintainer explicitly asks for that side effect in the
current task.

Commit signatures are optional on `main`. Release trust is anchored by signed `v*` tags. Release
tags must be immutable: never move or delete a published `v*` tag; publish a new patch release
instead.

## Inspect Release State

Run the automated local preparation gate before asking for publish approval:

```bash
bun run release:prepare
```

This command checks the current version, tag availability, npm availability, Cocogitto state,
and repo validation. It then builds a clean work copy in a sandbox, creates a scriptless package
with `npm pack --ignore-scripts`, inspects the exact tarball without network access, writes a
release manifest, and runs tarball smoke against the packed CLI. Tarball smoke installs the
packed CLI and scaffolds a minimal generated project inside a disposable sandbox. It does not
publish, push, tag, or run `npm publish --dry-run`.

Run Cocogitto checks manually when debugging release state:

```bash
cog check
cog changelog v0.1.3..HEAD
cog bump --auto --dry-run
```

`cog.toml` is configured for `v`-prefixed tags, GitHub links, and `CHANGELOG.md`.

`cog bump --auto --dry-run` follows Conventional Commit SemVer. A `feat(...)` commit proposes the
next minor version, so a feature commit after `v0.2.0` proposes `v0.3.0`. Use an explicit increment
only when the maintainer deliberately wants to override the conventional release level.

Do not run non-dry-run `cog bump` as part of routine work yet. Treat version bumping, changelog
writing, tagging, and npm publishing as an explicit release slice that still requires human
approval.

## Changelog Policy

Kitsmith keeps `CHANGELOG.md` as a maintainer-owned release note, but Cocogitto is the release
candidate source. Before editing the changelog, inspect the generated candidate:

```bash
cog changelog "$(git describe --tags --abbrev=0)..HEAD"
```

That output is an aggregation of the final commits since the latest tag. If the project uses
squash merges, the squash commit title and body become the changelog input. This means commits
that land on `main` must be changelog-quality:

- the title says what changed, not just that a release happened
- the scope names the affected product surface when useful
- the body explains user-visible behavior, generated-project contract changes, or maintenance
  impact without restating touched files or release-process steps
- pure maintenance commits use `chore`, `docs`, `test`, or `refactor` deliberately so they can be
  included or ignored intentionally later

Do not blindly paste generated changelog output. Use it to avoid missing commit-derived changes,
then write the human-facing release note in `CHANGELOG.md`.

## Publish After Approval

After `bun run release:prepare` passes and the release has explicit human approval:

```bash
npm publish --access public
git tag -s v0.3.0 -m "Release 0.3.0"
git tag -v v0.3.0
git push origin v0.3.0
npm view kitsmith version dist-tags --json
git ls-remote --tags origin 'refs/tags/v0.3.0*'
```

If npm requires 2FA, rerun publish with the current OTP:

```bash
npm publish --access public --otp=<code>
```

Do not tag or push if npm publish fails.
