#!/usr/bin/env bash
set -euo pipefail

: "${MODE:?}"
: "${GATE_RESULT:?}"
: "${LIGHT_RESULT:?}"
: "${QUALITY_LINUX_RESULT:?}"
: "${QUALITY_WINDOWS_RESULT:?}"
: "${GENERATED_LINUX_RESULT:?}"
: "${GENERATED_WINDOWS_RESULT:?}"
: "${SANDBOX_LINUX_RESULT:?}"

if [[ "${GATE_RESULT}" != "success" ]]; then
  echo "ci-gate failed or was skipped: ${GATE_RESULT}" >&2
  exit 1
fi

case "${MODE}" in
  light)
    if [[ "${LIGHT_RESULT}" != "success" ]]; then
      echo "light-checks failed or was skipped: ${LIGHT_RESULT}" >&2
      exit 1
    fi
    ;;
  full)
    for result in \
      "${QUALITY_LINUX_RESULT}" \
      "${QUALITY_WINDOWS_RESULT}" \
      "${GENERATED_LINUX_RESULT}" \
      "${GENERATED_WINDOWS_RESULT}" \
      "${SANDBOX_LINUX_RESULT}"
    do
      if [[ "${result}" != "success" ]]; then
        echo "A full CI job failed or was skipped." >&2
        exit 1
      fi
    done
    ;;
  *)
    echo "Unknown CI mode: ${MODE}" >&2
    exit 1
    ;;
esac
