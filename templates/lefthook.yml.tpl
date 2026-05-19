min_version: 2.1.2
glob_matcher: doublestar
no_tty: true
output:
  - summary
  - failure
  - execution_out

pre-commit:
  commands:
    # Keep these globs aligned with the repo surfaces they protect.
    # If the project layout changes, update these globs and the quality tooling configs together.
    # `glob_matcher: doublestar` makes `**` match zero or more nested directories.
    root-oxc:
      glob:
        - "scripts/**/*.ts"
__BACKEND_LEFTHOOK_GLOB____CODEX_LEFTHOOK_GLOB__
      run: ./node_modules/.bin/oxlint -c .oxlintrc.jsonc --fix --quiet --format=unix {staged_files} && ./node_modules/.bin/oxfmt --write -c .oxfmtrc.jsonc {staged_files}
      stage_fixed: true
__FRONTEND_LEFTHOOK_COMMAND__
    typecheck:
      glob:
        - "scripts/**/*.ts"
__BACKEND_LEFTHOOK_GLOB____CODEX_LEFTHOOK_GLOB__
__FRONTEND_TYPECHECK_GLOB__      run: bun scripts/validation/typecheck-staged.ts
    gitleaks:
      run: gitleaks protect --staged --no-banner

commit-msg:
  commands:
    commitlint:
      run: bun scripts/validation/commit-message.ts {1}

pre-push:
  commands:
    validate:
      run: bun scripts/validation/validate-push.ts
    gitleaks:
      run: gitleaks detect --no-banner
