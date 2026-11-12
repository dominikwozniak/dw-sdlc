#!/bin/bash
# Refuses a check command whose output a later pipeline stage feeds to a filter: README.md#guards. The
# pipe drops the lines that explain a failure and, with pipefail off, turns the exit code green. A
# guardrail against agent habit, not a security boundary: a disguised spelling slips past.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
[[ "$GUARD_COMMAND" == *'|'* ]] || exit 0

guard_config_load "$GUARD_CWD" || exit 0
[[ "$(guard_config_get '.guardrails.filteredOutput')" == "allow" ]] && exit 0

FILTER_RE='^(head|tail|grep|egrep|fgrep|rg|sed|awk|less|more)$'
# Words that run another command, then the runners a package manager or an interpreter puts in front.
WRAPPERS=" rtk sudo env time command nice nohup "
LAUNCHERS=" pnpm yarn npm npx bunx exec dlx bundle uv poetry run python python3 -m -- "
DW_SDLC_RE='(^|[[:space:]/])dw-sdlc([[:space:]]+|/src/cli\.ts[[:space:]]+)(gate|check)([[:space:]]|$)'
LEAD=$' \t\003({'

# stage_words <stage> — CORE_WORDS, the stage's words after its redirect's \003, a subshell's opener,
# `VAR=value` and the words that run another command.
CORE_WORDS=()
stage_words() {
  local stage="$1" word
  local -a words
  stage=${stage#"${stage%%[!$LEAD]*}"}
  read -ra words <<<"$stage"
  CORE_WORDS=()
  for word in "${words[@]+"${words[@]}"}"; do
    if [[ ${#CORE_WORDS[@]} -eq 0 ]]; then
      [[ "$word" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && continue
      [[ "$WRAPPERS" == *" $word "* ]] && continue
    fi
    CORE_WORDS+=("$word")
  done
}

# stage_text — CORE_WORDS as one line without the stage's redirects, a quoted separator's \002 shown as `|`.
stage_text() {
  local word text=""
  for word in "${CORE_WORDS[@]}"; do
    [[ "$word" == *$'\003'* ]] && continue
    text+="${text:+ }${word//$'\002'/|}"
  done
  printf '%s' "$text"
}

# builtin_check — 0 when CORE_WORDS run a test runner, a type checker or a linter of the built-in list.
builtin_check() {
  local i=0 word next
  while ((i < ${#CORE_WORDS[@]})) && [[ "$LAUNCHERS" == *" ${CORE_WORDS[i]} "* ]]; do
    i=$((i + 1))
  done
  ((i < ${#CORE_WORDS[@]})) || return 1
  word=${CORE_WORDS[i]##*/}
  next=${CORE_WORDS[i + 1]-}
  case "$word" in
    vitest | jest | tsc | oxlint | eslint | rspec | rubocop | pytest) return 0 ;;
    vp) [[ "$next" == "check" ]] && return 0 ;;
    cargo | go) [[ "$next" == "test" ]] && return 0 ;;
  esac
  return 1
}

# The config's check commands: gate.command, each Step, each gate.checks.run command. A command that
# chains others stands for the first stage of each.
CONFIG_CHECKS=()
while IFS= read -r configured; do
  [[ -n "$configured" ]] || continue
  while IFS= read -r pipeline; do
    stage_words "${pipeline%%|*}"
    [[ ${#CORE_WORDS[@]} -gt 0 ]] && CONFIG_CHECKS+=("${CORE_WORDS[*]}")
  done < <(guard_pipelines "$(guard_mask_quoted_separators "$configured")")
done < <(guard_config_get '(.gate.command, (.gate.steps[]? | if type == "object" then .command else . end), .gate.checks.run[]?.command) | strings')

# is_check <stage> — 0 when the stage runs a check command; CORE_WORDS hold its words.
is_check() {
  local core check
  stage_words "$1"
  [[ ${#CORE_WORDS[@]} -gt 0 ]] || return 1
  core="${CORE_WORDS[*]}"
  for check in "${CONFIG_CHECKS[@]+"${CONFIG_CHECKS[@]}"}"; do
    [[ "$core" == "$check" || "$core" == "$check "* ]] && return 0
  done
  [[ "$core" =~ $DW_SDLC_RE ]] && return 0
  builtin_check
}

# filter_of <stage> — the filter the stage runs, if any.
filter_of() {
  local word
  stage_words "$1"
  word=${CORE_WORDS[0]-}
  word=${word##*/}
  word=${word%%)*}
  [[ "$word" =~ $FILTER_RE ]] && printf '%s' "$word"
}

SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
while IFS= read -r pipeline; do
  [[ "$pipeline" == *'|'* ]] || continue
  IFS='|' read -ra stages <<<"$pipeline"
  check=""
  for stage in "${stages[@]}"; do
    if [[ -n "$check" ]]; then
      filter=$(filter_of "$stage")
      if [[ -n "$filter" ]]; then
        guard_block "'$check' is piped into '$filter'. The pipe hides the failure and the exit code: the pipeline reports the filter's status, so a red check reads green, and the lines that explain the failure are dropped. Run '$check' unpiped, or redirect it with '$check > <file> 2>&1' and read the file."
      fi
    elif is_check "$stage"; then
      check=$(stage_text)
    fi
  done
done < <(guard_pipelines "$SCAN")

exit 0
