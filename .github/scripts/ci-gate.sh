#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?}"
: "${GITHUB_EVENT_NAME:?}"

if [[ "${GITHUB_EVENT_NAME}" != "pull_request" ]]; then
  echo "mode=full" >> "${GITHUB_OUTPUT}"
  exit 0
fi

: "${PR_BASE_SHA:?}"
: "${PR_HEAD_SHA:?}"

changed_files="$(git diff --name-only "${PR_BASE_SHA}...${PR_HEAD_SHA}")"
echo "${changed_files}"

if [[ -z "${changed_files}" ]]; then
  echo "mode=light" >> "${GITHUB_OUTPUT}"
  exit 0
fi

if printf '%s\n' "${changed_files}" | grep -Ev '^(README\.md|CHANGELOG\.md|AGENTS\.md|CLAUDE\.md|docs/|\.claude/rules/)' >/dev/null; then
  echo "mode=full" >> "${GITHUB_OUTPUT}"
else
  echo "mode=light" >> "${GITHUB_OUTPUT}"
fi
