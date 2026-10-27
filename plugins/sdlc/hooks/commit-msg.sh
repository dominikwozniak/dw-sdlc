#!/bin/bash
# The git commit-msg hook: enforce-commit-hygiene.sh's subject check on every commit git makes, run
# on the message file git hands it; exit 1 aborts the commit. README.md#commit-hook has the rest.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MSG_FILE="${1:-}"
if [[ ! -f "$MSG_FILE" ]]; then
  printf 'commit-msg: usage: commit-msg.sh <message-file>\n' >&2
  exit 1
fi

if ! guard_config_load "$PWD"; then
  printf 'commit-msg: jq is missing, so the commit subject goes unchecked.\n' >&2
  exit 0
fi
PATTERN=$(guard_config_get '.commit.pattern')

# The subject is the first line git keeps. The hook runs before git's cleanup, so the file may still
# hold comment lines, leading blank lines and, under `--verbose`, a diff below the scissors line.
SUBJECT=""
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == "# ------------------------ >8 ------------------------" ]] && break
  [[ "$line" == "#"* || "$line" =~ ^[[:space:]]*$ ]] && continue
  SUBJECT="$line"
  break
done <"$MSG_FILE"

# An empty message is git's to refuse: it aborts the commit once this hook returns.
[[ -n "$SUBJECT" ]] || exit 0
guard_subject_fits "$SUBJECT" "$PATTERN" && exit 0

cat >&2 <<EOF
commit subject "$SUBJECT" does not match this repository's commit pattern.
  pattern: $PATTERN
  from commit.pattern in .ai/agentic.config.json, or the preset commit.convention names; '.+' accepts any subject.
Rewrite the subject to match.
EOF
exit 1
